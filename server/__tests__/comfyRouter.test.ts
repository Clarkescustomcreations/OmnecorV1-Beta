/**
 * comfyRouter integration test — end-to-end image generation round-trip
 * =========================================================================
 *
 * WHAT THIS TEST DOES
 * -------------------
 * 1. Pings ComfyUI's /system_stats endpoint. If unreachable, the entire suite
 *    is skipped automatically — safe to leave in the normal `pnpm test` run.
 * 2. Queries /object_info/CheckpointLoaderSimple to discover the first
 *    installed checkpoint model. No hardcoded filenames — works with any
 *    .safetensors / .ckpt model you have installed.
 * 3. Submits a minimal txt2img workflow via the tRPC comfy.queuePrompt
 *    procedure: 64 × 64 px, 1 sampler step, CFG 1.0, seed 42. The tiny
 *    resolution keeps CPU generation under ~90 s.
 * 4. Polls /history once per second for up to 240 s until ComfyUI marks the
 *    job complete and reports the saved image(s).
 * 5. Asserts that at least one output image was produced and that its filename
 *    starts with "omnecor_test_" (set via the SaveImage node prefix).
 *
 * PREREQUISITES
 * -------------
 * A) Install ComfyUI (Python ≥ 3.10):
 *      git clone https://github.com/comfyanonymous/ComfyUI
 *      cd ComfyUI
 *      pip install -r requirements.txt
 *
 * B) Download a checkpoint model. The Stable Diffusion 1.5 base is the
 *    smallest reliable option for a CPU smoke-test:
 *
 *      Filename : v1-5-pruned-emaonly.safetensors  (~4 GB fp16)
 *      Source   : https://huggingface.co/stable-diffusion-v1-5/
 *                 stable-diffusion-v1-5/resolve/main/
 *                 v1-5-pruned-emaonly.safetensors
 *
 *    Drop it into:
 *      <ComfyUI>/models/checkpoints/v1-5-pruned-emaonly.safetensors
 *
 *    Any other SD 1.x / SD 2.x / SDXL / Flux checkpoint works too — the test
 *    picks the first entry from ComfyUI's own model list automatically.
 *
 * C) Start ComfyUI on the default port:
 *      python main.py --listen 127.0.0.1 --port 8188
 *
 *    GPU flags (optional, cuts generation to < 5 s):
 *      python main.py --listen 127.0.0.1 --port 8188 \
 *                     --cuda-device 0
 *
 *    CPU-only flag (no CUDA/ROCm — slower but always works):
 *      python main.py --listen 127.0.0.1 --port 8188 --cpu
 *
 *    Wait for "Starting server\nTo see the GUI go to: http://127.0.0.1:8188"
 *    before running the test.
 *
 * RUNNING THE TEST
 * ----------------
 *   # Run this file only (recommended during active ComfyUI development)
 *   pnpm vitest run server/__tests__/comfyRouter.test.ts
 *
 *   # Run the full suite — ComfyUI tests auto-skip if ComfyUI is not running
 *   pnpm test
 *
 * ENVIRONMENT VARIABLES
 * ---------------------
 *   COMFYUI_URL   Override the ComfyUI base URL (default: http://127.0.0.1:8188)
 *                 Useful when ComfyUI is on a different host or port, e.g.:
 *                   COMFYUI_URL=http://192.168.1.50:8188 pnpm vitest run ...
 *
 * TIMEOUTS
 * --------
 *   The Vitest test timeout is 250 s. The internal poll loop gives ComfyUI
 *   up to 240 s to finish the job (1 poll/s × 240 iterations). The larger
 *   window accommodates full-suite runs where Blender and KiCad compete for
 *   CPU during the same Vitest session. If you are on a very slow CPU and the
 *   job consistently times out, either:
 *     - Add the --cpu flag to ComfyUI and be patient (first run loads the
 *       model into RAM, subsequent runs are faster), or
 *     - Pass --cuda-device 0 if you have a CUDA GPU available.
 *
 * EXPECTED OUTPUT (passing run)
 * -----------------------------
 *   ✓ comfy — image generation round-trip
 *     ✓ queues a minimal workflow and receives a saved image filename  (XX s)
 *
 *   The saved image appears in:
 *     <ComfyUI>/output/omnecor_test_XXXXXXXXX_XXXXX.png
 *
 * TROUBLESHOOTING
 * ---------------
 *   "No checkpoint found" assertion failure
 *     → No .safetensors / .ckpt files in <ComfyUI>/models/checkpoints/.
 *       Download one (see section B above) and restart ComfyUI.
 *
 *   "ComfyUI did not return a prompt_id"
 *     → ComfyUI accepted the workflow but the comfy.queuePrompt tRPC
 *       procedure did not return a prompt_id. Check server logs and verify
 *       the ComfyService base URL matches COMFYUI_URL.
 *
 *   "ComfyUI did not produce output within 240 s"
 *     → Generation took longer than the poll window. Check ComfyUI's console
 *       for Python errors — a missing dependency (e.g. xformers) sometimes
 *       causes a silent hang. In full-suite runs on CPU, Blender and KiCad
 *       compete for the same cores; running the test standalone is faster.
 *
 *   Filename does not start with "omnecor_test_"
 *     → The SaveImage node's filename_prefix was changed. Verify node "9" in
 *       the workflow object below still has filename_prefix: "omnecor_test_".
 *
 *   Suite is skipped unexpectedly
 *     → /system_stats returned a non-OK status or threw. Confirm ComfyUI is
 *       listening: curl http://127.0.0.1:8188/system_stats
 */

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { describe, it, expect, beforeAll, vi } from "vitest";
import { appRouter } from "../routers.js";
import { ComfyService } from "../core_services/services/ComfyService.js";
import { createTestDb, seedUser, makeContext } from "./_helpers/trpcHarness.js";

