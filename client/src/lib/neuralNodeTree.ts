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
    description?: string;
  };
}

export interface NeuralNode {
  id: string;
  label: string;
  type: "folder" | "file" | "project" | "integration";
  data: {
    path: string;
    fileCount?: number;
    depth: number;
    isExpanded?: boolean;
    isRemote?: boolean;
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
        metadata: file.metadata,
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
      metadata: node.data.metadata as Record<string, unknown>,
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
  type: "folder" | "file" | "project" | "integration";
  path: string;
  children?: TreeNode[];
  expanded?: boolean;
  metadata?: Record<string, unknown>;
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

// ─── Master Network ───────────────────────────────────────────────────────────

import type { NeuralBrainMap } from "@/types/neural";

// Map-mode accent palette — one colour per map (cycles if > 8 maps).
// These hex values intentionally approximate the design token OKLCH equivalents
// (--accent-purple, --accent-cyan, --accent-success, --accent-danger) so they
// read consistently in both themes. They must stay as hex because they are
// also appended with a two-digit alpha suffix (e.g. `${mapColor}55`) in inline
// border styles where CSS variable strings cannot be extended that way.
const MAP_COLORS = [
  "#7c3aed", // ≈ --color-accent-purple
  "#0ea5e9", // ≈ --color-accent-cyan
  "#10b981", // ≈ --color-accent-success
  "#ef4444", // ≈ --color-accent-danger
  "#ec4899", // pink (no token — nearest is accent-purple)
  "#06b6d4", // ≈ --color-accent-cyan (variant)
  "#84cc16", // lime (no token — nearest is accent-success)
  "#f59e0b", // amber (no token — nearest is accent-danger)
];

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function sourceLabel(uri: string): string {
  if (uri.startsWith("github://")) return `🐙 ${uri.replace("github://", "")}`;
  if (uri === "integration://gmail") return "✉️ Gmail";
  if (uri === "integration://outlook") return "📧 Outlook";
  if (uri === "integration://google-drive") return "☁️ Drive";
  if (uri === "integration://dropbox") return "📦 Dropbox";
  if (uri === "integration://onedrive") return "💼 OneDrive";
  // Local path — use basename
  return uri.split("/").pop() ?? uri;
}

/**
 * Build a meta-graph from all neural maps — the Global Master Network View.
 *
 * Layout:
 *   Workspace hub (centre) → map hub nodes (radius 420) → source nodes (radius 220 from map hub)
 *
 * No file-tree queries are needed: sources come directly from rootDirectories.
 */
export function buildMasterNetwork(maps: NeuralBrainMap[]): NeuralNetwork {
  const nodes: NeuralNode[] = [];
  const edges: NeuralEdge[] = [];

  // Central workspace hub
  const hubId = "master-workspace-hub";
  nodes.push({
    id: hubId,
    label: "Omnecor Workspace",
    type: "project",
    data: { path: "/", depth: 0, metadata: { type: "workspace-hub" } },
    position: { x: 0, y: 0 },
    style: { background: "var(--color-background)", border: "2px solid var(--color-accent-purple)", color: "var(--color-foreground)" },
  });

  if (maps.length === 0) return { id: "master", name: "Master Network", type: "master", nodes, edges };

  const mapRadius = Math.max(380, maps.length * 60);
  const angleStep = (2 * Math.PI) / maps.length;

  maps.forEach((map, mi) => {
    const mapAngle = mi * angleStep - Math.PI / 2; // start from top
    const mapPos = polar(0, 0, mapRadius, mapAngle);
    const mapColor = MAP_COLORS[mi % MAP_COLORS.length];
    const mapNodeId = `map:${map.id}`;

    nodes.push({
      id: mapNodeId,
      label: map.name,
      type: "project",
      data: {
        path: map.id,
        depth: 1,
        fileCount: map.rootDirectories.length,
        metadata: { type: "map-hub", mode: map.mode, color: mapColor },
      },
      position: mapPos,
      style: { background: "var(--color-card)", border: `2px solid ${mapColor}`, color: "var(--color-foreground)" },
    });

    // Workspace → map edge
    edges.push({
      id: `e:hub->${mapNodeId}`,
      source: hubId,
      target: mapNodeId,
      type: "folder-connection",
      data: { strength: 1 },
    });

    const sources = map.rootDirectories;
    if (sources.length === 0) return;

    const srcRadius = Math.max(180, sources.length * 40);
    const srcSpread = Math.min(Math.PI * 0.8, (sources.length * Math.PI) / 6);
    sources.forEach((src, si) => {
      const srcAngle = mapAngle + (si - (sources.length - 1) / 2) * (srcSpread / Math.max(sources.length - 1, 1));
      const srcPos = polar(mapPos.x, mapPos.y, srcRadius, srcAngle);
      const isRemote = src.startsWith("integration://") || src.startsWith("github://");
      const srcId = `src:${map.id}:${si}`;

      nodes.push({
        id: srcId,
        label: sourceLabel(src),
        type: "folder",
        data: {
          path: src,
          depth: 2,
          metadata: { type: isRemote ? "remote-source" : "local-root", mapId: map.id },
        },
        position: srcPos,
        style: isRemote
          ? { background: "var(--color-bg-primary)", border: "1px dashed var(--color-accent-purple)", color: "var(--color-accent-purple)" }
          : { background: "var(--color-bg-primary)", border: `1px solid ${mapColor}55`, color: "var(--color-muted-foreground)" },
      });

      edges.push({
        id: `e:${mapNodeId}->${srcId}`,
        source: mapNodeId,
        target: srcId,
        type: "folder-connection",
        data: { strength: 0.6 },
      });
    });
  });

  return {
    id: "master",
    name: "Omnecor Master Network",
    type: "master",
    nodes,
    edges,
    metadata: { created: new Date(), modified: new Date(), description: `${maps.length} maps, ${nodes.length} nodes` },
  };
}
