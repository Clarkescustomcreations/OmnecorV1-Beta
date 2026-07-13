/**
 * Blueprint Studio — concept render generation.
 *
 * Shared by the `generate_concept_image` agent tool and the router's manual
 * mutation. Produces image *bytes* (persisted as a blueprint file so the plan
 * document owns its renders — a remote URL that expires is not a deliverable):
 *  - local  — ComfyUI: queue the prompt, poll history, fetch the output image
 *  - fal / openart — cloud (caller must gate via sovereign mode), then the
 *    returned URL is downloaded immediately.
 */
import { ComfyService } from "../services/ComfyService.js";
import { FalApiService } from "../services/FalApiService.js";
import { OpenArtService } from "../services/OpenArtService.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("BlueprintConceptRender");

const COMFY_POLL_INTERVAL_MS = 2_000;
const COMFY_POLL_TIMEOUT_MS = 120_000;

export type ConceptProvider = "local" | "fal" | "openart";

export interface ConceptRenderResult {
  data: Buffer;
  mimeType: string;
  provider: ConceptProvider;
}

export async function generateConceptImage(
  prompt: string,
  provider: ConceptProvider,
  opts: { width?: number; height?: number } = {},
): Promise<ConceptRenderResult> {
  const width = opts.width ?? 768;
  const height = opts.height ?? 768;

  if (provider === "fal") {
    const url = await FalApiService.getInstance().generateCharacter(prompt);
    return { data: await downloadImage(url), mimeType: mimeFromUrl(url), provider };
  }

  if (provider === "openart") {
    const result = await OpenArtService.getInstance().generate(prompt, "default", width, height);
    const url = (result as { imageUrl?: string }).imageUrl;
    if (!url) throw new Error("OpenArt returned no image URL.");
    return { data: await downloadImage(url), mimeType: mimeFromUrl(url), provider };
  }

  // local — ComfyUI queue → poll → fetch
  const comfy = ComfyService.getInstance();
  const queued = (await comfy.queuePrompt({ prompt, width, height })) as { prompt_id?: string; promptId?: string };
  const promptId = queued.prompt_id ?? queued.promptId;
  if (!promptId) throw new Error(`ComfyUI did not return a prompt id: ${JSON.stringify(queued).slice(0, 300)}`);

  const deadline = Date.now() + COMFY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, COMFY_POLL_INTERVAL_MS));
    const history = await comfy.getHistory(promptId).catch(() => null);
    const job = history?.[promptId] as
      | { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }
      | undefined;
    if (!job?.outputs) continue;
    for (const node of Object.values(job.outputs)) {
      const img = node.images?.[0];
      if (img) {
        const data = await comfy.fetchOutputFile(img as never);
        log.info(`Fetched ComfyUI concept render ${img.filename} (${data.length} bytes)`);
        return { data, mimeType: img.filename.endsWith(".jpg") ? "image/jpeg" : "image/png", provider };
      }
    }
  }
  throw new Error("ComfyUI render timed out after 120 s — check the ComfyUI queue.");
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed (${res.status}) from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function mimeFromUrl(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".webp")) return "image/webp";
  return "image/png";
}
