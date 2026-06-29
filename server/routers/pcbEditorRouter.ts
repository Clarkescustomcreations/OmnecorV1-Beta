/**
 * PCB Editor tRPC Router
 * 
 * Procedures for:
 * - Project management
 * - Design persistence
 * - AI assistance
 * - Exports
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc.js";
import { assertProviderAllowedInMode } from "../_core/sovereign.js";
import {
  createProject,
  getProjectsByUserId,
  getProjectById,
  updateProject,
  deleteProject,
  saveDesign,
  getDesignById,
  getLatestDesign,
  getDesignVersions,
  deleteDesign,
  createExport,
  getExportsByDesign,
  createAIReview,
  getAIReviewsByDesign,
} from "../db-pcb.js";

const CanvasDataSchema = z.object({
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const pcbEditorRouter = router({
  // ========================================================================
  // PROJECT MANAGEMENT
  // ========================================================================

  createProject: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        mode: z.enum(["schematic", "pcb"]).default("schematic"),
        // Links the project to the active neural map so it scopes correctly
        // (e.g. the mobile viewer filters projects by mapId).
        mapId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await createProject(
        ctx.user.id,
        input.name,
        input.description,
        input.mode,
        input.mapId ?? null
      );

      if (!project) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create project",
        });
      }

      return project;
    }),

  getProjects: protectedProcedure.query(async ({ ctx }) => {
    return getProjectsByUserId(ctx.user.id);
  }),

  getProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);

      if (!project || project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return project;
    }),

  updateProject: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);

      if (!project || project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const updated = await updateProject(input.projectId, {
        name: input.name,
        description: input.description,
      });

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update project",
        });
      }

      return updated;
    }),

  deleteProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);

      if (!project || project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const success = await deleteProject(input.projectId);

      if (!success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete project",
        });
      }

      return { success: true };
    }),

  // ========================================================================
  // DESIGN SAVES
  // ========================================================================

  saveDesign: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        name: z.string().min(1).max(255),
        canvasData: CanvasDataSchema,
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);

      if (!project || project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const design = await saveDesign(
        input.projectId,
        ctx.user.id,
        input.name,
        input.canvasData,
        input.description,
        // Inherit the parent project's map so a design version is always scoped
        // to the same neural map as its project (no client involvement needed).
        project.mapId ?? null
      );

      if (!design) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save design",
        });
      }

      return design;
    }),

  loadDesign: protectedProcedure
    .input(z.object({ designSaveId: z.number() }))
    .query(async ({ ctx, input }) => {
      const design = await getDesignById(input.designSaveId);

      if (!design || design.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design not found",
        });
      }

      return {
        ...design,
        canvasData: typeof design.canvasData === "string"
          ? JSON.parse(design.canvasData)
          : design.canvasData,
      };
    }),

  getLatestDesign: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);

      if (!project || project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const design = await getLatestDesign(input.projectId);

      if (!design) {
        return null;
      }

      return {
        ...design,
        canvasData: typeof design.canvasData === "string"
          ? JSON.parse(design.canvasData)
          : design.canvasData,
      };
    }),

  getDesignVersions: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);

      if (!project || project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return getDesignVersions(input.projectId);
    }),

  deleteDesign: protectedProcedure
    .input(z.object({ designSaveId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const design = await getDesignById(input.designSaveId);

      if (!design || design.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design not found",
        });
      }

      const success = await deleteDesign(input.designSaveId);

      if (!success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete design",
        });
      }

      return { success: true };
    }),

  // ========================================================================
  // AI ASSISTANCE
  // ========================================================================

  reviewDesign: protectedProcedure
    .input(
      z.object({
        designSaveId: z.number(),
        prompt: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // reviewDesign calls the cloud "openai" provider directly — block sovereign users.
      assertProviderAllowedInMode("openai", ctx.user?.executionMode);
      const design = await getDesignById(input.designSaveId);

      if (!design || design.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design not found",
        });
      }

      const canvasData = typeof design.canvasData === "string"
        ? JSON.parse(design.canvasData)
        : design.canvasData;

      // Build context for LLM
      const componentList = canvasData.nodes
        ?.map((n: any) => `${n.data.reference}: ${n.data.value}`)
        .join(", ") || "No components";

      const systemPrompt = `You are an expert PCB and schematic design assistant. 
Analyze the provided design and provide helpful feedback, suggestions, and answers to questions.
Consider best practices for circuit design, component selection, and PCB layout.`;

      const userPrompt = `Design Analysis:
- Mode: ${canvasData.metadata?.mode || 'unknown'}
- Components: ${design.componentCount}
- Connections: ${design.connectionCount}
- Component List: ${componentList}

User Question: ${input.prompt}`;

      try {
        const response = await ctx.services.aiProvider.chat({
          providerId: "openai",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          modelId: "gpt-4o"
        });

        const responseText = response || "Unable to generate response";

        // Store review in database
        await createAIReview(
          input.designSaveId,
          ctx.user.id,
          input.prompt,
          responseText,
          design.componentCount || 0,
          design.connectionCount || 0,
          canvasData.metadata?.mode || "schematic"
        );

        return { response: responseText };
      } catch (error) {
        console.error("LLM error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate AI response",
        });
      }
    }),

  getAIReviews: protectedProcedure
    .input(z.object({ designSaveId: z.number() }))
    .query(async ({ ctx, input }) => {
      const design = await getDesignById(input.designSaveId);

      if (!design || design.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design not found",
        });
      }

      return getAIReviewsByDesign(input.designSaveId);
    }),

  // ========================================================================
  // EXPORTS
  // ========================================================================

  exportDesign: protectedProcedure
    .input(
      z.object({
        designSaveId: z.number(),
        format: z.enum(["svg", "png", "pdf"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const design = await getDesignById(input.designSaveId);

      if (!design || design.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design not found",
        });
      }

      // Generate export filename
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `design-${design.id}-${timestamp}.${input.format}`;

      const fileUrl = `/exports/${filename}`;

      const exportRecord = await createExport(
        input.designSaveId,
        ctx.user.id,
        input.format,
        fileUrl
      );

      if (!exportRecord) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create export",
        });
      }

      return {
        fileUrl: exportRecord.fileUrl,
        format: exportRecord.format,
        createdAt: exportRecord.createdAt,
      };
    }),

  getExports: protectedProcedure
    .input(z.object({ designSaveId: z.number() }))
    .query(async ({ ctx, input }) => {
      const design = await getDesignById(input.designSaveId);

      if (!design || design.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design not found",
        });
      }

      return getExportsByDesign(input.designSaveId);
    }),
});

export type PcbEditorRouter = typeof pcbEditorRouter;
