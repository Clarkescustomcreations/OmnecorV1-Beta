import os
import re
import sys

# Configuration: Directories to scan
GUI_DIRS = ["client/src/pages", "client/src/components"]
EXTENSIONS = [".tsx", ".jsx"]

# Patterns to detect "dead" or suspicious interactions
PATTERNS = [
    # Empty handlers: onClick={() => {}} or onClick={undefined}
    (r'onClick=\{\s*\(\)\s*=>\s*\{\s*\}\s*\}', "DEAD-BUTTON: Empty onClick handler found."),
    (r'onClick=\{\s*undefined\s*\}', "DEAD-BUTTON: onClick set to undefined."),
    # Placeholder console logs
    (r'onClick=\{\s*\(\)\s*=>\s*console\.log\([\'"]TODO[\'"]\)\s*\}', "PLACEHOLDER-INTERACTION: Button only logs 'TODO'."),
    # Buttons with no onClick (excluding submit buttons)
    (r'<Button(?![^>]*onClick)(?![^>]*type=[\'"]submit[\'"])[^>]*>', "SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'."),
    # TODO comments near interactive elements
    (r'//\s*TODO:?\s*.*(?:\n\s*)*<Button', "TODO-INTERACTION: Unfinished logic near Button."),
    (r'//\s*TODO:?\s*.*(?:\n\s*)*<a\s', "TODO-INTERACTION: Unfinished logic near Link."),
]

# IMPORTANT: This auditor is REPORT-ONLY. It never modifies source files.
#
# A previous version injected `{/* UI-AUDIT-FINDING */}` JSX comments directly
# into source and pushed the result back to main. That repeatedly produced
# invalid syntax: in a ternary branch — `cond ? (A) : (B)` — or as the child of
# an `asChild` Radix trigger, the parenthesised body is a JS *expression*
# context, not a JSX *children* context, so a `{/* ... */}` block is parsed as
# code and breaks compilation (TS1005 / TS1381). A line-based scanner cannot
# reliably tell those contexts apart, so it must not rewrite files at all.


def audit_file(file_path):
    """Scan a single file and return a list of (line_number, message) findings."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    findings = []
    for i, line in enumerate(content.split('\n'), start=1):
        for pattern, message in PATTERNS:
            if re.search(pattern, line):
                findings.append((i, message))
                break
    return findings


def run_audit():
    print("Starting UI Interaction Audit (report-only)...")
    total = 0
    report_lines = ["# UI Interaction Audit\n"]

    for gui_dir in GUI_DIRS:
        if not os.path.exists(gui_dir):
            continue
        for root, _, files in os.walk(gui_dir):
            for file in files:
                if not any(file.endswith(ext) for ext in EXTENSIONS):
                    continue
                path = os.path.join(root, file)
                findings = audit_file(path)
                if not findings:
                    continue
                report_lines.append(f"\n## {path}")
                for line_no, message in findings:
                    total += 1
                    rel = f"{path}:{line_no}"
                    print(f"  {rel} — {message}")
                    report_lines.append(f"- `{rel}` — {message}")

    report_lines.insert(1, f"\n**{total} finding(s)** across scanned components.\n")
    with open("ui_audit_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")

    print(f"UI Interaction Audit complete. {total} finding(s). Report: ui_audit_report.md")
    # Report-only: do not fail the build. Findings are advisory.
    return total


if __name__ == "__main__":
    run_audit()
    sys.exit(0)
