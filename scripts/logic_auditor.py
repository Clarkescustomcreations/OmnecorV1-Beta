import os
import re

# Configuration
ROUTER_DIR = "server/routers"
CLIENT_DIR = "client/src"
EXTENSIONS = [".ts", ".tsx"]

def extract_procedures(router_file):
    with open(router_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Improved regex to find procedure names
    # Matches:   procName: publicProcedure
    # Matches:   procName: protectedProcedure
    procedures = re.findall(r'^\s\s([a-zA-Z0-9]+):\s*(?:public|protected)Procedure', content, re.MULTILINE)
    return procedures

def is_procedure_used(proc_name, base_router):
    # Check for usage in client code
    # Matches: trpc.ai.createSession.useMutation
    # Matches: trpc.ai.getProviders.useQuery
    # Matches: utils.ai.createSession.invalidate
    patterns = [
        rf'trpc\.{base_router}\.{proc_name}\.',
        rf'utils\.{base_router}\.{proc_name}\.'
    ]
    
    for root, _, files in os.walk(CLIENT_DIR):
        for file in files:
            if any(file.endswith(ext) for ext in EXTENSIONS):
                with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                    file_content = f.read()
                    for pattern in patterns:
                        if re.search(pattern, file_content):
                            return True
    return False

def run_logic_audit():
    print("Starting Backend Logic Audit (Dark Logic Scan)...")
    findings = []
    
    for file in os.listdir(ROUTER_DIR):
        if file.endswith('.ts') and 'index' not in file:
            # Handle both 'nameRouter.ts' and 'name.router.ts'
            router_key = file.replace('.ts', '').replace('.router', '').replace('Router', '')
            file_path = os.path.join(ROUTER_DIR, file)
            
            procedures = extract_procedures(file_path)
            for proc in procedures:
                if not is_procedure_used(proc, router_key):
                    findings.append({
                        "router": file.replace('.ts', ''),
                        "procedure": proc,
                        "file": file_path
                    })

    # Cleanup old comments before adding new ones
    cleanup_comments()

    if findings:
        print(f"Found {len(findings)} inaccessible backend procedures.")
        # Generate a report in the root
        with open("Logic-Audit-Report.md", "w", encoding='utf-8') as f:
            f.write("# Omnecor Logic Audit: Dark Logic Report\n")
            f.write(f"**Total Hidden Features:** {len(findings)}\n\n")
            f.write("The following backend features are implemented but have NO matching UI interaction in the frontend.\n\n")
            f.write("| Router | Procedure | Backend File |\n")
            f.write("|---|---|---|\n")
            for find in findings:
                f.write(f"| {find['router']} | `{find['procedure']}` | `{find['file']}` |\n")
                # Also add a comment directly in the router file
                add_comment_to_router(find['file'], find['procedure'])
        print("Report generated: Logic-Audit-Report.md")
    else:
        print("No inaccessible logic found. All backend procedures are wired to the UI!")

def cleanup_comments():
    for file in os.listdir(ROUTER_DIR):
        if file.endswith('.ts'):
            file_path = os.path.join(ROUTER_DIR, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Remove all lines containing UI-LOGIC-AUDIT or the suggestion
            new_content = re.sub(r'^\s*//\s*(?:UI-LOGIC-AUDIT|SUGGESTION):.*\n', '', content, flags=re.MULTILINE)
            
            if new_content != content:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)

def add_comment_to_router(file_path, proc_name):
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    new_lines = []
    found = False
    for line in lines:
        # Check if this line defines the procedure
        if re.search(rf'^\s\s{proc_name}:\s*(?:public|protected)Procedure', line) and not found:
            new_lines.append(f"  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.\n")
            new_lines.append(f"  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.\n")
            new_lines.append(line)
            found = True
        else:
            new_lines.append(line)
    
    if found:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)

if __name__ == "__main__":
    run_logic_audit()
