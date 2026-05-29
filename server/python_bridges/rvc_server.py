"""
rvc_server.py  —  Omnecor · RVC Voice Conversion Microservice
==============================================================
FastAPI application that wraps Retrieval-based Voice Conversion (RVC).

Architecture overview
---------------------
1. Client POSTs a multipart form with:
     source_audio  — audio file to convert (wav / mp3 / ogg / flac)
     model_path    — path to the .pth RVC checkpoint on this server
     pitch_shift   — semitone shift (int, typically −12 … +12)

2. The server:
     a. Validates inputs
     b. Writes the upload to a temp file
     c. Runs the RVC inference pipeline (real architectural wrapper;
        the inner tensor math is stubbed — swap in the real hubert +
        VC model calls when integrating the full RVC codebase)
     d. Returns the converted audio as a streaming audio/wav response

Dependencies
------------
    pip install fastapi uvicorn python-multipart soundfile numpy torch

NOTE: The actual RVC repository (https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)
provides the real HuBERT encoder and VC model classes.  Import them
where the stubs are marked with  # ← REPLACE WITH REAL CALL.

Run
---
    uvicorn rvc_server:app --host 0.0.0.0 --port 8003 --reload
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
log = logging.getLogger("omnecor.rvc")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Preferred sample rate for RVC inference (16 kHz for HuBERT; output
# is typically upsampled back to 44.1 kHz or 48 kHz).
HUBERT_SAMPLE_RATE: int = 16_000
OUTPUT_SAMPLE_RATE: int = int(os.getenv("RVC_OUTPUT_SAMPLE_RATE", "44100"))

# Device — auto-select CUDA if available.
DEVICE: str = os.getenv("RVC_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

# Maximum upload size in bytes (default 200 MB).
MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))

# Root directory for RVC models to prevent path traversal.
# Default to 'assets/models/rvc' relative to the project root.
RVC_MODELS_DIR: Path = Path(os.getenv("RVC_MODELS_DIR", "assets/models/rvc")).resolve()

# Pitch extraction method — "pm" (fast, less accurate) or "harvest" (accurate, slow).
F0_METHOD: str = os.getenv("RVC_F0_METHOD", "harvest")

def is_safe_path(path: Path, base: Path) -> bool:
    """Check if a path is contained within a base directory."""
    try:
        # resolve() handles symlinks and '..'
        return base in path.resolve().parents or path.resolve() == base
    except (OSError, RuntimeError):
        return False

# ─────────────────────────────────────────────────────────────────────────────
# RVC model cache — keep loaded checkpoints in memory between requests
# so we avoid re-loading on every call (models can be 200 MB–1 GB).
# ─────────────────────────────────────────────────────────────────────────────

class ModelCache:
    """Simple LRU-style cache for loaded RVC checkpoints."""

    def __init__(self, max_entries: int = 3) -> None:
        self._cache: dict[str, "RVCModel"] = {}
        self._max = max_entries
        self._access_order: list[str] = []

    def get(self, model_path: str) -> "RVCModel | None":
        if model_path in self._cache:
            # Promote to most-recently-used.
            self._access_order.remove(model_path)
            self._access_order.append(model_path)
            return self._cache[model_path]
        return None

    def put(self, model_path: str, model: "RVCModel") -> None:
        if model_path in self._cache:
            return  # already cached
        if len(self._cache) >= self._max:
            # Evict least-recently-used.
            lru_key = self._access_order.pop(0)
            del self._cache[lru_key]
            log.info("Evicted model from cache: %s", lru_key)
        self._cache[model_path] = model
        self._access_order.append(model_path)
        log.info("Cached model: %s  (cache size: %d)", model_path, len(self._cache))


# Module-level cache shared across requests.
_model_cache = ModelCache(max_entries=3)


# ─────────────────────────────────────────────────────────────────────────────
# RVC model wrapper
# ─────────────────────────────────────────────────────────────────────────────

class RVCModel:
    """
    Architectural wrapper for an RVC checkpoint.

    The real RVC pipeline has two main components:
      1. HuBERT  — extracts 768-dim soft content features from raw audio.
      2. SynthesizerTrnMs768NSFsid (or v1/v2 variant) — synthesises the
         target voice conditioned on the content features + pitch (F0).

    Both are loaded from the .pth checkpoint.  In a full integration you
    would also load the HuBERT base model separately (usually
    `hubert_base.pt` from the RVC repo's `assets/` folder).

    Methods marked  # ← REPLACE  are stubs — insert the real forward
    pass calls from the RVC codebase there.
    """

    def __init__(self, model_path: str, device: str) -> None:
        self.model_path = Path(model_path).resolve()
        self.device     = torch.device(device)
        self.net_g      = None   # SynthesizerTrnMs768NSFsid instance
        self.hubert     = None   # HuBERT feature extractor
        self.tgt_sr     = OUTPUT_SAMPLE_RATE

        self._load()

    def _load(self) -> None:
        """Load checkpoint weights into the model graph."""
        if not self.model_path.exists():
            raise FileNotFoundError(f"RVC checkpoint not found: {self.model_path}")
        if self.model_path.suffix.lower() != ".pth":
            raise ValueError(f"Expected a .pth file, got: {self.model_path.suffix}")

        log.info("Loading RVC checkpoint: %s on %s", self.model_path.name, self.device)

        # ── Load the state dict from the checkpoint file ──────────────────
        # SECURITY: weights_only=True prevents arbitrary code execution from untrusted .pth files.
        # If loading fails due to custom RVC classes, add them to torch.serialization.add_safe_globals.
        checkpoint = torch.load(
            str(self.model_path),
            map_location=self.device,
            weights_only=True,
        )

        try:
            from infer.lib.infer_pack.models import SynthesizerTrnMs768NSFsid
            from fairseq import checkpoint_utils

            # Load Synthesizer
            config = checkpoint.get("config", [768, 2, 2, 192, 768, 4, 1, 6, False])
            self.net_g = SynthesizerTrnMs768NSFsid(*config, is_half=False)
            self.net_g.load_state_dict(checkpoint["weight"], strict=False)
            self.net_g = self.net_g.to(self.device).eval()

            # Load HuBERT
            hubert_path = os.getenv("RVC_HUBERT_PATH", "assets/hubert_base.pt")
            if os.path.exists(hubert_path):
                models, _, _ = checkpoint_utils.load_model_ensemble_and_task(
                    [hubert_path], suffix=""
                )
                self.hubert = models[0].to(self.device).eval()
            else:
                log.warning("HuBERT model not found at %s. Fallback to stub.", hubert_path)

            self.tgt_sr = checkpoint.get("sr", OUTPUT_SAMPLE_RATE)
            log.info("Successfully loaded real RVC model.")

        except ImportError:
            log.warning("RVC libraries (infer/fairseq) not found. Falling back to STUB mode.")
            self.net_g = checkpoint
            self.tgt_sr = OUTPUT_SAMPLE_RATE

    def convert(
        self,
        audio_np: np.ndarray,
        src_sr: int,
        pitch_shift: int,
    ) -> np.ndarray:
        """
        Run the full RVC voice conversion pipeline.

        Parameters
        ----------
        audio_np    : mono float32 waveform at `src_sr`.
        src_sr      : sample rate of the input waveform.
        pitch_shift : semitone shift to apply (−12 … +12 typical).

        Returns
        -------
        Mono float32 waveform at `self.tgt_sr`.
        """
        # ── Step 1: Resample to HuBERT's expected 16 kHz ─────────────────
        audio_16k = self._resample(audio_np, src_sr, HUBERT_SAMPLE_RATE)

        # ── Step 2: Extract HuBERT content features ───────────────────────
        feats = self._extract_features(audio_16k)

        # ── Step 3: Pitch (F0) extraction ────────────────────────────────
        f0, f0_coarse = self._extract_f0(audio_16k, pitch_shift)

        # ── Step 4: Voice synthesis (VC forward pass) ─────────────────────
        audio_out = self._synthesise(feats, f0, f0_coarse, pitch_shift)

        # ── Step 5: Resample output to target SR if needed ────────────────
        if HUBERT_SAMPLE_RATE != self.tgt_sr:
            audio_out = self._resample(audio_out, HUBERT_SAMPLE_RATE, self.tgt_sr)

        return audio_out.astype(np.float32)

    # ── Private helpers ───────────────────────────────────────────────────

    @staticmethod
    def _resample(audio: np.ndarray, src_sr: int, tgt_sr: int) -> np.ndarray:
        """Naive linear-interpolation resample (replace with `librosa.resample`
        or `torchaudio.functional.resample` in production)."""
        if src_sr == tgt_sr:
            return audio
        duration   = len(audio) / src_sr
        tgt_len    = int(duration * tgt_sr)
        return np.interp(
            np.linspace(0, len(audio) - 1, tgt_len),
            np.arange(len(audio)),
            audio,
        ).astype(np.float32)

    # ── Implementations & Fallbacks ───────────────────────────────────────

    def _extract_features(self, audio_16k: np.ndarray) -> torch.Tensor:
        if self.hubert is None:
            return self._stub_extract_features(audio_16k)

        wav_tensor = torch.FloatTensor(audio_16k).unsqueeze(0).to(self.device)
        with torch.no_grad():
            feats = self.hubert.extract_features(
                source=wav_tensor, padding_mask=None, mask=False, output_layer=9
            )[0]
        return feats

    def _extract_f0(
        self, audio_16k: np.ndarray, pitch_shift: int
    ) -> tuple[np.ndarray, np.ndarray]:
        try:
            import pyworld
            f0, _ = pyworld.harvest(
                audio_16k.astype(np.float64),
                HUBERT_SAMPLE_RATE,
                f0_floor=50.0, f0_ceil=1100.0, frame_period=10.0
            )
            # Apply semitone shift:
            f0 = f0 * (2 ** (pitch_shift / 12.0))
            # RVC uses a 256-bin mel scale mapping for coarse f0; simplified here
            f0_coarse = np.clip(np.round(f0), 1, 255).astype(np.int64)
            return f0.astype(np.float32), f0_coarse
        except ImportError:
            return self._stub_extract_f0(audio_16k, pitch_shift)

    def _synthesise(
        self,
        feats: torch.Tensor,
        f0: np.ndarray,
        f0_coarse: np.ndarray,
        pitch_shift: int,
    ) -> np.ndarray:
        if getattr(self.net_g, "infer", None) is None:
            return self._stub_synthesise(feats, f0, pitch_shift)

        f0_tensor = torch.FloatTensor(f0).unsqueeze(0).to(self.device)
        f0_coarse_tensor = torch.LongTensor(f0_coarse).unsqueeze(0).to(self.device)
        feats_len = torch.LongTensor([feats.shape[1]]).to(self.device)
        with torch.no_grad():
            audio = self.net_g.infer(
                feats, feats_len, f0_coarse_tensor, f0_tensor,
                sid=torch.LongTensor([0]).to(self.device)
            )[0, 0].float().cpu().numpy()
        return audio

    # ── STUBS — replace with real implementations ─────────────────────────

    def _stub_extract_features(self, audio_16k: np.ndarray) -> torch.Tensor:
        """
        STUB: HuBERT feature extraction.

        Real call (from the RVC codebase):
            wav_tensor = torch.FloatTensor(audio_16k).unsqueeze(0).to(self.device)
            with torch.no_grad():
                feats = self.hubert.extract_features(
                    source=wav_tensor, padding_mask=None, mask=False, output_layer=9
                )[0]
            return feats  # shape: [1, T, 768]
        """
        T = len(audio_16k) // 320  # approximate HuBERT frame count
        return torch.zeros(1, max(T, 1), 768, device=self.device)

    def _stub_extract_f0(
        self, audio_16k: np.ndarray, pitch_shift: int
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        STUB: F0 / pitch extraction.

        Real call uses `pyworld.harvest` or `parselmouth` (Praat):
            import pyworld
            f0, timeaxis = pyworld.harvest(
                audio_16k.astype(np.float64),
                HUBERT_SAMPLE_RATE,
                f0_floor=50, f0_ceil=1100, frame_period=10
            )
            # Apply semitone shift:
            f0 = f0 * (2 ** (pitch_shift / 12))
            f0_coarse = np.round(f0).astype(int)
        """
        n_frames  = len(audio_16k) // 160
        f0        = np.ones(n_frames, dtype=np.float32) * 220.0  # flat 220 Hz stub
        f0       *= 2 ** (pitch_shift / 12.0)
        f0_coarse = np.round(f0).astype(np.int64)
        return f0, f0_coarse

    def _stub_synthesise(
        self,
        feats: torch.Tensor,
        f0: np.ndarray,
        pitch_shift: int,
    ) -> np.ndarray:
        """
        STUB: VC synthesis forward pass.

        Real call (net_g is SynthesizerTrnMs768NSFsid):
            f0_tensor       = torch.FloatTensor(f0).unsqueeze(0).to(self.device)
            f0_coarse_tensor = torch.LongTensor(f0_coarse).unsqueeze(0).to(self.device)
            feats_len = torch.LongTensor([feats.shape[1]]).to(self.device)
            with torch.no_grad():
                audio = self.net_g.infer(
                    feats, feats_len, f0_coarse_tensor, f0_tensor,
                    sid=torch.LongTensor([0]).to(self.device)
                )[0, 0].float().cpu().numpy()
            return audio

        The stub returns the input audio unchanged (identity conversion)
        so the server is testable end-to-end before the real model is wired in.
        """
        n_samples = int(len(f0) * HUBERT_SAMPLE_RATE / 100)
        t         = np.linspace(0, n_samples / HUBERT_SAMPLE_RATE, n_samples)
        base_freq = 220.0 * (2 ** (pitch_shift / 12.0))
        return (np.sin(2 * np.pi * base_freq * t) * 0.3).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "RVC server starting — device=%s  output_sr=%d  f0_method=%s",
        DEVICE, OUTPUT_SAMPLE_RATE, F0_METHOD,
    )
    yield
    log.info("RVC server shutting down.")


