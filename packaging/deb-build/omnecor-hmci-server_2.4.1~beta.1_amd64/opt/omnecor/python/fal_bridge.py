import os
import fal_client
import time
from fastapi import FastAPI, HTTPException, Body
from typing import Optional

# Setup
FAL_KEY = os.getenv("FAL_KEY")
if not FAL_KEY:
    raise ValueError("FAL_KEY environment variable not set")

app = FastAPI(title="Omnecor Fal AI Bridge")

async def run_fal_task(app_id: str, arguments: dict):
    """
    Submits a task to Fal.ai and polls for completion.
    """
    handler = await fal_client.submit_async(app_id, arguments=arguments)
    
    # Simple polling loop
    while True:
        status = await handler.status()
        if status.status == "COMPLETED":
            return await handler.get()
        elif status.status == "FAILED":
            raise Exception(f"Fal task failed: {status}")
        await asyncio.sleep(1) # async delay

@app.post("/flux-character")
async def generate_character(prompt: str = Body(...), lora_path: Optional[str] = None):
    try:
        # Example: Using Flux Pro endpoint
        args = {"prompt": prompt}
        if lora_path: args["lora_path"] = lora_path
        
        result = await run_fal_task("fal-ai/flux-pro", args)
        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/minimax-video")
async def generate_video(image_url: str = Body(...), prompt: str = Body(...)):
    try:
        # Example: Using Minimax endpoint
        args = {"image_url": image_url, "prompt": prompt}
        result = await run_fal_task("fal-ai/minimax/video-01-subject-reference", args)
        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    import asyncio
    uvicorn.run(app, host="0.0.0.0", port=8004)
