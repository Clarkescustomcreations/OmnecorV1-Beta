import platform
import subprocess
import sys
import json


def detect_gpu():
    system = platform.system()
    gpus = []

    # Try NVIDIA first (works on all platforms with NVIDIA drivers)
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            for line in result.stdout.strip().split('\n'):
                parts = [p.strip() for p in line.split(',')]
                if parts:
                    gpus.append({"vendor": "nvidia", "name": parts[0],
                                 "vram": parts[1] if len(parts) > 1 else "unknown",
                                 "driver": parts[2] if len(parts) > 2 else "unknown"})
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # AMD ROCm (Linux)
    if system == "Linux" and not gpus:
        try:
            result = subprocess.run(["rocm-smi", "--showproductname"],
                                    capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and result.stdout.strip():
                gpus.append({"vendor": "amd", "name": result.stdout.strip(),
                             "vram": "unknown", "driver": "rocm"})
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    # Windows: wmic or PowerShell
    if system == "Windows" and not gpus:
        try:
            result = subprocess.run(
                ["powershell", "-Command",
                 "Get-WmiObject Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0 and result.stdout.strip():
                import json as _json
                data = _json.loads(result.stdout)
                if isinstance(data, dict):
                    data = [data]
                for item in data:
                    name = item.get("Name", "Unknown GPU")
                    ram_bytes = item.get("AdapterRAM", 0) or 0
                    vram_mb = f"{ram_bytes // (1024*1024)} MiB"
                    gpus.append({"vendor": "unknown", "name": name,
                                 "vram": vram_mb, "driver": item.get("DriverVersion", "unknown")})
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            pass

    # macOS: system_profiler
    if system == "Darwin" and not gpus:
        try:
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType", "-json"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0:
                import json as _json
                data = _json.loads(result.stdout)
                displays = data.get("SPDisplaysDataType", [])
                for display in displays:
                    name = display.get("sppci_model", display.get("_name", "Apple GPU"))
                    vram = display.get("spdisplays_vram", "unknown")
                    gpus.append({"vendor": "apple", "name": name,
                                 "vram": vram, "driver": "Metal"})
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            pass

    return gpus


if __name__ == "__main__":
    result = detect_gpu()
    print(json.dumps(result))
