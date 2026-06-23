// ---------------------------------------------------------------------------
// Neural-map layout Web Worker.
//
// Runs the (potentially heavy) graph layout off the render thread so indexing a
// large map never freezes the UI. The actual math lives in neuralLayout.ts — a
// pure module with no DOM/React/store dependencies, safe to bundle into a worker.
// ---------------------------------------------------------------------------
import {
  computeLayoutPositions,
  type LayoutParams,
  type LayoutNode,
  type LayoutEdge,
  type LayoutPosition,
} from "./neuralLayout";

export interface LayoutWorkerRequest {
  id: number;
  params: LayoutParams;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutWorkerResponse {
  id: number;
  positions: LayoutPosition[];
}

self.onmessage = (e: MessageEvent<LayoutWorkerRequest>) => {
  const { id, params, nodes, edges } = e.data;
  const positions = computeLayoutPositions(params, nodes, edges);
  (self as unknown as Worker).postMessage({ id, positions } satisfies LayoutWorkerResponse);
};
