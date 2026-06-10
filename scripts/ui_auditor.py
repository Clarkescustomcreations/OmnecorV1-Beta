import os
import re

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

def audit_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    modified = False
    new_content = []
    
    # Simple line-by-line check (can be improved with multi-line regex if needed)
    for i, line in enumerate(lines):
        # Skip audit comment lines themselves (pass through unchanged)
        if "UI-AUDIT-FINDING" in line or "UI-AUDIT-SUGGESTION" in line:
            new_content.append(line)
            continue

        # Skip if the preceding lines already have an audit annotation for this line.
        # The injected comments land 1-2 lines above the triggering line, so check
        # the last 3 items in new_content to avoid re-injecting on subsequent runs.
        if any("UI-AUDIT-" in prev for prev in new_content[-3:]):
            new_content.append(line)
            continue

        found_finding = False
        for pattern, message in PATTERNS:
            if re.search(pattern, line):
                # Add finding and suggestion as JSX-safe block comments.
                # Do NOT use // here — in JSX element bodies // is a text node, not a comment.
                suggestion = "SUGGESTION: Implement the intended logic or hide this element if it's not ready."
                if "no onClick" in message:
                    suggestion = "SUGGESTION: Add an onClick handler or change type to 'submit' if in a form."

                new_content.append(f"    {{/* UI-AUDIT-FINDING: {message} */}}")
                new_content.append(f"    {{/* UI-AUDIT-SUGGESTION: {suggestion} */}}")
                new_content.append(line)
                modified = True
                found_finding = True
                break
        
        if not found_finding:
            new_content.append(line)
            
    if modified:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(new_content))
        print(f"Audited and updated: {file_path}")

def run_audit():
    print("Starting UI Interaction Audit...")
    for gui_dir in GUI_DIRS:
        if not os.path.exists(gui_dir):
            continue
        for root, _, files in os.walk(gui_dir):
            for file in files:
                if any(file.endswith(ext) for ext in EXTENSIONS):
                    audit_file(os.path.join(root, file))
    print("UI Interaction Audit complete.")

if __name__ == "__main__":
    run_audit()
