// ---------------------------------------------------------------------------
// Main-thread client for the neural-map layout Web Worker.
//
// `runLayout` posts the slim graph to the worker and resolves with the computed
// node positions. A singleton worker is reused across calls. If Web Workers are
// unavailable (SSR, locked-down environments) or the worker errors, it transparently
// falls back to computing the layout synchronously on the main thread — correctness
// is preserved, only the off-thread guarantee is lost.
// ---------------------------------------------------------------------------
import {
  computeLayoutPositions,
  type LayoutParams,
  type LayoutNode,
  type LayoutEdge,
  type LayoutPosition,
} from "./neuralLayout";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./neuralLayout.worker";

type PendingRequest = {
  resolve: (positions: LayoutPosition[]) => void;
  params: LayoutParams;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
};

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function syncFallback(req: PendingRequest): void {
  // Defer to a microtask so callers always observe async resolution semantics.
  Promise.resolve().then(() => req.resolve(computeLayoutPositions(req.params, req.nodes, req.edges)));
}

function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    workerUnavailable = true;
    return null;
  }
  try {
    worker = new Worker(new URL("./neuralLayout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<LayoutWorkerResponse>) => {
      const { id, positions } = e.data;
      const req = pending.get(id);
      if (req) {
        pending.delete(id);
        req.resolve(positions);
      }
    };
    worker.onerror = () => {
      // Worker crashed — fall back to main thread for everything in flight and onward.
      workerUnavailable = true;
      worker = null;
      for (const req of pending.values()) syncFallback(req);
      pending.clear();
    };
    return worker;
  } catch {
    workerUnavailable = true;
    worker = null;
    return null;
  }
}

export function runLayout(
  params: LayoutParams,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Promise<LayoutPosition[]> {
  return new Promise<LayoutPosition[]>((resolve) => {
    const req: PendingRequest = { resolve, params, nodes, edges };
    const w = getWorker();
    if (!w) {
      syncFallback(req);
      return;
    }
    const id = nextRequestId++;
    pending.set(id, req);
    w.postMessage({ id, params, nodes, edges } satisfies LayoutWorkerRequest);
  });
}
