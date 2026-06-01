#!/usr/bin/env python3
"""GPU detection — writes OLLAMA_NUM_GPU_LAYERS to /opt/omnecor/.env.gpu"""
import subprocess
import os
import re

GPU_ENV_FILE = "/opt/omnecor/.env.gpu"

VRAM_TIERS = [
    (24 * 1024, 64),
    (16 * 1024, 48),
    (8 * 1024, 35),
    (4 * 1024, 20),
    (0, 0),
]


def vram_to_layers(vram_mb: int) -> int:
    for threshold, layers in VRAM_TIERS:
        if vram_mb >= threshold:
            return layers
    return 0


def detect_nvidia():
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0 and r.stdout.strip():
            parts = r.stdout.strip().split(",")
            name = parts[0].strip()
            vram_mb = int(parts[1].strip())
            return name, vram_mb
    except Exception:
        pass
    return None


def detect_amd():
    try:
        r = subprocess.run(
            ["rocm-smi", "--showmeminfo", "VRAM"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            match = re.search(r"Total Memory.*?:\s*(\d+)", r.stdout)
            if match:
                vram_bytes = int(match.group(1))
                return "AMD GPU", vram_bytes // (1024 * 1024)
    except Exception:
        pass
    return None


def write_env(layers: int):
    os.makedirs(os.path.dirname(GPU_ENV_FILE), exist_ok=True)
    with open(GPU_ENV_FILE, "w") as f:
        f.write(f"OLLAMA_NUM_GPU_LAYERS={layers}\n")


def main():
    gpu_info = detect_nvidia() or detect_amd()
    if gpu_info:
        name, vram_mb = gpu_info
        layers = vram_to_layers(vram_mb)
        print(f"GPU detected: {name} ({vram_mb} MB VRAM) -> {layers} GPU layers")
        write_env(layers)
    else:
        print("No GPU detected -> OLLAMA_NUM_GPU_LAYERS=0")
        write_env(0)


if __name__ == "__main__":
    main()
