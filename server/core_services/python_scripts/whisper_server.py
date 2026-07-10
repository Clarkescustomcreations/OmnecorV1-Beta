"""
whisper_server.py  —  Omnecor · Real-Time Transcription Microservice
=====================================================================
Loads a faster-whisper model once at startup and exposes a single
POST /transcribe endpoint that accepts an uploaded audio file and
returns full transcription text plus word-level timestamps.

Dependencies:
    pip install fastapi uvicorn python-multipart faster-whisper

Run:
    uvicorn whisper_server:app --host 0.0.0.0 --port 8001 --reload
"""

import io
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from faster_whisper import WhisperModel
from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
log = logging.getLogger("omnecor.whisper")

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------

SOVEREIGN_MODE = os.environ.get("SOVEREIGN_MODE", "false").lower() == "true"

# Model size: "tiny", "base", "small", "medium", "large-v2", "large-v3"
# Larger models are more accurate but slower and use more VRAM.
WHISPER_MODEL_SIZE: str = os.getenv("WHISPER_MODEL_SIZE", "base")

# Compute type: "int8" (CPU-friendly), "float16" (GPU), "float32" (CPU precise)
WHISPER_COMPUTE_TYPE: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

# Device: "cpu" or "cuda"
WHISPER_DEVICE: str = os.getenv("WHISPER_DEVICE", "cpu")

# Maximum accepted upload size in bytes (default: 100 MB)
MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))

# Allowed audio MIME types
ALLOWED_CONTENT_TYPES: frozenset[str] = frozenset(
    {
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/ogg",
        "audio/flac",
        "audio/webm",
        "application/octet-stream",  # browsers sometimes send this for blobs
    }
)

# ---------------------------------------------------------------------------
# Application state  (attached to app.state for thread-safety with lifespan)
# ---------------------------------------------------------------------------

class AppState:
    model: WhisperModel | None = None


# ---------------------------------------------------------------------------
# Lifespan — load model once, unload on shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the Whisper model into memory before the server starts accepting
    requests, then cleanly release it when the process shuts down."""
    log.info(
        "Loading faster-whisper model  [size=%s  device=%s  compute=%s]",
        WHISPER_MODEL_SIZE,
        WHISPER_DEVICE,
        WHISPER_COMPUTE_TYPE,
    )
    try:
        app.state.model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        log.info("Whisper model loaded successfully.")
    except Exception as exc:
        log.critical("Failed to load Whisper model: %s", exc, exc_info=True)
        raise RuntimeError("Whisper model could not be loaded") from exc

    yield  # ← server is live here

    log.info("Shutting down — releasing Whisper model.")
    app.state.model = None


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Omnecor Transcription Service",
    description="Real-time speech-to-text powered by faster-whisper.",
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
# Response schema
# ---------------------------------------------------------------------------

class WordTimestamp(BaseModel):
    word: str
    start: float   # seconds from audio start
    end: float     # seconds from audio start
    probability: float  # model confidence [0, 1]


class SegmentResult(BaseModel):
    id: int
    start: float
    end: float
    text: str
    words: list[WordTimestamp]


class TranscriptionResponse(BaseModel):
    text: str                     # full concatenated transcript
    language: str                 # detected language code, e.g. "en"
    language_probability: float   # detection confidence
    duration: float               # audio duration in seconds
    segments: list[SegmentResult] # segment-level breakdown with word timestamps


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _validate_upload(file: UploadFile, raw_bytes: bytes) -> None:
    """Raise HTTPException for oversized or obviously non-audio uploads."""
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported audio type '{content_type}'.",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["ops"])
async def health() -> dict[str, str]:
    """Liveness probe — returns 200 when the model is ready."""
    if app.state.model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model not loaded yet.",
        )
    return {"status": "ok", "model": WHISPER_MODEL_SIZE}


@app.post(
    "/transcribe",
    response_model=TranscriptionResponse,
    summary="Transcribe an audio file",
    tags=["transcription"],
)
async def transcribe(
    file: UploadFile = File(..., description="Audio file to transcribe"),
) -> TranscriptionResponse:
    """
    Accept an uploaded audio file and return:
    - `text`       — full transcript
    - `language`   — detected language
    - `segments`   — list of segments, each with `words` containing
                     start/end/probability for every word

    Supports WAV, MP3, MP4, OGG, FLAC, WebM, and most formats
    that ffmpeg can decode.
    """
    if app.state.model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transcription model is not available.",
        )

    # ── Read upload into memory ──────────────────────────────────────────
    try:
        raw_bytes: bytes = await file.read()
    except Exception as exc:
        log.error("Failed to read uploaded file: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read the uploaded file.",
        ) from exc

    _validate_upload(file, raw_bytes)
    log.info("Received audio: filename=%s  size=%d bytes", file.filename, len(raw_bytes))

    # ── Write to a temporary file so faster-whisper / ffmpeg can open it ─
    # faster-whisper delegates decoding to ffmpeg which needs a file path,
    # not a raw BytesIO buffer.
    suffix = os.path.splitext(file.filename or ".wav")[1] or ".wav"

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw_bytes)
            tmp_path = tmp.name

        # ── Transcription ─────────────────────────────────────────────────
        # word_timestamps=True asks the model to align each word;
        # vad_filter=True uses voice-activity detection to skip silence.
        segments_iter, info = app.state.model.transcribe(
            tmp_path,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            # Repetition guards. On short/brief utterances faster-whisper can
            # hallucinate a duplicated transcript (e.g. the same sentence twice);
            # disabling cross-segment conditioning and blocking repeated 3-grams
            # suppresses that without hurting normal speech. (Verified live
            # 2026-07-03 — a 10 s clip transcribed as its sentence twice.)
            condition_on_previous_text=False,
            no_repeat_ngram_size=3,
        )

        # Materialise the lazy generator — this is where inference runs.
        segments_raw = list(segments_iter)

    except Exception as exc:
        log.error("Transcription failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription error: {exc}",
        ) from exc

    finally:
        # Always remove the temp file, even on error.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # ── Build the structured response ─────────────────────────────────────
    segments_out: list[SegmentResult] = []
    full_text_parts: list[str] = []

    for seg in segments_raw:
        full_text_parts.append(seg.text.strip())

        words_out: list[WordTimestamp] = []
        # `seg.words` is None when the segment contains only non-speech;
        # guard against that and against models that don't emit word data.
        for w in seg.words or []:
            words_out.append(
                WordTimestamp(
                    word=w.word,
                    start=round(w.start, 3),
                    end=round(w.end, 3),
                    probability=round(w.probability, 4),
                )
            )

        segments_out.append(
            SegmentResult(
                id=seg.id,
                start=round(seg.start, 3),
                end=round(seg.end, 3),
                text=seg.text.strip(),
                words=words_out,
            )
        )

    full_text = " ".join(full_text_parts)
    log.info(
        "Transcription complete: lang=%s(%.2f)  duration=%.1fs  chars=%d",
        info.language,
        info.language_probability,
        info.duration,
        len(full_text),
    )

    return TranscriptionResponse(
        text=full_text,
        language=info.language,
        language_probability=round(info.language_probability, 4),
        duration=round(info.duration, 3),
        segments=segments_out,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "whisper_server:app",
        host="0.0.0.0",
        port=8001,
        reload=False,   # set True for local dev
        workers=1,      # keep at 1; the model is not fork-safe across workers
    )
