from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import subprocess
import json
import os
import uvicorn

app = FastAPI()

ALLOWED_ROOTS = [
    os.path.expanduser("~"),
    "/tmp",
    "/opt/omnecor",
]


def is_safe_path(path: str) -> bool:
    real = os.path.realpath(path)
    return any(real.startswith(os.path.realpath(r)) for r in ALLOWED_ROOTS)


class ScanRequest(BaseModel):
    target_path: str
    scan_type: str = "combined"


@app.get("/health")
def health():
    return {"status": "ok", "port": 8012}


@app.post("/scan")
def scan(req: ScanRequest):
    if not is_safe_path(req.target_path):
        raise HTTPException(status_code=403, detail="Path not allowed")
    safe_path = os.path.realpath(req.target_path)
    findings = []
    if req.scan_type in ("semgrep", "combined"):
        findings.extend(_run_semgrep(safe_path))
    if req.scan_type in ("yara", "combined"):
        findings.extend(_run_yara(safe_path))
    return {"findings": findings, "scan_type": req.scan_type, "target_path": safe_path}


def _run_semgrep(path: str) -> list:
    try:
        result = subprocess.run(
            ["semgrep", "--config=auto", "--json", path],
            capture_output=True, text=True, timeout=60,
        )
        data = json.loads(result.stdout or "{}")
        return [
            {
                "tool": "semgrep",
                "rule": r.get("check_id", ""),
                "file": r.get("path", ""),
                "line": r.get("start", {}).get("line", 0),
                "message": r.get("extra", {}).get("message", ""),
            }
            for r in data.get("results", [])
        ]
    except Exception as e:
        return [{"tool": "semgrep", "rule": "", "file": "", "line": 0, "message": f"Error: {e}"}]


def _run_yara(path: str) -> list:
    rules_path = os.environ.get("YARA_RULES_PATH", "")
    if not rules_path or not os.path.exists(rules_path):
        return []
    try:
        import yara
        rules = yara.compile(rules_path)
        matches = []
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    m = rules.match(fp)
                    if m:
                        matches.append({
                            "tool": "yara",
                            "rule": str(m[0]),
                            "file": fp,
                            "line": 0,
                            "message": "YARA match",
                        })
                except Exception:
                    pass
        return matches
    except Exception as e:
        return [{"tool": "yara", "rule": "", "file": "", "line": 0, "message": f"Error: {e}"}]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8012)
