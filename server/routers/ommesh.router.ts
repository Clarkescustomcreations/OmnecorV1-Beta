// server/routers/ommesh.router.ts
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { router, protectedProcedure, adminProcedure } from '../_core/trpc.js';
import { meshNode } from '../ommesh/core/MeshNode.js';

const SETTINGS_PATH = join(homedir(), '.omnecor', 'settings.json');

function readSettings(): Record<string, unknown> {
  try {
    if (!existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(patch: Record<string, unknown>): void {
  const current = readSettings();
  const updated = { ...current, ...patch };
  const dir = join(homedir(), '.omnecor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf-8');
}

export const ommeshRouter = router({
  /**
   * Discover currently active peers on the LAN.
   */
  discover: protectedProcedure.query(async () => {
    return meshNode.getDiscovery().getPeers();
  }),

  /**
   * Route an inference task through the mesh.
   */
  routeInference: protectedProcedure
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
  rotateCert: adminProcedure
    .input(z.object({ force: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      return meshNode.getSecurity().rotateCertificate(!!input.force);
    }),

  /**
   * Approve a peer by its certificate fingerprint.
   */
  approvePeer: adminProcedure
    .input(z.object({ fingerprint: z.string() }))
    .mutation(async ({ input }) => {
      meshNode.getSecurity().approvePeer(input.fingerprint);
      return { success: true };
    }),

  /**
   * Get the local node's identity.
   */
  getIdentity: protectedProcedure.query(async () => {
    return meshNode.getIdentity();
  }),

  // ─── Cross-Node Sync ──────────────────────────────────────────────────────

  /**
   * Enable or disable automatic persona sync across mesh peers.
   * Persists the setting and immediately activates/deactivates the heartbeat.
   */
  setCrossNodeSync: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      meshNode.setCrossNodeSync(input.enabled);
      writeSettings({ 'ommesh.crossNodeSync': input.enabled });
      return { ok: true, crossNodeSync: input.enabled };
    }),

  /**
   * Enable or disable agent discourse routing through the mesh.
   */
  setAgentDiscourse: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      meshNode.setAgentDiscourse(input.enabled);
      writeSettings({ 'ommesh.agentDiscourse': input.enabled });
      return { ok: true, agentDiscourse: input.enabled };
    }),

  /**
   * Send an inter-agent message to an agent on a specific remote peer.
   */
  sendPeerDiscourse: protectedProcedure
    .input(z.object({
      peerId: z.string().min(1),
      fromAgentId: z.string().min(1),
      toAgentId: z.string().min(1),
      content: z.string().min(1).max(8000),
    }))
    .mutation(async ({ input }) => {
      return meshNode.sendPeerDiscourse(
        input.peerId,
        input.fromAgentId,
        input.toAgentId,
        input.content,
      );
    }),

  /**
   * Return the current state of cross-node sync and agent discourse settings,
   * reading from the persisted settings file as the source of truth.
   */
  getCrossNodeSyncStatus: protectedProcedure.query(() => {
    const settings = readSettings();
    const crossNodeSync = settings['ommesh.crossNodeSync'] === true;
    const agentDiscourse = settings['ommesh.agentDiscourse'] === true;
    return { crossNodeSync, agentDiscourse };
  }),
});

export default ommeshRouter;
