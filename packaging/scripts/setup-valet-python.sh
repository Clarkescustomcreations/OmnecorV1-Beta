#!/usr/bin/env bash
# ==============================================================================
# Omnecor — Valet Router Python environment provisioner (Linux / macOS)
# ==============================================================================
#
# Creates an isolated Python venv that the Valet Router inference server uses.
# ValetServerService auto-detects this venv at ~/.omnecor/valet-venv (see its
# _resolvePythonBin), so after running this the local Valet inference server
# starts automatically on next launch — no env vars needed.
#
# Base deps (fastapi/uvicorn/pydantic) are pure-wheel installs (no compiler).
# The GGUF backend (llama-cpp-python) is OPTIONAL and built best-effort: if it
# fails (no C/C++ toolchain) the server still runs and routes via Ollama /
# transformers / the rule-based keyword fallback.
#
# Usage:
#   packaging/scripts/setup-valet-python.sh
#   VALET_INSTALL_GGUF=0 packaging/scripts/setup-valet-python.sh   # skip GGUF
# ==============================================================================

set -uo pipefail

VENV_DIR="${VALET_VENV_DIR:-$HOME/.omnecor/valet-venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "[valet-setup] Target venv: $VENV_DIR"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[valet-setup] ERROR: '$PYTHON_BIN' not found. Install Python 3.10+ and re-run." >&2
  exit 1
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "[valet-setup] Creating venv..."
  if ! "$PYTHON_BIN" -m venv "$VENV_DIR"; then
    echo "[valet-setup] ERROR: venv creation failed (on Debian/Ubuntu: apt install python3-venv)." >&2
    exit 1
  fi
fi

VPY="$VENV_DIR/bin/python"
"$VPY" -m pip install --upgrade pip >/dev/null 2>&1 || true

echo "[valet-setup] Installing base inference deps (fastapi, uvicorn, pydantic)..."
if ! "$VPY" -m pip install "fastapi>=0.110" "uvicorn>=0.29" "pydantic>=2.6"; then
  echo "[valet-setup] ERROR: failed to install base deps." >&2
  exit 1
fi

if [ "${VALET_INSTALL_GGUF:-1}" = "1" ]; then
  echo "[valet-setup] Installing optional GGUF backend (llama-cpp-python) — best-effort..."
  if ! "$VPY" -m pip install "llama-cpp-python>=0.2.79"; then
    echo "[valet-setup] NOTE: llama-cpp-python build failed — GGUF backend unavailable."
    echo "[valet-setup]       The server will route via Ollama / transformers / rule-based"
    echo "[valet-setup]       fallback. Install a C/C++ toolchain (build-essential) to enable it."
  fi
fi

echo "[valet-setup] Done. ValetServerService will auto-detect: $VPY"
