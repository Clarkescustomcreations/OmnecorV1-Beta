"""
podcast_engine.py — Omnecor · Local Podcast & Dialogue Orchestration
===================================================================
Spawned by LocalPodcastService.generatePodcast() with config JSON on stdin.
Calls the local TTS server (port 8002) for each dialogue turn, stitches the
resulting WAV segments with a short silence gap, and writes the final master
to disk.  Prints a single JSON result line to stdout on success.

TTS server contract (port 8002 / XTTS-v2 or Kokoro):
  POST /synthesize  { text, speaker_wav_path, language, engine }
  → Content-Type: audio/wav (bytes) OR application/json { audio_path }

Fallback: when the TTS server is unreachable, each segment is written as
300 ms of silence so the stitching + metadata pipeline still works.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import soundfile as sf

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("omnecor.podcast")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TTS_BASE = os.environ.get("TTS_SERVER_URL", "http://127.0.0.1:8002")
TTS_SILENCE_SR = 44100
SILENCE_GAP_S = 0.25          # quarter-second gap between turns
TTS_TIMEOUT_S = 60.0           # per-turn synthesis timeout


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_silence(seconds: float, sr: int = TTS_SILENCE_SR) -> np.ndarray:
    return np.zeros(int(sr * seconds), dtype=np.float32)


async def _synthesize_turn(
    client: httpx.AsyncClient,
    text: str,
    speaker_wav: str | None,
    emotion: str,
    index: int,
    output_dir: Path,
) -> Path:
    """Call TTS server for one dialogue turn; fall back to silence on error."""
    segment_path = output_dir / f"segment_{index:03d}.wav"

    payload: dict[str, Any] = {
        "text": text,
        "language": "en",
    }
    if speaker_wav:
        payload["speaker_wav_path"] = speaker_wav
        payload["engine"] = "xtts"
    else:
        payload["speaker_wav_path"] = "default.wav"
        payload["engine"] = "kokoro"

    # Map emotion tags understood by XTTS / Kokoro
    if emotion and emotion != "neutral":
        payload["emotion"] = emotion

    try:
        resp = await client.post(
            f"{TTS_BASE}/synthesize",
            json=payload,
            timeout=TTS_TIMEOUT_S,
        )
        resp.raise_for_status()

        ct = resp.headers.get("content-type", "")
        if "audio/" in ct:
            segment_path.write_bytes(resp.content)
            log.info("Turn %d synthesized (%d bytes)", index, len(resp.content))
        else:
            data = resp.json()
            src = Path(data.get("audio_path") or data.get("audioPath", ""))
            if src.exists():
                import shutil
                shutil.copy(src, segment_path)
            else:
                log.warning("Turn %d: audio_path %s not found — using silence", index, src)
                sf.write(segment_path, _make_silence(1.5), TTS_SILENCE_SR)
    except Exception as exc:  # noqa: BLE001
        log.warning("Turn %d synthesis failed (%s) — using silence", index, exc)
        sf.write(segment_path, _make_silence(1.5), TTS_SILENCE_SR)

    return segment_path


def _stitch(segment_paths: list[Path], output_path: Path) -> float:
    """Concatenate WAV segments with silence gaps; return total duration in seconds."""
    arrays: list[np.ndarray] = []
    sr = TTS_SILENCE_SR
    gap = _make_silence(SILENCE_GAP_S, sr)

    for i, seg in enumerate(segment_paths):
        try:
            data, file_sr = sf.read(str(seg), dtype="float32", always_2d=False)
            if data.ndim > 1:
                data = data.mean(axis=1)   # stereo → mono
            if file_sr != sr:
                # simple nearest-neighbour resample to target sr
                ratio = sr / file_sr
                new_len = int(len(data) * ratio)
                data = np.interp(
                    np.linspace(0, len(data) - 1, new_len),
                    np.arange(len(data)),
                    data,
                ).astype(np.float32)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not read %s (%s) — substituting silence", seg, exc)
            data = _make_silence(1.5, sr)

        arrays.append(data)
        if i < len(segment_paths) - 1:
            arrays.append(gap)

    master = np.concatenate(arrays) if arrays else np.zeros(sr, dtype=np.float32)
    sf.write(str(output_path), master, sr)
    return float(len(master) / sr)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class PodcastOrchestrator:
    def __init__(self, output_dir: str) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def build_podcast(self, config: dict[str, Any]) -> dict[str, Any]:
        title = config.get("title", "Untitled Podcast")
        turns: list[dict[str, Any]] = config.get("turns", [])
        job_id = config.get("jobId", str(uuid.uuid4()))

        log.info("Building podcast '%s' with %d turns", title, len(turns))

        async with httpx.AsyncClient() as client:
            tasks = [
                _synthesize_turn(
                    client=client,
                    text=turn.get("text", ""),
                    speaker_wav=turn.get("referenceWav") or turn.get("speaker_wav_path"),
                    emotion=turn.get("emotion", "neutral"),
                    index=i,
                    output_dir=self.output_dir,
                )
                for i, turn in enumerate(turns)
            ]
            segment_paths = await asyncio.gather(*tasks)

        master_path = self.output_dir / "podcast_master.wav"
        duration = _stitch(list(segment_paths), master_path)

        segments = [
            {
                "speaker": turns[i].get("speakerId", f"speaker_{i}"),
                "text": turns[i].get("text", ""),
                "path": str(segment_paths[i]),
                "audioUrl": None,
            }
            for i in range(len(turns))
        ]

        return {
            "jobId": job_id,
            "audioPath": str(master_path),
            "duration": round(duration, 2),
            "segments": segments,
        }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"error": "no config provided"}), flush=True)
        sys.exit(1)

    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON: {exc}"}), flush=True)
        sys.exit(1)

    temp_dir = config.get("temp_dir", os.path.join(
        os.environ.get("HOME", "/tmp"), ".omnecor", "podcasts",
        config.get("jobId", str(uuid.uuid4())),
    ))
    orchestrator = PodcastOrchestrator(temp_dir)
    result = await orchestrator.build_podcast(config)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
