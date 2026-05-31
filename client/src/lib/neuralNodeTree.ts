/**
 * Neural Node-Tree Data Structures and Utilities
 *
 * This module provides the core data structures for converting file system
 * hierarchies into a spatial graph representation where:
 * - Folders become nodes
 * - Files become branches (edges) connected to folder nodes
 * - Each node can have metadata, connections, and visual properties
 */

export interface FileSystemNode {
  id: string;
  name: string;
  type: "folder" | "file";
  path: string;
  parent?: string;
  children?: string[];
  metadata?: {
    size?: number;
    modified?: Date;
    created?: Date;
    mimeType?: string;
  };
}

export interface NeuralNode {
  id: string;
  label: string;
  type: "folder" | "file" | "project";
  data: {
    path: string;
    fileCount?: number;
    depth: number;
    isExpanded?: boolean;
    metadata?: Record<string, unknown>;
  };
  position: {
    x: number;
    y: number;
  };
  style?: {
    background?: string;
    border?: string;
    color?: string;
  };
}

export interface NeuralEdge {
  id: string;
  source: string;
  target: string;
  type?: "file" | "folder-connection";
  data?: {
    label?: string;
    strength?: number; // Connection strength (0-1)
  };
}

export interface NeuralNetwork {
  id: string;
  name: string;
  type: "master" | "project" | "sub-network";
  nodes: NeuralNode[];
  edges: NeuralEdge[];
  metadata?: {
    created?: Date;
    modified?: Date;
    description?: string;
  };
}

/**
 * Convert a flat file system structure into a hierarchical neural network
 *
 * @param files - Array of file system nodes
 * @param projectName - Name of the project/network
 * @returns NeuralNetwork with nodes and edges for graph visualization
 */
