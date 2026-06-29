# ============================================================
# File: flash_mcu.py
# Purpose:
#   CLI wrapper around esptool.py for flashing ESP MCUs.
#
# Features:
#   - Accepts CLI args:
#       --port
#       --baud
#       --firmware_path
#   - Executes esptool.py via subprocess
#   - Streams stdout/stderr in real-time
#   - Emits JSON lines for Node.js parsing
#
# Example:
#   python flash_mcu.py \
#       --port COM3 \
#       --baud 921600 \
#       --firmware_path firmware.bin
# ============================================================

import argparse
import json
import subprocess
import sys
import threading


def emit(event_type, message):
    """
    Print a JSON line immediately so the Node.js backend
    can parse progress in real-time.
    """
    payload = {
        "type": event_type,
        "message": message.strip()
    }

    print(json.dumps(payload), flush=True)


def stream_reader(stream, stream_type):
    """
    Read subprocess output line-by-line and emit JSON.
    """
    for line in iter(stream.readline, ''):
        if line:
            emit(stream_type, line)

    stream.close()


def main():
    parser = argparse.ArgumentParser(description="ESPTool Flash Wrapper")

    parser.add_argument(
        "--port",
        required=True,
        help="Serial port (e.g. COM3 or /dev/ttyUSB0)"
    )

    parser.add_argument(
        "--baud",
        required=True,
        help="Baud rate (e.g. 115200)"
    )

    parser.add_argument(
        "--firmware_path",
        required=True,
        help="Path to firmware binary"
    )

    args = parser.parse_args()

    # Construct esptool command
    # Modify flash address if needed for your MCU/platform.
    command = [
        sys.executable,
        "-m",
        "esptool",
        "--chip",
        "esp32",
        "--port",
        args.port,
        "--baud",
        str(args.baud),
        "write_flash",
        "0x1000",
        args.firmware_path
    ]

    emit("info", "Starting firmware flash process")

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        # Read stdout/stderr concurrently
        stdout_thread = threading.Thread(
            target=stream_reader,
            args=(process.stdout, "stdout")
        )

        stderr_thread = threading.Thread(
            target=stream_reader,
            args=(process.stderr, "stderr")
        )

        stdout_thread.start()
        stderr_thread.start()

        # Wait for process to finish
        process.wait()

        stdout_thread.join()
        stderr_thread.join()

        if process.returncode == 0:
            emit("success", "Firmware flashing completed successfully")
        else:
            emit(
                "error",
                f"Firmware flashing failed with exit code {process.returncode}"
            )

        sys.exit(process.returncode)

    except Exception as e:
        emit("exception", str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
