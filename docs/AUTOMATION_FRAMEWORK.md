# Omnecor Multi-Agent Automation Execution Framework

## Objective
Transform the Omnecor task breakdown into a fully autonomous multi-agent execution workflow where tasks are isolated, validated, and merge-ready.

## Global Execution Rules
1. NEVER modify files outside assigned scope.
2. ALWAYS create a checkpoint summary before completion.
3. ALWAYS verify imports/build integrity after changes.
4. ALWAYS produce merge notes.
5. ALWAYS identify unresolved dependencies.
6. NEVER silently delete code.
7. ALWAYS preserve API compatibility unless explicitly allowed.
8. ALWAYS create rollback notes.

## Agent Output Structure
Every agent report must include:
- Completed items
- Modified/New/Removed files
- Validation performed (Type, Import, Router, Runtime)
- Remaining issues & Integration risks
- Merge notes & Recommended next tasks

## Parallel Execution Groups

### GROUP A — ROUTER CONSOLIDATION TEAM
- **A1: Router Audit** (Current) - Map endpoints, detect overlaps/duplicates.
- **A2: Blender Merge** - Consolidate Blender procedures and job tracking.
- **A3: KiCad Merge** - Consolidate PCB APIs and DRC logic.
- **A4: ESPTool Merge** - Consolidate firmware flashing and serial logic.

### GROUP B — VOICE SYSTEM TEAM
- **B1: Voice Architecture Audit** - Inspect RVC, Whisper, and TTS routing.
- **B2: Unified Voice Pipeline** - Define shared queue and streaming strategy.
- **B3: Voice Router Merge** - Merge endpoints and WebSocket events.

### GROUP C — AI PROVIDER TEAM
- **C1: Mock Infrastructure Audit** - Detect placeholder AI logic.
- **C2: Ollama Integration** - Implement streaming and token handling.
- **C3: OpenAI Integration** - Request routing and streaming.
- **C4: Anthropic Integration** - Claude routing and context formatting.

### GROUP D — MEMORY SYSTEM TEAM
- **D1: Chat Persistence** - DB schema and session storage.
- **D2: Episodic Memory** - Vector storage and retrieval ranking.
- **D3: Context Pruning** - Layered memory and summarization.

### GROUP E — GRAPH + PROCESS TEAM
- **E1: Neural Graph Integration** - WebSocket subscription and live updates.
- **E2: Process Manager UI** - Wire process events to UI tracking.

### GROUP F — MEDIA RUNTIME TEAM
- **F1: RVC Runtime Completion** - Model loading and inference implementation.
- **F2: Dataset Training** - Upload and processing pipelines.

### GROUP G — CLEANUP TEAM
- **G1: Legacy Backend Removal** - Remove deprecated systems.
- **G2: Repository Cleanup** - Remove dead imports and standardize aliases.

### GROUP H — PACKAGING TEAM
- **H1: Debian Packaging** - Structure, scripts, and services.
- **H2: AppImage Packaging** - Runtime bundling and launch scripts.

### GROUP Z — FINAL MERGE COORDINATOR
- Merge all validated branches, resolve conflicts, and run full regression validation.
