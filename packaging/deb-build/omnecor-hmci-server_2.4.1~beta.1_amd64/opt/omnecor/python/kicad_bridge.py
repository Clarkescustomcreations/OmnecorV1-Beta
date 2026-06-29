# ============================================================
# File: kicad_bridge.py
# Purpose:
#   CLI wrapper around kicad-cli for Omnecor.
#
# Features:
#   - Executes KiCad CLI actions
#   - Parses DRC errors
#   - Returns strict JSON responses
#   - Node.js backend compatible
#
# Supported Actions:
#   - drc
#   - export_step
#   - export_bom
#
# Example:
#   python kicad_bridge.py \
#       --action drc \
#       --project_path board.kicad_pcb
# ============================================================

import argparse
import json
import os
import re
import subprocess
import sys
import traceback


# ============================================================
# JSON Output Helper
# ============================================================

def emit_json(payload):
    """
    Emit strict JSON for backend parsing.
    """
    print(json.dumps(payload), flush=True)


# ============================================================
# Parse CLI Arguments
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description="Omnecor KiCad CLI Bridge"
    )

    parser.add_argument(
        "--action",
        required=True,
        choices=["drc", "export_step", "export_bom"],
        help="KiCad action"
    )

    parser.add_argument(
        "--project_path",
        required=True,
        help="Path to KiCad project or PCB"
    )

    return parser.parse_args()


# ============================================================
# DRC Error Parser
# ============================================================

def parse_drc_errors(output):
    """
    Parse DRC violations from KiCad output.

    Returns:
        List[dict]
    """
    errors = []

    lines = output.splitlines()

    for line in lines:
        # Example generic detection
        if "error" in line.lower():
            errors.append({
                "type": "error",
                "message": line.strip()
            })

        elif "warning" in line.lower():
            errors.append({
                "type": "warning",
                "message": line.strip()
            })

    return errors


# ============================================================
# Run KiCad CLI Command
# ============================================================

def run_command(command):
    """
    Execute subprocess command safely.
    """
    process = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    return {
        "returncode": process.returncode,
        "stdout": process.stdout,
        "stderr": process.stderr
    }


# ============================================================
# Main Logic
# ============================================================

def main():
    args = parse_args()

    project_path = os.path.abspath(args.project_path)

    try:

        # ====================================================
        # Action: DRC
        # ====================================================
        if args.action == "drc":

            command = [
                "kicad-cli",
                "pcb",
                "drc",
                project_path
            ]

            result = run_command(command)

            drc_errors = parse_drc_errors(
                result["stdout"] + "\n" + result["stderr"]
            )

            emit_json({
                "status": (
                    "success"
                    if result["returncode"] == 0
                    else "failure"
                ),
                "action": "drc",
                "returncode": result["returncode"],
                "errors": drc_errors,
                "stdout": result["stdout"],
                "stderr": result["stderr"]
            })

        # ====================================================
        # Action: Export STEP
        # ====================================================
        elif args.action == "export_step":

            output_file = os.path.splitext(
                project_path
            )[0] + ".step"

            command = [
                "kicad-cli",
                "pcb",
                "export",
                "step",
                "-o",
                output_file,
                project_path
            ]

            result = run_command(command)

            emit_json({
                "status": (
                    "success"
                    if result["returncode"] == 0
                    else "failure"
                ),
                "action": "export_step",
                "output_file": output_file,
                "stdout": result["stdout"],
                "stderr": result["stderr"]
            })

        # ====================================================
        # Action: Export BOM
        # ====================================================
        elif args.action == "export_bom":

            output_file = os.path.splitext(
                project_path
            )[0] + "_bom.csv"

            command = [
                "kicad-cli",
                "sch",
                "export",
                "bom",
                "-o",
                output_file,
                project_path
            ]

            result = run_command(command)

            emit_json({
                "status": (
                    "success"
                    if result["returncode"] == 0
                    else "failure"
                ),
                "action": "export_bom",
                "output_file": output_file,
                "stdout": result["stdout"],
                "stderr": result["stderr"]
            })

        else:
            raise ValueError(
                f"Unsupported action: {args.action}"
            )

    except Exception as e:
        emit_json({
            "status": "error",
            "message": str(e),
            "traceback": traceback.format_exc()
        })

        sys.exit(1)


if __name__ == "__main__":
    main()
