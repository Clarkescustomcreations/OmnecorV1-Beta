/**
 * @file server/routers/integrationManagementRouter.ts
 * @description Integration health checks, lifecycle, and token management
 *
 * Provides unified tRPC procedures for:
 *   - listAll: list all integrations with health status
 *   - checkHealth: verify a single integration's connectivity
 *   - refreshToken: attempt to refresh an OAuth token
 *   - disconnect: remove an integration
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { integrationManagementService } from "../phase2/services/IntegrationManagementService.js";

export const integrationManagementRouter = router({
  /**
   * List all integrations for the current user with their health status.
   * No input required.
   */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    try {
      const integrations = await integrationManagementService.listIntegrations(
        String(ctx.user.id),
        ctx.db,
      );
      return integrations;
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to list integrations: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }),

  /**
   * Check health of a specific integration.
   * Input: { integrationId: string } e.g. "github", "openai", "slack"
   */
  checkHealth: protectedProcedure
    .input(z.object({ integrationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      try {
        const health = await integrationManagementService.checkHealth(
          input.integrationId,
          String(ctx.user.id),
          ctx.db,
        );
        return health;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to check health: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Attempt to refresh an OAuth token.
   * Input: { integrationId: string }
   * Returns: { success: boolean; message: string; tokenExpiresAt?: string }
   */
  refreshToken: protectedProcedure
    .input(z.object({ integrationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      try {
        const result = await integrationManagementService.refreshToken(
          input.integrationId,
          String(ctx.user.id),
          ctx.db,
        );

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.message,
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Disconnect (deactivate) an integration.
   * Input: { integrationId: string }
   * Returns: { success: boolean; message: string }
   */
  disconnect: protectedProcedure
    .input(z.object({ integrationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      try {
        const result = await integrationManagementService.disconnectIntegration(
          input.integrationId,
          String(ctx.user.id),
          ctx.db,
        );

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.message,
          });
        }

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),
});
