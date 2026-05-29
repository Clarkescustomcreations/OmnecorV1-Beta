// server/routers/ommesh.router.ts
import { z } from 'zod';
import { router, publicProcedure } from '../_core/trpc.js';
import { meshNode } from '../ommesh/core/MeshNode.js';

export const ommeshRouter = router({
  /**
   * Discover currently active peers on the LAN.
   */
  discover: publicProcedure.query(async () => {
    return meshNode.getDiscovery().getPeers();
  }),

  /**
   * Route an inference task through the mesh.
   */
  routeInference: publicProcedure
    .input(z.object({
      prompt: z.string(),
      options: z.record(z.string(), z.any()).optional()
    }))
    .mutation(async ({ input }) => {
      return meshNode.routeInference(input.prompt, input.options || {});
    }),

  /**
   * Manually trigger certificate rotation.
   */
  rotateCert: publicProcedure
    .input(z.object({ force: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      return meshNode.getSecurity().rotateCertificate(!!input.force);
    }),

  /**
   * Approve a peer by its certificate fingerprint.
   */
  approvePeer: publicProcedure
    .input(z.object({ fingerprint: z.string() }))
    .mutation(async ({ input }) => {
      meshNode.getSecurity().approvePeer(input.fingerprint);
      return { success: true };
    }),

  /**
   * Get the local node's identity.
   */
  getIdentity: publicProcedure.query(async () => {
    return meshNode.getIdentity();
  })
});

export default ommeshRouter;
