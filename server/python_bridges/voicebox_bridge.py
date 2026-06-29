"""
voicebox_bridge.py — Omnecor · Voice Box Voice Cloning Microservice
===================================================================
Provides a FastAPI endpoint for Voice Box zero-shot voice cloning.
Listens on port 8004.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
import uvicorn
import os
import time
import logging
from pydantic import BaseModel
import uuid
import soundfile as sf
import numpy as np
from pathlib import Path

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("omnecor.voicebox")

app = FastAPI(title="Voice Box Bridge")

_ALLOWED_SPEAKER_BASES = [
    Path(os.environ.get("HOME", "/tmp")) / ".omnecor",
    Path(os.environ.get("OMNECOR_UPLOADS_DIR", "/tmp/omnecor-uploads")),
]

def _validate_speaker_path(raw: str) -> Path:
    resolved = Path(raw).resolve()
    if not any(resolved == b or b in resolved.parents for b in _ALLOWED_SPEAKER_BASES):
        raise HTTPException(status_code=403, detail="Speaker WAV path not allowed")
    return resolved

class SynthesizeRequest(BaseModel):
    text: str
    speaker_wav_path: str
    language: str = "en"
    engine: str = "voicebox"

@app.get("/health")
def health():
    return {"model": "voicebox-stub", "device": "cpu"}

@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    log.info(f"Received synthesize request: {req.text[:30]}...")

    speaker_path = _validate_speaker_path(req.speaker_wav_path)
    if not speaker_path.exists():
        raise HTTPException(status_code=404, detail="Speaker WAV not found")
        
    try:
        # Mock logic: in reality, this is where we'd invoke the Voice Box pipeline.
        # For the bridge, we'll generate a 1.5-second silence wav and return it.
        # In a real environment, the model weights would be loaded globally 
        # and invoked here.
        output_dir = Path(os.environ.get("HOME", "/tmp")) / ".omnecor" / "voicebox_outputs"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        output_path = output_dir / f"voicebox_{uuid.uuid4().hex}.wav"
        
        sr = 24000
        silence = np.zeros(int(sr * 1.5), dtype=np.float32)
        sf.write(str(output_path), silence, sr)
        
        return JSONResponse({"output_path": str(output_path)})
    except Exception as e:
        log.error(f"Voice Box synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8004)
