// server/ommesh/core/HostTelemetry.ts
//
// Collects real host compute telemetry (GPU VRAM headroom + utilization, CPU
// cores, free RAM) for the local OMMESH node. This is the *producer* that feeds
// the VRAM-weighted peer selection in RoutingEngine — without it, every node
// advertises `vram: 0` and the scorer short-circuits to a flat 0.1 for all
// peers (i.e. the weighting is inert). See Tech-Debt TD-018.
//
// `gpu.vram` is reported as **free** VRAM in MB (headroom), because routing
// wants the peer with the most *available* VRAM, not the largest card. NVIDIA
// is queried via `nvidia-smi`, AMD via `rocm-smi`; both use `execFile` (no
// shell — no injection surface). When no GPU is present every field is 0, which
// the scorer treats as a minimal-score CPU-only node.

import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import { createLogger } from "../../_core/logger.js";
import type { NodeCapabilities } from "../../../shared/types/ommesh.types.js";

const execFileAsync = promisify(execFile);
const log = createLogger("OMMESH:Telemetry");

export type GpuTelemetry = NodeCapabilities["gpu"];

/**
 * Free VRAM (MB), GPU utilization (%), and temperature (°C) for the local host.
 * Multi-GPU hosts sum free VRAM and take the max utilization/temperature.
 * Returns all-zero when no supported GPU is detected.
 */
export async function collectGpuTelemetry(): Promise<GpuTelemetry> {
  // ── NVIDIA ──────────────────────────────────────────────────────────────
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=memory.total,memory.used,utilization.gpu,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 5000 },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length) {
      let freeVram = 0;
      let utilization = 0;
      let temperature = 0;
      for (const line of lines) {
        const [total, used, util, temp] = line.split(",").map((s) => parseInt(s.trim(), 10));
        if (Number.isFinite(total) && Number.isFinite(used)) {
          freeVram += Math.max(0, total - used);
        }
        if (Number.isFinite(util)) utilization = Math.max(utilization, util);
        if (Number.isFinite(temp)) temperature = Math.max(temperature, temp);
      }
      return { vram: freeVram, utilization, temperature };
    }
  } catch {
    /* nvidia-smi not present — try AMD */
  }

  // ── AMD (ROCm) ──────────────────────────────────────────────────────────
  try {
    const { stdout } = await execFileAsync(
      "rocm-smi",
      ["--showmeminfo", "vram", "--showuse", "--showtemp"],
      { timeout: 5000 },
    );
    const totalBytes = stdout.match(/Total Memory.*?:\s*(\d+)/);
    const usedBytes = stdout.match(/Total Used Memory.*?:\s*(\d+)/);
    if (totalBytes) {
      const totalMb = Math.round(parseInt(totalBytes[1], 10) / (1024 * 1024));
      const usedMb = usedBytes ? Math.round(parseInt(usedBytes[1], 10) / (1024 * 1024)) : 0;
      const useMatch = stdout.match(/GPU use \(%\).*?:\s*(\d+)/i);
      const tempMatch = stdout.match(/Temperature.*?:\s*([\d.]+)/i);
      return {
        vram: Math.max(0, totalMb - usedMb),
        utilization: useMatch ? parseInt(useMatch[1], 10) : 0,
        temperature: tempMatch ? Math.round(parseFloat(tempMatch[1])) : 0,
      };
    }
  } catch {
    /* rocm-smi not present — CPU-only node */
  }

  return { vram: 0, utilization: 0, temperature: 0 };
}

/**
 * Dynamic host capabilities for the local node: GPU telemetry, logical CPU
 * core count, and free RAM (MB). Combined with the static `models`/`roles`
 * fields already on the identity, this is what the node advertises over mDNS.
 */
export async function collectHostTelemetry(): Promise<Pick<NodeCapabilities, "gpu" | "cpu" | "ram">> {
  const gpu = await collectGpuTelemetry();
  const telemetry = {
    gpu,
    cpu: os.cpus().length,
    ram: Math.round(os.freemem() / (1024 * 1024)),
  };
  log.debug("collected host telemetry", telemetry);
  return telemetry;
}
