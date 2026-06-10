#!/usr/bin/env python3
import json
import sys

file_path = "qa_features.jsonl"
required_keys = {"task_class", "instruction", "input", "output", "rag_source"}
valid_count = 0
invalid_lines = []
coverage = {
    "terminal": 0,
    "neural_map": 0,
    "3d_designer": 0,
    "settings": 0,
    "chat": 0,
    "agent_networking": 0,
    "wallet": 0,
    "integrations": 0,
    "other": 0
}

with open(file_path, 'r') as f:
    for line_num, line in enumerate(f, 1):
        try:
            row = json.loads(line)
            if set(row.keys()) == required_keys:
                valid_count += 1
                # Categorize
                input_text = row.get("input", "").lower()
                if any(w in input_text for w in ["terminal", "shell", "command", "embedded"]):
                    coverage["terminal"] += 1
                elif any(w in input_text for w in ["neural", "brain map", "folder", "node"]):
                    coverage["neural_map"] += 1
                elif any(w in input_text for w in ["3d", "blender", "kicad", "mesh", "pcb"]):
                    coverage["3d_designer"] += 1
                elif any(w in input_text for w in ["setting", "hardware", "security", "api", "voice", "knowledge", "privacy", "advanced", "appearance"]):
                    coverage["settings"] += 1
                elif any(w in input_text for w in ["chat", "conversation", "message", "ai", "compress", "export"]):
                    coverage["chat"] += 1
                elif any(w in input_text for w in ["agent", "social", "platform", "persona", "curation", "discovery", "federation", "ommesh"]):
                    coverage["agent_networking"] += 1
                elif any(w in input_text for w in ["wallet", "card", "budget", "spending"]):
                    coverage["wallet"] += 1
                elif any(w in input_text for w in ["integration", "oauth", "mcp"]):
                    coverage["integrations"] += 1
                else:
                    coverage["other"] += 1
            else:
                invalid_lines.append((line_num, f"Has {len(row.keys())} keys, needs 5"))
        except json.JSONDecodeError as e:
            invalid_lines.append((line_num, str(e)))

print("VALIDATION REPORT")
print("=" * 60)
print(f"Total valid lines: {valid_count}")
print(f"Invalid lines: {len(invalid_lines)}")

if invalid_lines:
    print("\nInvalid lines:")
    for line_num, reason in invalid_lines[:10]:
        print(f"  Line {line_num}: {reason}")
else:
    print("\nAll lines valid! No errors found.")

print(f"\nCOVERAGE BY TOPIC AREA:")
print(f"  Terminal/Shells/Commands: {coverage['terminal']}")
print(f"  Neural Map/Brain Map: {coverage['neural_map']}")
print(f"  3D Designer/PCB/Blender/KiCad: {coverage['3d_designer']}")
print(f"  Settings/Hardware/Security/API: {coverage['settings']}")
print(f"  Chat/Conversations: {coverage['chat']}")
print(f"  Agent Networking/Social/Curation: {coverage['agent_networking']}")
print(f"  Agentic Wallet: {coverage['wallet']}")
print(f"  Integrations/OAuth/MCP: {coverage['integrations']}")
print(f"  Other: {coverage['other']}")
print(f"\nTotal questions: {sum(coverage.values())}")
print(f"\nFile: {file_path}")
