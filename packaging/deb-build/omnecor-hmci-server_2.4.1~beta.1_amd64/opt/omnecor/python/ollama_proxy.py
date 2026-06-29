"""
ollama_proxy.py — Authenticated proxy for the Ollama API
Adds Bearer token auth (OLLAMA_PROXY_TOKEN env var) to all Ollama API requests.
Listens on port 11435; proxies to Ollama on port 11434.
"""

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
import os
import uvicorn

app = FastAPI(title="Omnecor Ollama Proxy", version="1.0.0")

PROXY_TOKEN = os.environ.get("OLLAMA_PROXY_TOKEN", "")
OLLAMA_BASE = os.environ.get("OLLAMA_URL", "http://localhost:11434")

security = HTTPBearer(auto_error=False)

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not PROXY_TOKEN:
        return  # No token configured = allow all (local dev)
    if not credentials or credentials.credentials != PROXY_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing token")

@app.api_route("/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "HEAD"])
async def proxy(request: Request, path: str, _=Depends(verify_token)):
    """Proxy all requests to the Ollama API."""
    url = f"{OLLAMA_BASE}/{path}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in ("host", "content-length")}

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            upstream = await client.request(
                method=request.method,
                url=url,
                content=body,
                headers=headers,
                params=dict(request.query_params),
            )
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Ollama is not running")

        # Stream the response
        if "application/x-ndjson" in upstream.headers.get("content-type", "") or \
           "text/event-stream" in upstream.headers.get("content-type", ""):
            return StreamingResponse(
                upstream.aiter_bytes(),
                status_code=upstream.status_code,
                headers=dict(upstream.headers),
            )

        return JSONResponse(
            content=upstream.json() if upstream.content else {},
            status_code=upstream.status_code,
        )

@app.get("/health")
async def health():
    async with httpx.AsyncClient(timeout=3.0) as client:
        try:
            res = await client.get(f"{OLLAMA_BASE}/api/tags")
            return {"status": "ok", "ollama_reachable": res.status_code == 200}
        except:
            return {"status": "degraded", "ollama_reachable": False}

if __name__ == "__main__":
    port = int(os.environ.get("OLLAMA_PROXY_PORT", "11435"))
    uvicorn.run(app, host="0.0.0.0", port=port)
