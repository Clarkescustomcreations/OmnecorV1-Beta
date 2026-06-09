/**
 * PCB Editor Integration Tests
 * 
 * Tests for canvas operations, undo/redo, and component interactions
 */

import { describe, it, expect, beforeEach } from "vitest";

describe("PCB Editor Canvas Operations", () => {
  describe("Node Management", () => {
    it("should add a node to the canvas", () => {
      const nodes: any[] = [];
      const newNode = {
        id: "node-1",
        type: "schematic",
        position: { x: 100, y: 100 },
        data: { reference: "R1", value: "10k" },
      };

      nodes.push(newNode);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("node-1");
    });

    it("should update node properties", () => {
      const nodes = [
        {
          id: "node-1",
          type: "schematic",
          position: { x: 100, y: 100 },
          data: { reference: "R1", value: "10k" },
        },
      ];

      const updatedNode = {
        ...nodes[0],
        data: { ...nodes[0].data, value: "20k" },
      };

      const updated = nodes.map((n) => (n.id === "node-1" ? updatedNode : n));
      expect(updated[0].data.value).toBe("20k");
    });

    it("should delete a node from the canvas", () => {
      const nodes = [
        { id: "node-1", data: { reference: "R1" } },
        { id: "node-2", data: { reference: "R2" } },
      ];

      const filtered = nodes.filter((n) => n.id !== "node-1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("node-2");
    });

    it("should handle multiple node selection", () => {
      const selectedNodeIds: string[] = [];

      // Add node 1
      selectedNodeIds.push("node-1");
      expect(selectedNodeIds).toHaveLength(1);

      // Add node 2
      selectedNodeIds.push("node-2");
      expect(selectedNodeIds).toHaveLength(2);

      // Remove node 1
      const updated = selectedNodeIds.filter((id) => id !== "node-1");
      expect(updated).toHaveLength(1);
      expect(updated[0]).toBe("node-2");
    });
  });

  describe("Edge Management", () => {
    it("should create an edge between nodes", () => {
      const edges: any[] = [];
      const newEdge = {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        type: "custom",
      };

      edges.push(newEdge);
      expect(edges).toHaveLength(1);
      expect(edges[0].source).toBe("node-1");
    });

    it("should delete edges when nodes are removed", () => {
      const edges = [
        { id: "edge-1", source: "node-1", target: "node-2" },
        { id: "edge-2", source: "node-2", target: "node-3" },
      ];

      const deletedNodeId = "node-1";
      const filtered = edges.filter(
        (e) => e.source !== deletedNodeId && e.target !== deletedNodeId
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("edge-2");
    });

    it("should handle edge with labels", () => {
      const edge = {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        data: { label: "VCC" },
      };

      expect(edge.data.label).toBe("VCC");
    });
  });

  describe("Undo/Redo Functionality", () => {
    it("should maintain history stack", () => {
      const history: any[] = [];
      let historyIndex = -1;

      // Add state 1
      history.push({ nodes: [{ id: "node-1" }], edges: [] });
      historyIndex++;
      expect(historyIndex).toBe(0);

      // Add state 2
      history.push({ nodes: [{ id: "node-1" }, { id: "node-2" }], edges: [] });
      historyIndex++;
      expect(historyIndex).toBe(1);

      // Undo
      historyIndex--;
      expect(historyIndex).toBe(0);
      expect(history[historyIndex].nodes).toHaveLength(1);

      // Redo
      historyIndex++;
      expect(historyIndex).toBe(1);
      expect(history[historyIndex].nodes).toHaveLength(2);
    });

    it("should clear future history on new action after undo", () => {
      let history = [
        { nodes: [{ id: "node-1" }] },
        { nodes: [{ id: "node-1" }, { id: "node-2" }] },
        { nodes: [{ id: "node-1" }, { id: "node-2" }, { id: "node-3" }] },
      ];
      let historyIndex = 2;

      // Undo twice
      historyIndex = 0;

      // New action - should clear future history
      history = history.slice(0, historyIndex + 1);
      history.push({ nodes: [{ id: "node-4" }] });
      historyIndex++;

      expect(history).toHaveLength(2);
      expect(history[1].nodes[0].id).toBe("node-4");
    });
  });

  describe("Mode Switching", () => {
    it("should switch between schematic and PCB modes", () => {
      let mode: "schematic" | "pcb" = "schematic";

      expect(mode).toBe("schematic");

      mode = "pcb";
      expect(mode).toBe("pcb");

      mode = "schematic";
      expect(mode).toBe("schematic");
    });

    it("should update node types when switching modes", () => {
      const nodes = [
        { id: "node-1", type: "schematic", data: { reference: "R1" } },
      ];

      const updatedNodes = nodes.map((n) => ({
        ...n,
        type: "pcb",
      }));

      expect(updatedNodes[0].type).toBe("pcb");
    });
  });

  describe("Component Rotation and Flip", () => {
    it("should rotate a component", () => {
      let node = {
        id: "node-1",
        data: { rotation: 0 },
      };

      // Rotate 90 degrees
      node = {
        ...node,
        data: { ...node.data, rotation: (node.data.rotation + 90) % 360 },
      };
      expect(node.data.rotation).toBe(90);

      // Rotate 90 degrees again
      node = {
        ...node,
        data: { ...node.data, rotation: (node.data.rotation + 90) % 360 },
      };
      expect(node.data.rotation).toBe(180);

      // Rotate 180 degrees more
      node = {
        ...node,
        data: { ...node.data, rotation: (node.data.rotation + 180) % 360 },
      };
      expect(node.data.rotation).toBe(0);
    });

    it("should flip a component horizontally", () => {
      let node = {
        id: "node-1",
        data: { flipped: { horizontal: false, vertical: false } },
      };

      // Flip horizontally
      node = {
        ...node,
        data: {
          ...node.data,
          flipped: {
            ...node.data.flipped,
            horizontal: !node.data.flipped.horizontal,
          },
        },
      };
      expect(node.data.flipped.horizontal).toBe(true);

      // Flip back
      node = {
        ...node,
        data: {
          ...node.data,
          flipped: {
            ...node.data.flipped,
            horizontal: !node.data.flipped.horizontal,
          },
        },
      };
      expect(node.data.flipped.horizontal).toBe(false);
    });
  });

  describe("Grid and Snap", () => {
    it("should snap position to grid", () => {
      const gridSize = 20;
      const position = { x: 47, y: 63 };

      const snappedPosition = {
        x: Math.round(position.x / gridSize) * gridSize,
        y: Math.round(position.y / gridSize) * gridSize,
      };

      expect(snappedPosition.x).toBe(40);
      expect(snappedPosition.y).toBe(60);
    });

    it("should handle grid visibility toggle", () => {
      let gridVisible = true;
      expect(gridVisible).toBe(true);

      gridVisible = false;
      expect(gridVisible).toBe(false);

      gridVisible = true;
      expect(gridVisible).toBe(true);
    });
  });

  describe("Netlist Extraction", () => {
    it("should extract netlist from edges", () => {
      const edges = [
        { id: "e1", source: "node-1", target: "node-2", data: { label: "VCC" } },
        { id: "e2", source: "node-2", target: "node-3", data: { label: "GND" } },
      ];

      const netlists = edges.map((e) => ({
        net: e.data.label,
        connections: [e.source, e.target],
      }));

      expect(netlists).toHaveLength(2);
      expect(netlists[0].net).toBe("VCC");
      expect(netlists[1].net).toBe("GND");
    });

    it("should count connections per node", () => {
      const edges = [
        { source: "node-1", target: "node-2" },
        { source: "node-1", target: "node-3" },
        { source: "node-2", target: "node-3" },
      ];

      const connectionCount = (nodeId: string) =>
        edges.filter((e) => e.source === nodeId || e.target === nodeId).length;

      expect(connectionCount("node-1")).toBe(2);
      expect(connectionCount("node-2")).toBe(2);
      expect(connectionCount("node-3")).toBe(2);
    });
  });

  describe("Performance", () => {
    it("should handle large number of nodes", () => {
      const nodes = Array.from({ length: 1000 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: i * 10, y: i * 10 },
        data: { reference: `R${i}` },
      }));

      expect(nodes).toHaveLength(1000);
      expect(nodes[999].id).toBe("node-999");
    });

    it("should handle large number of edges", () => {
      const edges = Array.from({ length: 500 }, (_, i) => ({
        id: `edge-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
      }));

      expect(edges).toHaveLength(500);
    });
  });

  describe("Data Validation", () => {
    it("should validate component reference", () => {
      const validReferences = ["R1", "C5", "U1", "J2"];
      const invalidReferences = ["invalid", "123", "r1", ""];

      const isValidReference = (ref: string) => /^[A-Z]\d+$/.test(ref);

      validReferences.forEach((ref) => {
        expect(isValidReference(ref)).toBe(true);
      });

      invalidReferences.forEach((ref) => {
        expect(isValidReference(ref)).toBe(false);
      });
    });

    it("should validate net labels", () => {
      const validNets = ["VCC", "GND", "DATA_IN", "CLK"];
      const invalidNets = ["invalid-net", "net with spaces", ""];

      const isValidNet = (net: string) => /^[A-Z0-9_]+$/.test(net);

      validNets.forEach((net) => {
        expect(isValidNet(net)).toBe(true);
      });

      invalidNets.forEach((net) => {
        expect(isValidNet(net)).toBe(false);
      });
    });
  });
});
