import { describe, it, expect } from "vitest";
import { inflateRawSync, crc32 } from "zlib";
import { createZip } from "../phase2/services/zipArchive.js";
import {
  parseBoardSpecs,
  countCopperLayers,
  edgeCutsBoundingBox,
  snapToSupportedLayers,
} from "../phase2/services/kicadBoardSpecs.js";

describe("zipArchive.createZip", () => {
  it("produces a valid ZIP that round-trips via inflateRaw", () => {
    const a = Buffer.from("hello gerber");
    const b = Buffer.from("x".repeat(2000));
    const zip = createZip([
      { name: "a.gbr", data: a },
      { name: "sub/b.drl", data: b },
    ]);

    // Local file header signature (PK\x03\x04) and EOCD signature present.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.subarray(-22).readUInt32LE(0)).toBe(0x06054b50);
    // EOCD total-entries field.
    expect(zip.subarray(-22).readUInt16LE(10)).toBe(2);

    // Parse the first local entry and verify deflate round-trip + CRC.
    const method = zip.readUInt16LE(8);
    expect(method).toBe(8); // deflate
    const crc = zip.readUInt32LE(14);
    const compSize = zip.readUInt32LE(18);
    const nameLen = zip.readUInt16LE(26);
    const extraLen = zip.readUInt16LE(28);
    const name = zip.subarray(30, 30 + nameLen).toString("utf8");
    expect(name).toBe("a.gbr");
    const dataStart = 30 + nameLen + extraLen;
    const compressed = zip.subarray(dataStart, dataStart + compSize);
    const restored = inflateRawSync(compressed);
    expect(restored.equals(a)).toBe(true);
    expect(crc).toBe(crc32(a) >>> 0);
  });
});

describe("kicadBoardSpecs", () => {
  const board = `
    (kicad_pcb
      (layers
        (0 "F.Cu" signal)
        (31 "B.Cu" signal)
      )
      (gr_line (start 10 20) (end 110 20) (layer "Edge.Cuts"))
      (gr_line (start 110 20) (end 110 70) (layer "Edge.Cuts"))
      (gr_line (start 110 70) (end 10 70) (layer "Edge.Cuts"))
      (gr_line (start 10 70) (end 10 20) (layer "Edge.Cuts"))
      (gr_line (start 0 0) (end 200 200) (layer "F.SilkS"))
    )`;

  it("computes the Edge.Cuts bounding box (ignoring non-edge graphics)", () => {
    const bbox = edgeCutsBoundingBox(board);
    expect(bbox).toEqual({ lengthMm: 100, widthMm: 50 });
  });

  it("counts copper layers from the stackup", () => {
    expect(countCopperLayers(board)).toBe(2);
    const fourLayer = `(layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal) (31 "B.Cu" signal))`;
    expect(countCopperLayers(fourLayer)).toBe(4);
  });

  it("derives full board specs (length = longer side, width = shorter)", () => {
    const specs = parseBoardSpecs(board);
    expect(specs).toMatchObject({ lengthMm: 100, widthMm: 50, layers: 2, outlineFound: true });
  });

  it("snaps odd/unsupported layer counts up to PCBWay-supported values", () => {
    expect(snapToSupportedLayers(1)).toBe(1);
    expect(snapToSupportedLayers(3)).toBe(4);
    expect(snapToSupportedLayers(5)).toBe(6);
    expect(snapToSupportedLayers(99)).toBe(14);
  });

  it("falls back to prototype defaults when no Edge.Cuts outline exists", () => {
    const specs = parseBoardSpecs(`(kicad_pcb (layers (0 "F.Cu" signal) (31 "B.Cu" signal)))`);
    expect(specs).toMatchObject({ lengthMm: 50, widthMm: 50, layers: 2, outlineFound: false });
  });
});
