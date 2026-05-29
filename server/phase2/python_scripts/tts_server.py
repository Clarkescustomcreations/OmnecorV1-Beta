"""
tts_server.py  —  Omnecor · Voice Cloning & TTS Microservice
=============================================================
Loads the Coqui XTTS-v2 model once at startup and exposes a single
POST /synthesize endpoint that accepts text + a speaker reference WAV
and returns a cloned-voice audio file.

Dependencies:
    pip install fastapi uvicorn TTS torch

    NOTE: The first run will download the XTTS-v2 checkpoint (~1.8 GB).
    Set the env var COQUI_TTS_CACHE_PATH to control the cache directory.

Run:
    uvicorn tts_server:app --host 0.0.0.0 --port 8002 --reload
"""

import io
import logging
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import torch
import uvicorn
from TTS.api import TTS
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
log = logging.getLogger("omnecor.tts")

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------

# Device: "cpu" or "cuda" — auto-detected if not set
_default_device = "cuda" if torch.cuda.is_available() else "cpu"
TTS_DEVICE: str = os.getenv("TTS_DEVICE", _default_device)

# Directory where synthesised WAV files are written before streaming.
# A ramdisk path (e.g. /dev/shm) keeps latency low on Linux.
OUTPUT_DIR: Path = Path(os.getenv("TTS_OUTPUT_DIR", tempfile.gettempdir())) / "omnecor_tts"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Whether to stream the WAV back directly (True) or return a JSON path (False)
STREAM_RESPONSE: bool = os.getenv("TTS_STREAM_RESPONSE", "true").lower() == "true"

# Maximum text length accepted (characters)
MAX_TEXT_LENGTH: int = int(os.getenv("TTS_MAX_TEXT_LENGTH", "4000"))

# Supported languages — XTTS-v2 multilingual set
SUPPORTED_LANGUAGES: frozenset[str] = frozenset(
    {
        "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru",
        "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi",
    }
)

# ---------------------------------------------------------------------------
# Application state
# ---------------------------------------------------------------------------

class AppState:
    tts: TTS | None = None


