/**
 * @file server/db-models.ts
 * @description Data-access helpers for the 3D model library (model_assets).
 *
 * Files live on disk in PATHS.models; these rows are the *association layer* that
 * binds each mesh to a neural map (mapId null = global) and, optionally, to a
 * specific PCB/schematic design project. That linkage is what lets the assistant
 * reason about a project's 3D housing and its PCB/schematic together — see
 * {@link getMapDesignContext}.
 */

import { eq, and, or, isNull, desc } from "drizzle-orm";
import { getDb } from "./db.factory.js";
import {
  modelAssets,
  designProjects,
  designSaves,
  type ModelAsset,
  type InsertModelAsset,
} from "../drizzle/schema.js";

export interface RegisterModelInput {
  userId: number;
  fileName: string; // basename in PATHS.models (unique)
  name: string; // display name
  format: "glb" | "gltf";
  size?: number;
  source?: "blender" | "comfy" | "upload";
  mapId?: string | null; // null = global
  designProjectId?: number | null;
}

/**
 * Upsert this user's association row for a library file, keyed by (userId,
 * fileName). Re-registering the same file updates *that user's* metadata rather
 * than erroring, so a re-export or re-import stays consistent. Because the
 * library is a shared file namespace, the conflict target is the composite
 * (userId, fileName) — registering a file another user already tracks inserts a
 * separate row for this user instead of clobbering theirs.
 */
export async function registerModelAsset(input: RegisterModelInput): Promise<ModelAsset> {
  const db = await getDb();
  const row: InsertModelAsset = {
    userId: input.userId,
    fileName: input.fileName,
    name: input.name,
    format: input.format,
    size: input.size ?? 0,
    source: input.source ?? "upload",
    mapId: input.mapId ?? null,
    designProjectId: input.designProjectId ?? null,
  };
  await db
    .insert(modelAssets)
    .values(row)
    .onConflictDoUpdate({
      target: [modelAssets.userId, modelAssets.fileName],
      set: {
        name: row.name,
        format: row.format,
        size: row.size,
        source: row.source,
        mapId: row.mapId,
        designProjectId: row.designProjectId,
        updatedAt: new Date(),
      },
    });
  const [saved] = await db
    .select()
    .from(modelAssets)
    .where(and(eq(modelAssets.userId, input.userId), eq(modelAssets.fileName, input.fileName)))
    .limit(1);
  return saved;
}

/** All model-library rows owned by a user (association metadata only). */
export async function listModelAssets(userId: number): Promise<ModelAsset[]> {
  const db = await getDb();
  return db.select().from(modelAssets).where(eq(modelAssets.userId, userId));
}

/**
 * Re-assign a model to a different map and/or PCB project (or clear either).
 * Ownership-scoped: only the owner's row is touched. Returns the updated row or
 * null when no such file belongs to the user.
 */
export async function assignModelAsset(
  userId: number,
  fileName: string,
  patch: { mapId?: string | null; designProjectId?: number | null; name?: string }
): Promise<ModelAsset | null> {
  const db = await getDb();
  const set: Partial<InsertModelAsset> = { updatedAt: new Date() };
  if ("mapId" in patch) set.mapId = patch.mapId ?? null;
  if ("designProjectId" in patch) set.designProjectId = patch.designProjectId ?? null;
  if (patch.name !== undefined) set.name = patch.name;
  await db
    .update(modelAssets)
    .set(set)
    .where(and(eq(modelAssets.userId, userId), eq(modelAssets.fileName, fileName)));
  const [row] = await db
    .select()
    .from(modelAssets)
    .where(and(eq(modelAssets.userId, userId), eq(modelAssets.fileName, fileName)))
    .limit(1);
  return row ?? null;
}

/** Delete a model-library row (ownership-scoped). The on-disk file is removed by the caller. */
export async function deleteModelAsset(userId: number, fileName: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(modelAssets)
    .where(and(eq(modelAssets.userId, userId), eq(modelAssets.fileName, fileName)));
}

