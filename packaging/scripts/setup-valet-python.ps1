# ==============================================================================
# Omnecor - Valet Router Python environment provisioner (Windows)
# ==============================================================================
#
# Creates an isolated Python venv that the Valet Router inference server uses.
# ValetServerService auto-detects this venv at %USERPROFILE%\.omnecor\valet-venv
# (see its _resolvePythonBin), so after running this the local Valet inference
# server starts automatically on next launch - no env vars needed.
#
# Base deps (fastapi/uvicorn/pydantic) are pure-wheel installs (no compiler).
# The GGUF backend (llama-cpp-python) is OPTIONAL and built best-effort: if it
# fails (no MSVC build tools) the server still runs and routes via Ollama /
# transformers / the rule-based keyword fallback.
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File packaging\scripts\setup-valet-python.ps1
#   $env:VALET_INSTALL_GGUF="0"; .\packaging\scripts\setup-valet-python.ps1   # skip GGUF
# ==============================================================================

$ErrorActionPreference = "Stop"

$VenvDir = if ($env:VALET_VENV_DIR) { $env:VALET_VENV_DIR } else { Join-Path $env:USERPROFILE ".omnecor\valet-venv" }
$PythonBin = if ($env:PYTHON_BIN) { $env:PYTHON_BIN } else { "python" }

Write-Host "[valet-setup] Target venv: $VenvDir"

if (-not (Get-Command $PythonBin -ErrorAction SilentlyContinue)) {
    Write-Error "[valet-setup] '$PythonBin' not found. Install Python 3.10+ (python.org) and re-run."
    exit 1
}

$VPy = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $VPy)) {
    Write-Host "[valet-setup] Creating venv..."
    & $PythonBin -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { Write-Error "[valet-setup] venv creation failed."; exit 1 }
}

& $VPy -m pip install --upgrade pip | Out-Null

Write-Host "[valet-setup] Installing base inference deps (fastapi, uvicorn, pydantic)..."
& $VPy -m pip install "fastapi>=0.110" "uvicorn>=0.29" "pydantic>=2.6"
if ($LASTEXITCODE -ne 0) { Write-Error "[valet-setup] failed to install base deps."; exit 1 }

$InstallGguf = if ($null -ne $env:VALET_INSTALL_GGUF) { $env:VALET_INSTALL_GGUF } else { "1" }
if ($InstallGguf -eq "1") {
    Write-Host "[valet-setup] Installing optional GGUF backend (llama-cpp-python) - best-effort..."
    & $VPy -m pip install "llama-cpp-python>=0.2.79"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[valet-setup] NOTE: llama-cpp-python build failed - GGUF backend unavailable."
        Write-Host "[valet-setup]       The server will route via Ollama / transformers / rule-based"
        Write-Host "[valet-setup]       fallback. Install MSVC Build Tools to enable it."
    }
}

Write-Host "[valet-setup] Done. ValetServerService will auto-detect: $VPy"
