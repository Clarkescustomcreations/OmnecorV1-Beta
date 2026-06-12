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
  mode: "schematic" | "pcb" = "schematic"
): Promise<DesignProject | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .insert(designProjects)
    .values({ userId, name, description, mode });

  const insertId = (result as any)[0]?.insertId;

  return {
    id: insertId || 0,
    userId,
    name,
    description: description || null,
    mode,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getProjectsByUserId(userId: number): Promise<DesignProject[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(designProjects)
    .where(eq(designProjects.userId, userId))
    .orderBy(desc(designProjects.updatedAt));
}

export async function getProjectById(projectId: number): Promise<DesignProject | null> {
  const db = await getDb();
  if (!db) return null;

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
  if (!db) return null;

  await db
    .update(designProjects)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(designProjects.id, projectId));

  return getProjectById(projectId);
}

export async function deleteProject(projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Delete all related saves and exports
  const saves = await db
    .select({ id: designSaves.id })
    .from(designSaves)
    .where(eq(designSaves.projectId, projectId));

  const saveIds = saves.map((save) => save.id);
  if (saveIds.length > 0) {
    await db
      .delete(designExports)
      .where(inArray(designExports.designSaveId, saveIds));
    await db
      .delete(aiDesignReviews)
      .where(inArray(aiDesignReviews.designSaveId, saveIds));
  }

  await db
    .delete(designSaves)
    .where(eq(designSaves.projectId, projectId));

  await db
    .delete(designProjects)
    .where(eq(designProjects.id, projectId));

  return true;
}

// ============================================================================
// DESIGN SAVES
// ============================================================================

export async function saveDesign(
  projectId: number,
  userId: number,
  name: string,
  canvasData: any,
  description?: string
): Promise<DesignSave | null> {
  const db = await getDb();
  if (!db) return null;

  const componentCount = canvasData.nodes?.length || 0;
  const connectionCount = canvasData.edges?.length || 0;

  // Mark previous saves as not latest
  await db
    .update(designSaves)
    .set({ isLatest: 0 })
    .where(
      and(
        eq(designSaves.projectId, projectId),
        eq(designSaves.isLatest, 1)
      )
    );

  const result = await db
    .insert(designSaves)
    .values({
      projectId,
      userId,
      name,
      description: description || null,
      canvasData: JSON.stringify(canvasData),
      componentCount,
      connectionCount,
      version: 1,
      isLatest: 1,
    });

  const insertId = (result as any)[0]?.insertId;

  return {
    id: insertId || 0,
    projectId,
    userId,
    name,
    description: description || null,
    canvasData: JSON.stringify(canvasData),
    componentCount,
    connectionCount,
    version: 1,
    isLatest: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getDesignById(designSaveId: number): Promise<DesignSave | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(designSaves)
    .where(eq(designSaves.id, designSaveId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getLatestDesign(projectId: number): Promise<DesignSave | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(designSaves)
    .where(
      and(
        eq(designSaves.projectId, projectId),
        eq(designSaves.isLatest, 1)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getDesignVersions(projectId: number): Promise<DesignSave[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(designSaves)
    .where(eq(designSaves.projectId, projectId))
    .orderBy(desc(designSaves.createdAt));
}

export async function deleteDesign(designSaveId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Delete related exports and reviews
  await db
    .delete(designExports)
    .where(eq(designExports.designSaveId, designSaveId));

  await db
    .delete(aiDesignReviews)
    .where(eq(aiDesignReviews.designSaveId, designSaveId));

  await db
    .delete(designSaves)
    .where(eq(designSaves.id, designSaveId));

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
  if (!db) return null;

  const result = await db
    .insert(componentLibraryItems)
    .values({
      ...component,
      userId,
      properties: JSON.stringify(component.properties),
      handles: JSON.stringify(component.handles),
      tags: JSON.stringify(component.tags),
    });

  const insertId = (result as any)[0]?.insertId;

  return {
    id: insertId || 0,
    ...component,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getComponentLibrary(userId: number): Promise<ComponentLibraryItem[]> {
  const db = await getDb();
  if (!db) return [];

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
  if (!db) return null;

  const result = await db
    .select()
    .from(componentLibraryItems)
    .where(
      and(
        eq(componentLibraryItems.componentId, componentId),
        eq(componentLibraryItems.userId, userId)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function deleteComponent(
  componentId: string,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .delete(componentLibraryItems)
    .where(
      and(
        eq(componentLibraryItems.componentId, componentId),
        eq(componentLibraryItems.userId, userId)
      )
    );

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
  if (!db) return null;

  const result = await db
    .insert(designExports)
    .values({
      designSaveId,
      userId,
      format,
      fileUrl,
      fileSize: fileSize || null,
    });

  const insertId = (result as any)[0]?.insertId;

  return {
    id: insertId || 0,
    designSaveId,
    userId,
    format,
    fileUrl,
    fileSize: fileSize || null,
    createdAt: new Date(),
  };
}

export async function getExportsByDesign(designSaveId: number): Promise<DesignExport[]> {
  const db = await getDb();
  if (!db) return [];

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
  if (!db) return null;

  const result = await db
    .insert(aiDesignReviews)
    .values({
      designSaveId,
      userId,
      prompt,
      response,
      componentCount: componentCount || null,
      connectionCount: connectionCount || null,
      mode: mode || null,
    });

  const insertId = (result as any)[0]?.insertId;

  return {
    id: insertId || 0,
    designSaveId,
    userId,
    prompt,
    response,
    componentCount: componentCount || null,
    connectionCount: connectionCount || null,
    mode: mode || null,
    createdAt: new Date(),
  };
}

export async function getAIReviewsByDesign(designSaveId: number): Promise<AIDesignReview[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(aiDesignReviews)
    .where(eq(aiDesignReviews.designSaveId, designSaveId))
    .orderBy(desc(aiDesignReviews.createdAt));
}

export async function getAIReviewsByUser(userId: number): Promise<AIDesignReview[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(aiDesignReviews)
    .where(eq(aiDesignReviews.userId, userId))
    .orderBy(desc(aiDesignReviews.createdAt))
    .limit(50);
}
