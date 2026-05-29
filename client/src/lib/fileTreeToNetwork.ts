import { NeuralNetwork, NeuralNode, NeuralEdge } from "./neuralNodeTree";
import { FileTreeNode } from "../../../server/routers/projectRouter"; // I'll define a shared type or copy it

export interface FileTreeToNetworkOptions {
  projectId: string;
  projectName: string;
  maxDepth?: number;
}

/**
 * Converts a nested FileTreeNode structure into a NeuralNetwork graph.
 */
export function fileTreeToNetwork(
  tree: any[], // FileTreeNode[]
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

  const processNode = (
    fileNode: any,
    parentId: string,
    depth: number,
    angleStart: number,
    angleRange: number
  ) => {
    const id = `node-${fileNode.path}`;
    const radius = 200 + depth * 150;
    const angle = angleStart + angleRange / 2;
    
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    const neuralNode: NeuralNode = {
      id,
      label: fileNode.name,
      type: fileNode.type === "directory" ? "folder" : "file",
      data: {
        path: fileNode.path,
        depth,
        metadata: {
          size: fileNode.size,
          extension: fileNode.extension,
          modifiedAt: fileNode.modifiedAt,
        },
      },
      position: { x, y },
      style: {
        background: fileNode.type === "directory" ? "oklch(0.24 0.01 240)" : "oklch(0.20 0.01 240)",
        border: fileNode.type === "directory" ? "2px solid oklch(0.65 0.15 260)" : "1px solid oklch(0.22 0.01 240)",
        color: "oklch(0.96 0.01 240)",
      },
    };

    nodes.push(neuralNode);
    edges.push({
      id: `edge-${parentId}-${id}`,
      source: parentId,
      target: id,
      type: fileNode.type === "directory" ? "folder-connection" : "file",
    });

    if (fileNode.children && fileNode.children.length > 0) {
      const childCount = fileNode.children.length;
      const childAngleRange = angleRange / childCount;
      fileNode.children.forEach((child: any, index: number) => {
        processNode(
          child,
          id,
          depth + 1,
          angleStart + index * childAngleRange,
          childAngleRange
        );
      });
    }
  };

  const topLevelCount = tree.length;
  const anglePerTopNode = (2 * Math.PI) / topLevelCount;

  tree.forEach((node, index) => {
    processNode(
      node,
      rootNode.id,
      1,
      index * anglePerTopNode,
      anglePerTopNode
    );
  });

  return {
    id: `network-${projectId}`,
    name: projectName,
    type: "project",
    nodes,
    edges,
  };
}
