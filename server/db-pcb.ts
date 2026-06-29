/**
 * PCB Editor Database Helpers
 *
 * Query functions for:
 * - Project management
 * - Design persistence
 * - Component library
 * - AI reviews
 * - Exports
 */

import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db.factory.js";
import {
  designProjects,
  designSaves,
  componentLibraryItems,
  designExports,
  aiDesignReviews,
  type DesignProject,
  type DesignSave,
  type ComponentLibraryItem,
  type DesignExport,
  type AIDesignReview,
} from "../drizzle/schema.js";

// ============================================================================
// PROJECT MANAGEMENT
// ============================================================================

export async function createProject(
  userId: number,
  name: string,
  description?: string,
  mode: "schematic" | "pcb" = "schematic",
  mapId?: string | null
): Promise<DesignProject | null> {
  const db = await getDb();

  const [row] = await db
    .insert(designProjects)
    .values({ userId, name, description, mode, mapId: mapId ?? null })
    .returning({ id: designProjects.id });

  return {
    id: row.id,
    userId,
    name,
    description: description ?? null,
    mode,
    mapId: mapId ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getProjectsByUserId(userId: number): Promise<DesignProject[]> {
  const db = await getDb();

  return db
    .select()
    .from(designProjects)
    .where(eq(designProjects.userId, userId))
    .orderBy(desc(designProjects.updatedAt));
}

export async function getProjectById(projectId: number): Promise<DesignProject | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(designProjects)
    .where(eq(designProjects.id, projectId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateProject(
  projectId: number,
  updates: Partial<{ name: string; description: string; mode: string }>
): Promise<DesignProject | null> {
  const db = await getDb();

  await db
    .update(designProjects)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(designProjects.id, projectId));

  return getProjectById(projectId);
}

export async function deleteProject(projectId: number): Promise<boolean> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    const saves = await tx
      .select({ id: designSaves.id })
      .from(designSaves)
      .where(eq(designSaves.projectId, projectId));

    const saveIds = saves.map((s) => s.id);
    if (saveIds.length > 0) {
      await tx.delete(designExports).where(inArray(designExports.designSaveId, saveIds));
      await tx.delete(aiDesignReviews).where(inArray(aiDesignReviews.designSaveId, saveIds));
    }

    await tx.delete(designSaves).where(eq(designSaves.projectId, projectId));
    await tx.delete(designProjects).where(eq(designProjects.id, projectId));
  });

  return true;
}

// ============================================================================
// DESIGN SAVES
// ============================================================================

