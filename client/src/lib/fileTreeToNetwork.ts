import { NeuralNetwork, NeuralNode, NeuralEdge } from "./neuralNodeTree";

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  children?: FileTreeNode[];
  modifiedAt?: string;
  /** Directory whose children weren't expanded server-side (budget/depth limit). */
  truncated?: boolean;
  /** Number of immediate entries inside a truncated directory. */
  childCount?: number;
  /** Synthetic marker node standing in for entries dropped by the root slice. */
  overflow?: boolean;
}

export interface FileTreeToNetworkOptions {
  projectId: string;
  projectName: string;
  maxDepth?: number;
}

/**
 * Recursively turn one FileTreeNode into graph nodes/edges, linking it under
 * `parentId`. Truncated directories become leaf drill-in nodes carrying their
 * child count, so the UI can offer on-demand expansion. Positions are radial
 * seeds only — the layout engine recomputes them.
 */
function processNode(
  fileNode: FileTreeNode,
  parentId: string,
  depth: number,
  angleStart: number,
  angleRange: number,
  nodes: NeuralNode[],
  edges: NeuralEdge[],
): void {
  const id = `node-${fileNode.path}`;
  const radius = 200 + depth * 150;
  const angle = angleStart + angleRange / 2;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  const isDir = fileNode.type === "directory";
  const truncated = isDir && !!fileNode.truncated;
  const fileCount = truncated ? fileNode.childCount : fileNode.children?.length;

  const neuralNode: NeuralNode = {
    id,
    label: fileNode.name,
    type: isDir ? "folder" : "file",
    data: {
      path: fileNode.path,
      depth,
      fileCount,
      truncated,
      metadata: {
        size: fileNode.size,
        extension: fileNode.extension,
        modifiedAt: fileNode.modifiedAt,
      },
    },
    position: { x, y },
    style: {
      background: isDir ? "oklch(0.24 0.01 240)" : "oklch(0.20 0.01 240)",
      border: isDir ? "2px solid oklch(0.65 0.15 260)" : "1px solid oklch(0.22 0.01 240)",
      color: "oklch(0.96 0.01 240)",
    },
  };

  nodes.push(neuralNode);
  edges.push({
    id: `edge-${parentId}-${id}`,
    source: parentId,
    target: id,
    type: isDir ? "folder-connection" : "file",
  });

  if (fileNode.children && fileNode.children.length > 0) {
    const childCount = fileNode.children.length;
    const childAngleRange = angleRange / childCount;
    fileNode.children.forEach((child, index) => {
      processNode(child, id, depth + 1, angleStart + index * childAngleRange, childAngleRange, nodes, edges);
    });
  }
}

/**
 * Converts a nested FileTreeNode structure into a NeuralNetwork graph.
 */
export function fileTreeToNetwork(
  tree: FileTreeNode[],
  options: FileTreeToNetworkOptions
): NeuralNetwork {
  const nodes: NeuralNode[] = [];
  const edges: NeuralEdge[] = [];
  const { projectId, projectName } = options;

  // Create root node
  const rootNode: NeuralNode = {
    id: `root-${projectId}`,
    label: projectName,
    type: "project",
    data: {
      path: "/",
      depth: 0,
    },
    position: { x: 0, y: 0 },
    style: {
      background: "oklch(0.65 0.15 260)",
      color: "oklch(0.12 0.01 240)",
    },
  };
  nodes.push(rootNode);

  const topLevelCount = tree.length;
  const anglePerTopNode = (2 * Math.PI) / Math.max(topLevelCount, 1);

  tree.forEach((node, index) => {
    processNode(node, rootNode.id, 1, index * anglePerTopNode, anglePerTopNode, nodes, edges);
  });

  return {
    id: `network-${projectId}`,
    name: projectName,
    type: "project",
    nodes,
    edges,
  };
}

/**
 * Convert the children of a lazily-fetched folder into graph nodes/edges, linked
 * under the existing folder node (`parentId` = `node-${folderPath}`). Used to
 * merge an on-demand expansion into an already-rendered network.
 */
export function subtreeToNodes(
  children: FileTreeNode[],
  parentId: string,
  parentDepth: number,
): { nodes: NeuralNode[]; edges: NeuralEdge[] } {
  const nodes: NeuralNode[] = [];
  const edges: NeuralEdge[] = [];
  const anglePerNode = (2 * Math.PI) / Math.max(children.length, 1);
  children.forEach((child, index) => {
    processNode(child, parentId, parentDepth + 1, index * anglePerNode, anglePerNode, nodes, edges);
  });
  return { nodes, edges };
}