# ---------------------------------------------------------------------------
# Lifespan — load model once, release on shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Download (first run) and load XTTS-v2 into memory before the server
    starts accepting requests.  XTTS-v2 is large; this takes 10–60 s
    depending on hardware."""
    log.info("Loading Coqui XTTS-v2 model on device=%s …", TTS_DEVICE)
    try:
        # `tts_models/multilingual/multi-dataset/xtts_v2` is the XTTS-v2 ID.
        # `gpu=True` when CUDA is available, else CPU inference.
        app.state.tts = TTS(
            model_name="tts_models/multilingual/multi-dataset/xtts_v2",
            progress_bar=False,
            gpu=(TTS_DEVICE == "cuda"),
        )
        log.info("XTTS-v2 model loaded successfully.")
    except Exception as exc:
        log.critical("Failed to load TTS model: %s", exc, exc_info=True)
        raise RuntimeError("TTS model could not be loaded") from exc

    yield  # ← server is live here

    log.info("Shutting down — releasing TTS model.")
    app.state.tts = None


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Omnecor TTS Service",
    description="Voice cloning & synthesis powered by Coqui XTTS-v2.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Omnecor Node.js backend (and local dev tools) to call this
# service from a different origin.  Tighten `allow_origins` in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class SynthesisRequest(BaseModel):
    """Payload for the /synthesize endpoint."""

    text: str = Field(
        ...,
        min_length=1,
        description="Text to synthesise (max 4 000 chars).",
        examples=["Hello world, this is Omnecor speaking."],
    )
    speaker_wav_path: str = Field(
        ...,
        description=(
            "Absolute path to a reference WAV file (3–30 s of clean speech) "
            "used for voice cloning.  Must be accessible by this server process."
        ),
        examples=["/home/user/voices/reference.wav"],
    )
    language: str = Field(
        default="en",
        description=f"BCP-47 language code.  Supported: {sorted(SUPPORTED_LANGUAGES)}",
        examples=["en", "fr", "de"],
    )

    @field_validator("text")
    @classmethod
    def check_text_length(cls, v: str) -> str:
        if len(v) > MAX_TEXT_LENGTH:
            raise ValueError(
                f"text exceeds the maximum length of {MAX_TEXT_LENGTH} characters."
            )
        return v

    @field_validator("language")
    @classmethod
    def check_language(cls, v: str) -> str:
        lang = v.lower().strip()
        if lang not in SUPPORTED_LANGUAGES:
            raise ValueError(
                f"Language '{v}' is not supported.  "
                f"Choose one of: {sorted(SUPPORTED_LANGUAGES)}"
            )
        return lang


class SynthesisPathResponse(BaseModel):
    """Returned when STREAM_RESPONSE is False."""
    output_path: str
    message: str = "Audio saved successfully."


# Root directory for speaker reference files to prevent path traversal.
SPEAKER_WAV_ROOT: Path = Path(os.getenv("SPEAKER_WAV_ROOT", "assets/speakers")).resolve()

def is_safe_path(path: Path, base: Path) -> bool:
    """Check if a path is contained within a base directory."""
    try:
        # resolve() handles symlinks and '..'
        return base in path.resolve().parents or path.resolve() == base
    except (OSError, RuntimeError):
        return False

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_speaker_wav(raw_path: str) -> Path:
    """
    Resolve and validate the speaker reference WAV path.

    Raises HTTPException for:
    - path traversal attempts
    - non-existent files
    - non-.wav extensions (XTTS-v2 requires WAV input for the reference)
    """
    try:
        resolved = Path(raw_path).resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Speaker reference file not found: {raw_path}",
        ) from exc

    if not is_safe_path(resolved, SPEAKER_WAV_ROOT):
        log.warning("Path traversal attempt blocked: %s", raw_path)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to the specified speaker reference path is restricted.",
        )

    if resolved.suffix.lower() not in {".wav", ".wave"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="speaker_wav_path must point to a .wav file.",
        )

    return resolved


def _unique_output_path() -> Path:
    """Return a unique output WAV path inside OUTPUT_DIR."""
    return OUTPUT_DIR / f"{uuid.uuid4().hex}.wav"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["ops"])
async def health() -> dict[str, str]:
    """Liveness probe — returns 200 once the model is ready."""
    if app.state.tts is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS model not loaded yet.",
        )
    return {"status": "ok", "model": "xtts_v2", "device": TTS_DEVICE}


@app.post(
    "/synthesize",
    summary="Clone a voice and synthesise speech",
    tags=["tts"],
    responses={
        200: {
            "description": (
                "Returns a WAV audio stream (when STREAM_RESPONSE=true) "
                "or a JSON object with the saved file path."
            )
        }
    },
)
async def synthesize(request: SynthesisRequest):
    """
    Generate speech from `text` using the voice cloned from
    `speaker_wav_path`.

    **Behaviour is controlled by the `TTS_STREAM_RESPONSE` env var:**
    - `true` (default) → returns the WAV as a streaming `audio/wav` response.
    - `false`          → writes the file to disk and returns a JSON
                         `{ "output_path": "..." }`.

    The reference WAV should be:
    - 3–30 seconds of clean, single-speaker speech
    - Recorded at ≥ 22 050 Hz
    - Free of heavy background noise
    """
    if app.state.tts is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS model is not available.",
        )

    # ── Validate speaker reference ────────────────────────────────────────
    speaker_wav = _resolve_speaker_wav(request.speaker_wav_path)

    log.info(
        "Synthesising: lang=%s  chars=%d  speaker=%s",
        request.language,
        len(request.text),
        speaker_wav.name,
    )

    # ── Run synthesis ─────────────────────────────────────────────────────
    # XTTS-v2's tts_to_file() is synchronous and CPU/GPU bound.
    # For a production service with concurrent users, consider running this
    # in a ProcessPoolExecutor to avoid blocking the event loop.
    output_path = _unique_output_path()

    try:
        app.state.tts.tts_to_file(
            text=request.text,
            speaker_wav=str(speaker_wav),
            language=request.language,
            file_path=str(output_path),
            # split_sentences=True lets the model handle long texts by
            # synthesising sentence-by-sentence and concatenating — this
            # produces significantly better prosody for multi-sentence input.
            split_sentences=True,
        )
    except Exception as exc:
        log.error("Synthesis failed: %s", exc, exc_info=True)
        # Clean up any partial output before re-raising.
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"TTS synthesis error: {exc}",
        ) from exc

    log.info("Synthesis complete: output=%s  size=%d bytes", output_path, output_path.stat().st_size)

    # ── Return the result ─────────────────────────────────────────────────
    if STREAM_RESPONSE:
        return _stream_wav_and_delete(output_path)

    # Non-streaming path: return the file path so the caller can fetch it
    # separately or the Node.js backend can serve it directly.
    return SynthesisPathResponse(output_path=str(output_path))


def _stream_wav_and_delete(path: Path) -> StreamingResponse:
    """
    Read the WAV into memory, schedule the temp file for deletion, and
    return it as a streaming audio/wav response.

    Reading into memory first (rather than streaming from disk) lets us
    delete the temp file immediately so OUTPUT_DIR doesn't fill up.
    For very large files you may prefer to stream from disk instead.
    """
    audio_bytes = path.read_bytes()
    path.unlink(missing_ok=True)  # clean up immediately after reading

    return StreamingResponse(
        content=io.BytesIO(audio_bytes),
        media_type="audio/wav",
        headers={
            # Hint the filename so browsers / downstream clients can save it.
            "Content-Disposition": 'attachment; filename="synthesized.wav"',
            "Content-Length": str(len(audio_bytes)),
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "tts_server:app",
        host="0.0.0.0",
        port=8002,
        reload=False,   # set True for local dev
        workers=1,      # keep at 1; the GPU model is not fork-safe
    )