export interface MapDesignContext {
  /** 3D models visible in this map (map-scoped + global). */
  models: {
    fileName: string;
    name: string;
    format: string;
    source: string;
    mapId: string | null;
    designProjectId: number | null;
  }[];
  /** Latest PCB/schematic design per project in this map. */
  designs: {
    projectId: number;
    projectName: string;
    designId: number;
    designName: string;
    componentCount: number;
    connectionCount: number;
    references: string[];
  }[];
  /** A ready-to-inject natural-language summary combining both sides. */
  contextText: string;
}

/**
 * Assemble the combined design context for a map: every 3D model that belongs to
 * it (or is global) plus the latest PCB/schematic design of each of its design
 * projects. This is what the assistant reads so it can see the housing and the
 * board of the same project at once, and understand which mesh encloses which
 * design via the explicit designProjectId link.
 */
export async function getMapDesignContext(
  userId: number,
  mapId: string | null
): Promise<MapDesignContext> {
  const db = await getDb();

  // Models: map-scoped OR global (mapId null). When no map is selected, all of
  // the user's models are in scope.
  const modelRows = await db
    .select()
    .from(modelAssets)
    .where(
      mapId
        ? and(
            eq(modelAssets.userId, userId),
            or(eq(modelAssets.mapId, mapId), isNull(modelAssets.mapId))
          )
        : eq(modelAssets.userId, userId)
    );

  // PCB/schematic projects in this map, with their latest design.
  const projectRows = await db
    .select()
    .from(designProjects)
    .where(
      mapId
        ? and(eq(designProjects.userId, userId), eq(designProjects.mapId, mapId))
        : eq(designProjects.userId, userId)
    );

  const designs: MapDesignContext["designs"] = [];
  for (const proj of projectRows) {
    const [latest] = await db
      .select()
      .from(designSaves)
      .where(and(eq(designSaves.projectId, proj.id), eq(designSaves.isLatest, 1)))
      .orderBy(desc(designSaves.updatedAt))
      .limit(1);
    if (!latest) continue;
    const canvas = (latest.canvasData ?? {}) as { nodes?: any[]; edges?: any[] };
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
    const references = nodes
      .map((n: any) => String(n?.data?.reference ?? n?.data?.label ?? n?.id ?? ""))
      .filter(Boolean)
      .slice(0, 40);
    designs.push({
      projectId: proj.id,
      projectName: proj.name,
      designId: latest.id,
      designName: latest.name,
      componentCount: latest.componentCount ?? nodes.length,
      connectionCount: latest.connectionCount ?? (Array.isArray(canvas.edges) ? canvas.edges.length : 0),
      references,
    });
  }

  const models = modelRows.map((m) => ({
    fileName: m.fileName,
    name: m.name,
    format: m.format,
    source: m.source,
    mapId: m.mapId,
    designProjectId: m.designProjectId,
  }));

  // Build the natural-language summary the AI reads.
  const lines: string[] = [];
  if (models.length) {
    lines.push(`3D models in this project (${models.length}):`);
    for (const m of models) {
      const link = m.designProjectId
        ? ` — linked to PCB project #${m.designProjectId}`
        : m.mapId
        ? ""
        : " (global)";
      lines.push(`  • ${m.name} [${m.format}, via ${m.source}]${link}`);
    }
  }
  if (designs.length) {
    lines.push(`PCB/schematic designs in this project (${designs.length}):`);
    for (const d of designs) {
      lines.push(
        `  • ${d.projectName} → "${d.designName}": ${d.componentCount} components, ${d.connectionCount} connections` +
          (d.references.length ? ` (refs: ${d.references.join(", ")})` : "")
      );
    }
  }
  const contextText = lines.length
    ? `This project's linked hardware + 3D assets:\n${lines.join("\n")}`
    : "This project has no linked 3D models or PCB/schematic designs yet.";

  return { models, designs, contextText };
}