const COMFY_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

const comfyRunning = await fetch(`${COMFY_URL}/system_stats`)
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!comfyRunning)("comfy — image generation round-trip", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const { db } = await createTestDb();
    h.db = db;
    const user = await seedUser(db);
    const ctx = makeContext(user, db, { comfy: ComfyService.getInstance() });
    caller = appRouter.createCaller(ctx);
  });

  it(
    "queues a minimal workflow and receives a saved image filename",
    async () => {
      // Discover the first available checkpoint — works with any installed model
      const info = (await fetch(
        `${COMFY_URL}/object_info/CheckpointLoaderSimple`
      ).then((r) => r.json())) as Record<string, any>;

      const checkpoints: string[] =
        info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];

      expect(
        checkpoints.length,
        "No checkpoint found in ComfyUI — install a .safetensors model into <ComfyUI>/models/checkpoints/"
      ).toBeGreaterThan(0);

      const checkpoint = checkpoints[0];

      // Minimal txt2img workflow: 64×64 px, 1 sampler step, CFG 1.0
      const workflow: Record<string, unknown> = {
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: checkpoint },
        },
        "5": {
          class_type: "EmptyLatentImage",
          inputs: { width: 64, height: 64, batch_size: 1 },
        },
        "6": {
          class_type: "CLIPTextEncode",
          inputs: { text: "a red circle", clip: ["4", 1] },
        },
        "7": {
          class_type: "CLIPTextEncode",
          inputs: { text: "", clip: ["4", 1] },
        },
        "3": {
          class_type: "KSampler",
          inputs: {
            seed: 42,
            steps: 1,
            cfg: 1.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["6", 0],
            negative: ["7", 0],
            latent_image: ["5", 0],
          },
        },
        "8": {
          class_type: "VAEDecode",
          inputs: { samples: ["3", 0], vae: ["4", 2] },
        },
        "9": {
          class_type: "SaveImage",
          inputs: { filename_prefix: "omnecor_test_", images: ["8", 0] },
        },
      };

      // Submit the workflow via the tRPC router
      const queued = (await caller.comfy.queuePrompt({ prompt: workflow })) as {
        prompt_id: string;
      };
      expect(queued.prompt_id, "ComfyUI did not return a prompt_id").toBeTruthy();

      // Poll /history until ComfyUI reports the job is done (max 240 s, 1 poll/s)
      type ComfyImage = { filename: string; subfolder: string; type: string };
      let outputImages: ComfyImage[] | null = null;

      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const history = (await fetch(
          `${COMFY_URL}/history/${queued.prompt_id}`
        ).then((r) => r.json())) as Record<string, any>;

        const job = history?.[queued.prompt_id];
        if (job?.outputs?.["9"]?.images?.length) {
          outputImages = job.outputs["9"].images as ComfyImage[];
          break;
        }
      }

      expect(
        outputImages,
        "ComfyUI did not produce output within 240 s"
      ).not.toBeNull();
      expect(outputImages!.length).toBeGreaterThan(0);
      expect(outputImages![0].filename).toMatch(/^omnecor_test_/);
    },
    250_000
  );
});