export function convertFileSystemToNeuralNetwork(
  files: FileSystemNode[],
  projectName: string
): NeuralNetwork {
  const nodes: NeuralNode[] = [];
  const edges: NeuralEdge[] = [];
  const nodeMap = new Map<string, NeuralNode>();

  // Create a root project node
  const rootNode: NeuralNode = {
    id: `project-${projectName}`,
    label: projectName,
    type: "project",
    data: {
      path: "/",
      depth: 0,
      fileCount: files.length,
    },
    position: { x: 0, y: 0 },
    style: {
      background: "oklch(0.65 0.15 260)",
      color: "oklch(0.12 0.01 240)",
    },
  };

  nodes.push(rootNode);
  nodeMap.set(rootNode.id, rootNode);

  // Group files by folder
  const folderMap = new Map<string, FileSystemNode[]>();
  files.forEach(file => {
    const folder = file.parent || "root";
    if (!folderMap.has(folder)) {
      folderMap.set(folder, []);
    }
    folderMap.get(folder)!.push(file);
  });

  // Create nodes for folders and files
  let nodeIndex = 0;
  files.forEach(file => {
    const depth = (file.path.match(/\//g) || []).length;
    const angle = (nodeIndex * 360) / Math.max(files.length, 1);
    const radius = 150 + depth * 100;
    const x = Math.cos((angle * Math.PI) / 180) * radius;
    const y = Math.sin((angle * Math.PI) / 180) * radius;

    const node: NeuralNode = {
      id: file.id,
      label: file.name,
      type: file.type,
      data: {
        path: file.path,
        depth,
        fileCount:
          file.type === "folder" ? file.children?.length || 0 : undefined,
      },
      position: { x, y },
      style: {
        background:
          file.type === "folder"
            ? "oklch(0.24 0.01 240)"
            : "oklch(0.20 0.01 240)",
        border:
          file.type === "folder"
            ? "2px solid oklch(0.65 0.15 260)"
            : "1px solid oklch(0.22 0.01 240)",
        color: "oklch(0.96 0.01 240)",
      },
    };

    nodes.push(node);
    nodeMap.set(node.id, node);

    // Create edge from parent to this node
    const parentId = file.parent
      ? nodeMap.get(file.parent)?.id || rootNode.id
      : rootNode.id;

    const edge: NeuralEdge = {
      id: `edge-${parentId}-${file.id}`,
      source: parentId,
      target: file.id,
      type: file.type === "folder" ? "folder-connection" : "file",
      data: {
        label: file.name,
        strength: 0.8,
      },
    };

    edges.push(edge);
    nodeIndex++;
  });

  return {
    id: `network-${projectName}`,
    name: projectName,
    type: "project",
    nodes,
    edges,
    metadata: {
      created: new Date(),
      modified: new Date(),
      description: `Neural network for ${projectName}`,
    },
  };
}

/**
 * Calculate optimal positions for nodes using force-directed layout
 * This creates a more organic, spatially-distributed arrangement
 */
export function calculateNodePositions(
  nodes: NeuralNode[],
  edges: NeuralEdge[],
  width: number = 1200,
  height: number = 800
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Simple force-directed layout
  const centerX = width / 2;
  const centerY = height / 2;

  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    const radius = 200 + (node.data.depth || 0) * 50;

    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  return positions;
}

/**
 * Convert neural network to hierarchical tree structure for tree view
 */
export function convertNetworkToTreeStructure(
  network: NeuralNetwork
): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create tree nodes
  network.nodes.forEach(node => {
    const treeNode: TreeNode = {
      id: node.id,
      label: node.label,
      type: node.type,
      path: node.data.path,
      children: [],
      expanded: node.data.isExpanded !== false,
    };
    nodeMap.set(node.id, treeNode);
  });

  // Build parent-child relationships
  network.edges.forEach(edge => {
    const parent = nodeMap.get(edge.source);
    const child = nodeMap.get(edge.target);

    if (parent && child) {
      parent.children = parent.children || [];
      parent.children.push(child);
    }
  });

  // Find root nodes (nodes with no incoming edges)
  const hasParent = new Set<string>();
  network.edges.forEach(edge => {
    hasParent.add(edge.target);
  });

  network.nodes.forEach(node => {
    if (!hasParent.has(node.id)) {
      const treeNode = nodeMap.get(node.id);
      if (treeNode) {
        roots.push(treeNode);
      }
    }
  });

  return roots;
}

export interface TreeNode {
  id: string;
  label: string;
  type: "folder" | "file" | "project";
  path: string;
  children?: TreeNode[];
  expanded?: boolean;
}

/**
 * Mock file system for demo purposes
 */
export function generateMockFileSystem(projectName: string): FileSystemNode[] {
  const files: FileSystemNode[] = [
    {
      id: "folder-src",
      name: "src",
      type: "folder",
      path: "/src",
      children: ["file-index", "file-utils", "folder-components"],
    },
    {
      id: "file-index",
      name: "index.ts",
      type: "file",
      path: "/src/index.ts",
      parent: "folder-src",
    },
    {
      id: "file-utils",
      name: "utils.ts",
      type: "file",
      path: "/src/utils.ts",
      parent: "folder-src",
    },
    {
      id: "folder-components",
      name: "components",
      type: "folder",
      path: "/src/components",
      parent: "folder-src",
      children: ["file-button", "file-card"],
    },
    {
      id: "file-button",
      name: "Button.tsx",
      type: "file",
      path: "/src/components/Button.tsx",
      parent: "folder-components",
    },
    {
      id: "file-card",
      name: "Card.tsx",
      type: "file",
      path: "/src/components/Card.tsx",
      parent: "folder-components",
    },
    {
      id: "folder-tests",
      name: "tests",
      type: "folder",
      path: "/tests",
      children: ["file-test-utils"],
    },
    {
      id: "file-test-utils",
      name: "utils.test.ts",
      type: "file",
      path: "/tests/utils.test.ts",
      parent: "folder-tests",
    },
    {
      id: "file-readme",
      name: "README.md",
      type: "file",
      path: "/README.md",
    },
    {
      id: "file-package",
      name: "package.json",
      type: "file",
      path: "/package.json",
    },
  ];

  return files;
}
