# ============================================================
# File: blender_bridge.py
# Purpose:
#   Blender background-mode bridge for Omnecor.
#
# Usage:
#   blender -b -P blender_bridge.py -- \
#       --action render \
#       --filepath scene.blend
#
# Example Actions:
#   render
#   run_script
#   export_gltf
#
# Features:
#   - Executes inside Blender using bpy
#   - Strict JSON stdout responses
#   - Safe exception handling
#   - Node.js friendly
# ============================================================

import bpy
import argparse
import json
import os
import sys
import traceback


# ============================================================
# JSON Response Helper
# ============================================================

def emit_json(payload):
    """
    Emit strict JSON output for Node.js parsing.
    """
    print(json.dumps(payload), flush=True)


# ============================================================
# Parse Blender CLI Arguments
# Blender requires custom args after '--'
# ============================================================

def parse_args():
    argv = sys.argv

    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(
        description="Omnecor Blender Bridge"
    )

    parser.add_argument(
        "--action",
        required=True,
        choices=["render", "run_script", "export_gltf"],
        help="Action to perform"
    )

    parser.add_argument(
        "--filepath",
        required=False,
        help="Blend file or export destination"
    )

    parser.add_argument(
        "--script_path",
        required=False,
        help="External Python script to execute"
    )

    return parser.parse_args(argv)


# ============================================================
# Blender Actions
# ============================================================

def open_blend_file(filepath):
    """
    Open a .blend file.
    """
    if filepath and filepath.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=filepath)


def render_scene(filepath):
    """
    Render current Blender scene.
    """
    output_path = os.path.abspath(filepath or "render.png")

    bpy.context.scene.render.filepath = output_path

    bpy.ops.render.render(write_still=True)

    return output_path


def run_external_script(script_path):
    """
    Execute an external Python script
    inside Blender's Python environment.
    """
    base_dir = os.path.abspath(os.getenv("ALLOWED_SCRIPTS_DIR", "scripts/blender"))
    abs_path = os.path.abspath(script_path)

    if not abs_path.startswith(base_dir):
        raise PermissionError("Script path outside allowed directory")

    if not abs_path.endswith(".py"):
        raise ValueError("Only .py scripts allowed")

    if not os.path.exists(abs_path):
        raise FileNotFoundError(
            f"Script not found: {abs_path}"
        )

    with open(abs_path, "r", encoding="utf-8") as f:
        script_code = f.read()

    restricted_globals = {"bpy": bpy, "__name__": "__main__", "__builtins__": {}}
    exec(script_code, restricted_globals)


def export_gltf(filepath):
    """
    Export current scene as glTF.
    """
    export_path = os.path.abspath(filepath or "scene.glb")

    bpy.ops.export_scene.gltf(
        filepath=export_path,
        export_format='GLB'
    )

    return export_path


# ============================================================
# Main Entry Point
# ============================================================

def main():
    args = parse_args()

    try:
        # Optional .blend loading
        if args.filepath and args.filepath.endswith(".blend"):
            open_blend_file(args.filepath)

        # ====================================================
        # Action: Render
        # ====================================================
        if args.action == "render":
            output_file = render_scene("render_output.png")

            emit_json({
                "status": "success",
                "action": "render",
                "output_file": output_file
            })

        # ====================================================
        # Action: Run External Script
        # ====================================================
        elif args.action == "run_script":
            if not args.script_path:
                raise ValueError(
                    "--script_path is required for run_script"
                )

            run_external_script(args.script_path)

            emit_json({
                "status": "success",
                "action": "run_script",
                "script": os.path.abspath(args.script_path)
            })

        # ====================================================
        # Action: Export glTF
        # ====================================================
        elif args.action == "export_gltf":
            output_file = export_gltf(
                args.filepath or "scene.glb"
            )

            emit_json({
                "status": "success",
                "action": "export_gltf",
                "output_file": output_file
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
