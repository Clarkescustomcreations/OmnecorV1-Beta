/**
 * @file server/core_services/app.ts
 * @deprecated This standalone server has been REMOVED.
 *
 * All Phase 2 services are now integrated into the main Express server
 * at server/_core/index.ts, running on port 3000.
 *
 * The split-brain architecture (two separate Express servers on ports 3000
 * and 3100) has been eliminated. All tRPC endpoints are now accessible
 * via the unified /api/trpc/ endpoint on the main server.
 *
 * Migration Summary:
 *   - Phase 2 sub-routers now import from server/_core/trpc.ts (unified context)
 *   - All sub-routers are mounted in server/routers.ts (unified appRouter)
 *   - WebSocket server is attached to the main HTTP server in server/_core/index.ts
 *   - Service initialization and graceful shutdown are handled by the main server
 *
 * If you need to start the Omnecor backend, use:
 *   npx tsx server/_core/index.ts
 *
 * DO NOT start this file independently.
 */

throw new Error(
  "[Omnecor] server/core_services/app.ts is DEPRECATED. " +
    "The standalone Phase 2 server has been merged into the main server. " +
    "Start the application with: npx tsx server/_core/index.ts"
);