export async function saveDesign(
  projectId: number,
  userId: number,
  name: string,
  canvasData: unknown,
  description?: string,
  mapId?: string | null
): Promise<DesignSave | null> {
  const db = await getDb();

  const componentCount = (canvasData as { nodes?: unknown[] })?.nodes?.length ?? 0;
  const connectionCount = (canvasData as { edges?: unknown[] })?.edges?.length ?? 0;

  const [row] = await db.transaction(async (tx) => {
    await tx
      .update(designSaves)
      .set({ isLatest: 0 })
      .where(and(eq(designSaves.projectId, projectId), eq(designSaves.isLatest, 1)));

    return tx
      .insert(designSaves)
      .values({
        projectId,
        userId,
        name,
        description: description ?? null,
        canvasData: JSON.stringify(canvasData),
        componentCount,
        connectionCount,
        version: 1,
        isLatest: 1,
        mapId: mapId ?? null,
      })
      .returning({ id: designSaves.id });
  });

  return {
    id: row.id,
    projectId,
    userId,
    name,
    description: description ?? null,
    canvasData: JSON.stringify(canvasData),
    componentCount,
    connectionCount,
    version: 1,
    isLatest: 1,
    mapId: mapId ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getDesignById(designSaveId: number): Promise<DesignSave | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(designSaves)
    .where(eq(designSaves.id, designSaveId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getLatestDesign(projectId: number): Promise<DesignSave | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(designSaves)
    .where(and(eq(designSaves.projectId, projectId), eq(designSaves.isLatest, 1)))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getDesignVersions(projectId: number): Promise<DesignSave[]> {
  const db = await getDb();

  return db
    .select()
    .from(designSaves)
    .where(eq(designSaves.projectId, projectId))
    .orderBy(desc(designSaves.createdAt));
}

export async function deleteDesign(designSaveId: number): Promise<boolean> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    await tx.delete(designExports).where(eq(designExports.designSaveId, designSaveId));
    await tx.delete(aiDesignReviews).where(eq(aiDesignReviews.designSaveId, designSaveId));
    await tx.delete(designSaves).where(eq(designSaves.id, designSaveId));
  });

  return true;
}

// ============================================================================
// COMPONENT LIBRARY
// ============================================================================

export async function addComponentToLibrary(
  userId: number,
  component: Omit<ComponentLibraryItem, "id" | "createdAt" | "updatedAt">
): Promise<ComponentLibraryItem | null> {
  const db = await getDb();

  const [row] = await db
    .insert(componentLibraryItems)
    .values({
      ...component,
      userId,
      properties: JSON.stringify(component.properties),
      handles: JSON.stringify(component.handles),
      tags: JSON.stringify(component.tags),
    })
    .returning({ id: componentLibraryItems.id });

  return {
    id: row.id,
    ...component,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getComponentLibrary(userId: number): Promise<ComponentLibraryItem[]> {
  const db = await getDb();

  return db
    .select()
    .from(componentLibraryItems)
    .where(eq(componentLibraryItems.userId, userId))
    .orderBy(componentLibraryItems.category);
}

export async function getComponentById(
  componentId: string,
  userId: number
): Promise<ComponentLibraryItem | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(componentLibraryItems)
    .where(and(eq(componentLibraryItems.componentId, componentId), eq(componentLibraryItems.userId, userId)))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function deleteComponent(
  componentId: string,
  userId: number
): Promise<boolean> {
  const db = await getDb();

  await db
    .delete(componentLibraryItems)
    .where(and(eq(componentLibraryItems.componentId, componentId), eq(componentLibraryItems.userId, userId)));

  return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

export async function createExport(
  designSaveId: number,
  userId: number,
  format: "svg" | "png" | "pdf",
  fileUrl: string,
  fileSize?: number
): Promise<DesignExport | null> {
  const db = await getDb();

  const [row] = await db
    .insert(designExports)
    .values({ designSaveId, userId, format, fileUrl, fileSize: fileSize ?? null })
    .returning({ id: designExports.id });

  return {
    id: row.id,
    designSaveId,
    userId,
    format,
    fileUrl,
    fileSize: fileSize ?? null,
    createdAt: new Date(),
  };
}

export async function getExportsByDesign(designSaveId: number): Promise<DesignExport[]> {
  const db = await getDb();

  return db
    .select()
    .from(designExports)
    .where(eq(designExports.designSaveId, designSaveId))
    .orderBy(desc(designExports.createdAt));
}

// ============================================================================
// AI REVIEWS
// ============================================================================

export async function createAIReview(
  designSaveId: number,
  userId: number,
  prompt: string,
  response: string,
  componentCount?: number,
  connectionCount?: number,
  mode?: "schematic" | "pcb"
): Promise<AIDesignReview | null> {
  const db = await getDb();

  const [row] = await db
    .insert(aiDesignReviews)
    .values({
      designSaveId,
      userId,
      prompt,
      response,
      componentCount: componentCount ?? null,
      connectionCount: connectionCount ?? null,
      mode: mode ?? null,
    })
    .returning({ id: aiDesignReviews.id });

  return {
    id: row.id,
    designSaveId,
    userId,
    prompt,
    response,
    componentCount: componentCount ?? null,
    connectionCount: connectionCount ?? null,
    mode: mode ?? null,
    createdAt: new Date(),
  };
}

export async function getAIReviewsByDesign(designSaveId: number): Promise<AIDesignReview[]> {
  const db = await getDb();

  return db
    .select()
    .from(aiDesignReviews)
    .where(eq(aiDesignReviews.designSaveId, designSaveId))
    .orderBy(desc(aiDesignReviews.createdAt));
}

export async function getAIReviewsByUser(userId: number): Promise<AIDesignReview[]> {
  const db = await getDb();

  return db
    .select()
    .from(aiDesignReviews)
    .where(eq(aiDesignReviews.userId, userId))
    .orderBy(desc(aiDesignReviews.createdAt))
    .limit(50);
}
