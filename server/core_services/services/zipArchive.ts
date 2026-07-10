/**
 * zipArchive — a minimal, dependency-free ZIP (DEFLATE) writer.
 *
 * Built on Node's `zlib` (crc32 + deflateRaw) so we don't pull a third-party
 * archiver into the bundle. Used to package KiCad Gerber/drill output into a
 * single archive for upload to a PCB fab house (PCBWay). Writes standard ZIP
 * with method 8 (deflate) and UTF-8 filenames; round-trip-verified in tests.
 */
import { deflateRawSync, crc32 } from "zlib";
import { promises as fs } from "fs";
import path from "path";

export interface ZipEntry {
  /** Archive-relative path (forward slashes). */
  name: string;
  data: Buffer;
}

/** Encode a Date as DOS time/date words (ZIP local/central header format). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const year = Math.max(1980, d.getFullYear());
  const date =
    (((year - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

/** Build a ZIP archive (in memory) from the given entries. */
export function createZip(entries: ZipEntry[], modTime = new Date()): Buffer {
  const { time, date } = dosDateTime(modTime);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data) >>> 0;
    const compressed = deflateRawSync(entry.data);
    const uncompSize = entry.data.length;
    const compSize = compressed.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // flags: bit 11 = UTF-8 filename
    local.writeUInt16LE(8, 8); // compression method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compSize, 18);
    local.writeUInt32LE(uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compSize, 20);
    central.writeUInt32LE(uncompSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 14); // central dir offset
  eocd.writeUInt16LE(0, 18); // comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** Recursively zip every file under `dir` (relative paths preserved). */
export async function createZipFromDir(dir: string): Promise<Buffer> {
  const entries: ZipEntry[] = [];

  async function walk(current: string, prefix: string): Promise<void> {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(full, rel);
      else if (item.isFile()) entries.push({ name: rel, data: await fs.readFile(full) });
    }
  }

  await walk(dir, "");
  if (entries.length === 0) throw new Error(`No files to archive in ${dir}`);
  return createZip(entries);
}
