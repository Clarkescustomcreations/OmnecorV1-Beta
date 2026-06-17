# 3D Designer & PCB Viewer Workspace Guide

This guide explains how to use the **3D Designer** page (`/3d-designer`), its 4 integrated workspace modes, and its native desktop application bridges.

The 3D Designer is a standalone workspace that connects hardware engineering, 3D modeling, interactive web previews, and code editing in a unified view.

---

## 1. The Four Workspace Modes

The workspace is split into four panels. You can focus on one mode, customize the layout, or detach a panel into a floating window.

### 1.1. 3D Viewer Mode (React Three Fiber)
- **What it is**: An interactive 3D scene renderer.
- **Features**:
  - Supports standard shapes (Cubes, Spheres, Cylinders) as placeholders or fallbacks.
  - Dynamically lists and loads real GLB/GLTF models from your local models library (`PATHS.models`).
  - **Ask AI Context Bridge**: Selecting a mesh sends its geometric properties, vertex counts, and structure to the active AI chat context, allowing the assistant to write scripts or analyze the mesh.

### 1.2. PCB & Schematic Editor (React Flow)
- **What it is**: A node-based schematic circuit editor with a dark-circuit-board blueprint theme.
- **Features**:
  - Drag-and-drop circuit nodes.
  - Layout controls: Zoom, Fit-View, and **Rotate Layout 90°** (rotates the node network layout).
  - Floating MiniMap toggle for quick navigation.
  - Generates netlists and links schemas to physical boards.

### 1.3. Web Preview Mode (Sandboxed Iframe)
- **What it is**: A sandboxed execution environment.
- **Features**:
  - Renders HTML, CSS (Vanilla), and JavaScript written by the AI or the user in real-time.
  - Fully isolated sandbox preventing code execution from breaking the host workstation UI.
  - Real-time page reload on file changes.

### 1.4. Code Editor Mode (Virtual File System)
- **What it is**: A tab-based virtual code workspace.
- **Features**:
  - Code highlighting, line numbers, and indentation.
  - Includes a visual Markdown editor/previewer.
  - Includes a visual Diff Checker to review code changes side-by-side before applying them.

---

## 2. Desktop Application Bridges

For complex operations, the workspace includes bridges to launch native desktop CAD software:

### 2.1. "Open in Blender"
- Spawns the native desktop **Blender** software and opens your active project `.blend` file.
- Changes made in the native Blender GUI are automatically detected by the File System Watcher and synchronized back to the workstation.

### 2.2. "Open in KiCad"
- Spawns the native desktop **KiCad** suite and opens the selected project schema (`.kicad_pro`, `.kicad_pcb`, or `.kicad_sch`).
- Allows you to edit schematics or layout boards natively while maintaining full context in the Omnecor workstation.

---

## 3. Scope & Limitations

Omnecor is **not** a standalone CAD modeler. Instead, it is an **orchestration layer** that:
1. Coordinates and formats CAD assets for AI agents to analyze or generate.
2. Synchronizes file edits with professional native tools (Blender, KiCad).
3. Provides local hardware diagnostics (ZRAM, Zsh, ESPTool serial flashing).

For advanced 3D modeling or PCB routing, you should always use the native apps via the bridges.