# ─────────────────────────────────────────────────────────────────────────────
# Application
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Omnecor RVC Voice Conversion Service",
    description="Retrieval-based Voice Conversion microservice.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_audio(path: str) -> tuple[np.ndarray, int]:
    """
    Load audio from disk into a mono float32 numpy array.
    Uses soundfile for WAV/FLAC/OGG; falls back to a stub for MP3.
    """
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=False)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not decode audio file: {exc}",
        ) from exc

    # Mix down to mono if stereo.
    if data.ndim == 2:
        data = data.mean(axis=1)

    return data, sr


def _write_wav_to_buffer(audio: np.ndarray, sr: int) -> io.BytesIO:
    """Encode a float32 numpy array as a 16-bit PCM WAV into a BytesIO buffer."""
    # Clip to prevent clipping distortion from accumulated gain.
    audio = np.clip(audio, -1.0, 1.0)
    pcm   = (audio * 32767).astype(np.int16)
    buf   = io.BytesIO()
    sf.write(buf, pcm, sr, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["ops"])
async def health() -> dict[str, str]:
    return {"status": "ok", "device": DEVICE}


@app.post(
    "/convert_voice",
    summary="Convert voice using an RVC checkpoint",
    tags=["rvc"],
    response_class=StreamingResponse,
)
async def convert_voice(
    source_audio: Annotated[UploadFile, File(description="Audio file to convert")],
    model_path:   Annotated[str,        Form(description="Absolute path to .pth RVC checkpoint on this server")],
    pitch_shift:  Annotated[int,        Form(description="Semitone pitch shift (−24 to +24)")] = 0,
) -> StreamingResponse:
    """
    Accept a source audio file and an RVC model checkpoint path, then
    return the voice-converted audio as a streaming WAV response.
    """
    # ── Validate pitch range ──────────────────────────────────────────────
    if not (-24 <= pitch_shift <= 24):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="pitch_shift must be between −24 and +24 semitones.",
        )

    # ── Validate model path exists and is a .pth file ─────────────────────
    model_file = Path(model_path).resolve()
    if not is_safe_path(model_file, RVC_MODELS_DIR):
        log.warning("Path traversal attempt blocked: %s", model_path)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to the specified model path is restricted.",
        )

    if not model_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model checkpoint not found: {model_path}",
        )
    if model_file.suffix.lower() != ".pth":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="model_path must point to a .pth file.",
        )

    # ── Read upload ────────────────────────────────────────────────────────
    raw_bytes = await source_audio.read()
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded audio file is empty.",
        )

    log.info(
        "Conversion request: model=%s  pitch=%+d  audio=%s  size=%d bytes",
        model_file.name, pitch_shift, source_audio.filename, len(raw_bytes),
    )

    # ── Write audio to a temp file for soundfile / ffmpeg ─────────────────
    suffix = Path(source_audio.filename or ".wav").suffix or ".wav"
    tmp_in_path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
            tmp_in.write(raw_bytes)
            tmp_in_path = tmp_in.name

        # ── Load or retrieve cached model ──────────────────────────────────
        model_key = str(model_file)
        rvc_model = _model_cache.get(model_key)
        if rvc_model is None:
            try:
                rvc_model = RVCModel(model_key, DEVICE)
            except (FileNotFoundError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(exc),
                ) from exc
            except Exception as exc:
                log.error("Model load failed: %s", exc, exc_info=True)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to load RVC model: {exc}",
                ) from exc
            _model_cache.put(model_key, rvc_model)

        # ── Decode audio ───────────────────────────────────────────────────
        audio_np, src_sr = _load_audio(tmp_in_path)
        log.info("Audio decoded: sr=%d  frames=%d  duration=%.2fs",
                 src_sr, len(audio_np), len(audio_np) / src_sr)

        # ── Run RVC inference ──────────────────────────────────────────────
        try:
            converted = rvc_model.convert(audio_np, src_sr, pitch_shift)
        except Exception as exc:
            log.error("RVC inference failed: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Voice conversion error: {exc}",
            ) from exc

        log.info("Conversion complete: output frames=%d  sr=%d",
                 len(converted), rvc_model.tgt_sr)

    finally:
        # Always clean up the temp input file.
        if tmp_in_path:
            try:
                os.unlink(tmp_in_path)
            except OSError:
                pass

    # ── Encode output to WAV and stream back ──────────────────────────────
    wav_buf = _write_wav_to_buffer(converted, rvc_model.tgt_sr)

    return StreamingResponse(
        content=wav_buf,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="converted.wav"',
            "Content-Length":      str(wav_buf.getbuffer().nbytes),
            "X-Sample-Rate":       str(rvc_model.tgt_sr),
            "X-Pitch-Shift":       str(pitch_shift),
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "rvc_server:app",
        host="0.0.0.0",
        port=8003,
        reload=False,
        workers=1,   # GPU model is not fork-safe across workers
    )
