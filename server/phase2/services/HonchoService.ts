/**
 * @file server/phase2/services/HonchoService.ts
 * @description Omnecor — Honcho Memory Layer
 *
 * Honcho is an external user/session memory service from Plastic Labs.
 * It persists per-user facts (btw notes), conversation history, and
 * long-term preferences across sessions — complementing the local
 * ChromaDB/MemoryArchitectService with a cloud-backed "external brain".
 *
 * API hierarchy: app → user → session → messages
 *                          → metamessages (facts / summaries)
 *
 * When HONCHO_API_KEY is not set the service degrades silently — all
 * write methods become no-ops and reads return empty arrays so the rest
 * of the system keeps working without Honcho configured.
 */

import Honcho from "honcho-ai";
import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("Honcho");

// Metamessage label used to store user facts (btw notes, inferred preferences)
const FACT_LABEL = "omnecor_fact";

export class HonchoService {
  private static instance: HonchoService | null = null;

  private client: Honcho | null = null;
  private appId: string | null = null;

  private constructor() {
    if (!ENV.honchoApiKey) {
      log.warn("HONCHO_API_KEY not set — Honcho memory layer disabled");
      return;
    }
    this.client = new Honcho({
      apiKey: ENV.honchoApiKey,
      environment: ENV.honchoEnvironment,
    });
  }

  static getInstance(): HonchoService {
    if (!HonchoService.instance) {
      HonchoService.instance = new HonchoService();
    }
    return HonchoService.instance;
  }

  private get enabled() { return !!this.client; }

  /** Resolve and cache the Honcho App ID for this Omnecor instance. */
  private async getAppId(): Promise<string | null> {
    if (this.appId) return this.appId;
    if (!this.client) return null;
    try {
      const app = await this.client.apps.getOrCreate(ENV.honchoAppName);
      this.appId = app.id;
      return this.appId;
    } catch (err) {
      log.warn("Honcho getOrCreate app failed:", (err as Error).message);
      return null;
    }
  }

  /** Get or create a Honcho user keyed by Omnecor openId. */
  async getOrCreateUser(openId: string): Promise<string | null> {
    if (!this.enabled) return null;
    const appId = await this.getAppId();
    if (!appId) return null;
    try {
      const user = await this.client!.apps.users.getOrCreate(appId, openId);
      return user.id;
    } catch (err) {
      log.warn("Honcho getOrCreateUser failed:", (err as Error).message);
      return null;
    }
  }

  /** Get or create a Honcho session keyed by Omnecor conversation ID. */
  async getOrCreateSession(
    openId: string,
    sessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.enabled) return null;
    const appId = await this.getAppId();
    if (!appId) return null;
    try {
      const userId = await this.getOrCreateUser(openId);
      if (!userId) return null;

      // Try to find an existing session by metadata marker
      const sessions = await this.client!.apps.users.sessions.list(appId, userId);
      const existing = sessions.items?.find(
        (s: { id: string; metadata?: Record<string, unknown> }) =>
          (s.metadata as Record<string, unknown>)?.omnecorSessionId === sessionId
      );
      if (existing) return existing.id;

      const created = await this.client!.apps.users.sessions.create(appId, userId, {
        metadata: { omnecorSessionId: sessionId, ...metadata },
      });
      return created.id;
    } catch (err) {
      log.warn("Honcho getOrCreateSession failed:", (err as Error).message);
      return null;
    }
  }

  /** Sync a single message to a Honcho session (fire-and-forget). */
  async addMessage(
    openId: string,
    sessionId: string,
    role: "user" | "ai",
    content: string
  ): Promise<void> {
    if (!this.enabled) return;
    const appId = await this.getAppId();
    if (!appId) return;
    try {
      const userId = await this.getOrCreateUser(openId);
      if (!userId) return;
      const hSessionId = await this.getOrCreateSession(openId, sessionId);
      if (!hSessionId) return;

      await this.client!.apps.users.sessions.messages.create(appId, userId, hSessionId, {
        content,
        is_user: role === "user",
      });
    } catch (err) {
      log.warn("Honcho addMessage failed:", (err as Error).message);
    }
  }

  /** Retrieve messages for a session from Honcho. */
  async getMessages(openId: string, sessionId: string) {
    if (!this.enabled) return [];
    const appId = await this.getAppId();
    if (!appId) return [];
    try {
      const userId = await this.getOrCreateUser(openId);
      if (!userId) return [];
      const hSessionId = await this.getOrCreateSession(openId, sessionId);
      if (!hSessionId) return [];

      const page = await this.client!.apps.users.sessions.messages.list(
        appId, userId, hSessionId
      );
      return page.items ?? [];
    } catch (err) {
      log.warn("Honcho getMessages failed:", (err as Error).message);
      return [];
    }
  }

  /**
   * Store a user fact as a Honcho metamessage.
   * Used for /btw notes and any inferred long-term preferences.
   */
  async addFact(openId: string, content: string): Promise<void> {
    if (!this.enabled) return;
    const appId = await this.getAppId();
    if (!appId) return;
    try {
      const userId = await this.getOrCreateUser(openId);
      if (!userId) return;

      await this.client!.apps.users.metamessages.create(appId, userId, {
        content,
        metamessage_type: FACT_LABEL,
        metadata: { source: "btw_note", createdAt: new Date().toISOString() },
      });
    } catch (err) {
      log.warn("Honcho addFact failed:", (err as Error).message);
    }
  }

  /**
   * Retrieve stored facts for a user.
   * Returns the most recent `limit` facts ordered newest-first.
   */
  async getFacts(openId: string, limit = 20): Promise<Array<{ id: string; content: string; created_at: string }>> {
    if (!this.enabled) return [];
    const appId = await this.getAppId();
    if (!appId) return [];
    try {
      const userId = await this.getOrCreateUser(openId);
      if (!userId) return [];

      const page = await this.client!.apps.users.metamessages.list(appId, userId, {
        metamessage_type: FACT_LABEL,
      });
      const items = (page.items ?? []) as Array<{ id: string; content: string; created_at: string }>;
      // Newest first, cap at limit
      return items.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ).slice(0, limit);
    } catch (err) {
      log.warn("Honcho getFacts failed:", (err as Error).message);
      return [];
    }
  }
}

export const honchoService = HonchoService.getInstance();
