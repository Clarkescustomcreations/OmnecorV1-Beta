/**
 * @file server/phase2/services/VirtualCardService.ts
 * @description Agentic Wallet — Virtual Card Issuance Service
 *
 * Issues ephemeral virtual credit cards for isolated cloud compute spending.
 * Cards are issued via the Lithic REST API and tokens are stored AES-256-GCM
 * encrypted following the same tokenIv/tokenTag pattern as OAuth integrations.
 *
 * This service is OPTIONAL — all methods gracefully return null/error when
 * LITHIC_API_KEY is not configured. The app works fully without it.
 *
 * Phase 14b: Agentic Wallet — Virtual Cards.
 */

import crypto from "crypto";
import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";
import { redactSensitive } from "../../_core/redaction.js";
import { resilientFetch, CircuitOpenError } from "../../_core/resilientFetch.js";
import { getDb } from "../../db.factory.js";
import { virtualCards } from "../../../drizzle/schema.js";

const log = createLogger("VirtualCardService");

/**
 * Safe, user-facing error for card operations. Never carries raw Lithic
 * response text — that is logged internally (redacted) only. PCI DSS: card
 * data and processor debug info must not surface to clients or persist in
 * plaintext logs.
 */
export class CardOperationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CardOperationError";
  }
}

// Base URL is env-switchable so the same code path can run against Lithic's
// sandbox (real card issuance + transaction simulation, no money) or a local
// Lithic mock server, without touching production. Defaults to production —
// set LITHIC_ENVIRONMENT=sandbox, or point LITHIC_API_BASE at any host (e.g.
// the `./scripts/mock` server) to test the full VCC lifecycle non-billably.
// Note: use `||`, not `??`, on the trimmed override — an empty/whitespace-only
// LITHIC_API_BASE (a blank line in .env/compose) must fall through to the
// sandbox/production default rather than collapse the base URL to "".
const LITHIC_API_BASE =
  process.env.LITHIC_API_BASE?.replace(/\/+$/, "").trim() ||
  (process.env.LITHIC_ENVIRONMENT === "sandbox"
    ? "https://sandbox.lithic.com/v1"
    : "https://api.lithic.com/v1");
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 16;

export interface VirtualCardResult {
  id: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** AES-256-GCM encrypted card number (base64) */
  encryptedPan: string;
  /** IV for decryption (hex) */
  ivHex: string;
  /** Auth tag for decryption (hex) */
  authTagHex: string;
  provider: string;
  createdAt: string;
}

export interface LithicTransaction {
  token: string;
  amount: number;
  currency: string;
  status: string;
  merchantDescriptor: string;
  created: string;
}

export interface IssueCardInput {
  spendLimitCents: number;
  memo?: string;
  userId: string;
  projectId?: string | null;
}

export class VirtualCardService {
  private static instance: VirtualCardService;

  private constructor() {}

  public static getInstance(): VirtualCardService {
    if (!VirtualCardService.instance) {
      VirtualCardService.instance = new VirtualCardService();
    }
    return VirtualCardService.instance;
  }

  /** Returns true if Lithic is configured and available. */
  public isConfigured(): boolean {
    return !!ENV.lithicApiKey;
  }

  /**
   * Issue a new virtual card via Lithic REST API.
   * Returns null if Lithic is not configured.
   * The card PAN is encrypted before returning — the plaintext is never stored.
   */
  public async issueCard(input: IssueCardInput): Promise<VirtualCardResult | null> {
    if (!ENV.lithicApiKey) {
      log.warn("Virtual card requested but LITHIC_API_KEY is not configured");
      return null;
    }

    const body = {
      type: "VIRTUAL",
      spend_limit: input.spendLimitCents,
      spend_limit_duration: "TRANSACTION",
      memo: input.memo ?? `Omnecor Agentic Wallet — user:${input.userId}`,
      state: "OPEN",
    };

    // Compliance audit trail: record the attempt (no card data — none exists yet).
    log.info("card.issue.attempt", {
      userId: input.userId,
      spendLimitCents: input.spendLimitCents,
    });

    let response: Response;
    try {
      response = await resilientFetch(`${LITHIC_API_BASE}/cards`, {
        method: "POST",
        headers: {
          "Authorization": ENV.lithicApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        circuitKey: "lithic",
        timeoutMs: 20_000,
        noRetry: process.env.NODE_ENV === "test",
      });
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        log.error("card.issue.circuit_open", { userId: input.userId });
        throw new CardOperationError(
          "Card service is temporarily unavailable. Please try again shortly.",
        );
      }
      // Network/timeout — log internally, return safe message.
      log.error("card.issue.network_error", {
        userId: input.userId,
        error: redactSensitive((err as Error)?.message ?? String(err)),
      });
      throw new CardOperationError("Unable to issue card right now. Please try again.");
    }

    if (!response.ok) {
      // The Lithic error body may contain PAN/CVV/PII or processor debug info.
      // Read it ONLY to log internally with redaction — never surface it.
      const rawError = await response.text().catch(() => "unknown error");
      log.error("card.issue.api_error", {
        userId: input.userId,
        status: response.status,
        detail: redactSensitive(rawError),
      });
      throw new CardOperationError(
        `Card issuance failed (status ${response.status}). Please try again or contact support.`,
        response.status,
      );
    }

    let card: { pan?: string; token?: string; last_four?: string; exp_month?: number; exp_year?: number };
    try {
      card = await response.json();
    } catch (err) {
      log.error("card.issue.parse_error", {
        userId: input.userId,
        error: redactSensitive((err as Error)?.message ?? String(err)),
      });
      throw new CardOperationError("Card issuance returned an invalid response. Please try again.");
    }

    // Encrypt the PAN IMMEDIATELY — before any further logic or error path can
    // run. The plaintext PAN exists only on this line and is never stored,
    // logged, or returned (PCI DSS: PAN must never persist in plaintext).
    const { encryptedData, ivHex, authTagHex } = this.encryptToken(card.pan ?? "");
    const last4 = card.last_four ?? (card.pan ? card.pan.slice(-4) : "****");
    // card.pan goes out of scope here; nothing downstream references it.

    const token = card.token ?? uuidv4();

    // Persist to SQLite
    try {
      const db = await getDb();
      await db.insert(virtualCards).values({
        userId: Number(input.userId),
        projectId: input.projectId ?? null,
        token,
        memo: body.memo,
        lastFour: last4,
        expMonth: card.exp_month ?? 0,
        expYear: card.exp_year ?? 0,
        encryptedCredentials: encryptedData,
        ivHex,
        authTagHex,
        spendLimitCents: input.spendLimitCents,
        status: "OPEN",
      });
    } catch (dbErr) {
      log.error("card.db.insert_failed", {
        userId: input.userId,
        error: (dbErr as Error).message,
      });
      // The card already exists and is spend-enabled at Lithic, but we failed to
      // record it locally — it would be an unlistable/unrevocable orphan. Best-effort
      // close it at the provider so no live card escapes our tracking.
      await this.closeCardBestEffort(token, input.userId);
      throw new CardOperationError("Failed to persist virtual card metadata.");
    }

    log.info("card.issue.success", {
      userId: input.userId,
      cardId: token,
      last4,
    });

    return {
      id: token,
      last4,
      expMonth: card.exp_month ?? 0,
      expYear: card.exp_year ?? 0,
      encryptedPan: encryptedData,
      ivHex,
      authTagHex,
      provider: "lithic",
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Best-effort close of a Lithic card (PATCH /v1/cards/{token} → state CLOSED).
   * Used to roll back the provider side when local persistence fails, so a
   * spend-enabled card never escapes our tracking. Never throws — a failed
   * cleanup is logged for manual reconciliation, not surfaced to the caller.
   */
  private async closeCardBestEffort(token: string, userId: number | string): Promise<void> {
    if (!ENV.lithicApiKey) return;
    try {
      const res = await resilientFetch(`${LITHIC_API_BASE}/cards/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: {
          "Authorization": ENV.lithicApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: "CLOSED" }),
        circuitKey: "lithic",
        timeoutMs: 20_000,
        noRetry: process.env.NODE_ENV === "test",
      });
      if (res.ok) {
        log.info("card.rollback.closed", { userId, cardId: token });
      } else {
        log.error("card.rollback.close_failed", { userId, cardId: token, status: res.status });
      }
    } catch (err) {
      log.error("card.rollback.close_error", {
        userId,
        cardId: token,
        error: redactSensitive((err as Error)?.message ?? String(err)),
      });
    }
  }

  /**
   * Decrypt and return the PAN for a card owned by userId.
   * Only called when the user explicitly requests to view the card number.
   */
  public async revealPan(cardToken: string, userId: number): Promise<string | null> {
    if (!ENV.lithicApiKey) return null;
    const db = await getDb();
    const { eq, and } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(virtualCards)
      .where(and(eq(virtualCards.token, cardToken), eq(virtualCards.userId, userId)))
      .limit(1);
    if (!row || !row.encryptedCredentials || !row.ivHex || !row.authTagHex) return null;
    return this.decryptToken(row.encryptedCredentials, row.ivHex, row.authTagHex);
  }

  /**
   * List the 25 most-recent transactions for a card via the Lithic API.
   * Returns an empty array when the card has no transactions or is not configured.
   */
  public async listTransactions(cardToken: string, userId: number): Promise<LithicTransaction[]> {
    if (!ENV.lithicApiKey) return [];
    // Verify ownership before making external call
    const db = await getDb();
    const { eq, and } = await import("drizzle-orm");
    const [row] = await db
      .select({ token: virtualCards.token })
      .from(virtualCards)
      .where(and(eq(virtualCards.token, cardToken), eq(virtualCards.userId, userId)))
      .limit(1);
    if (!row) return [];

    try {
      const url = `${LITHIC_API_BASE}/transactions?card_token=${encodeURIComponent(cardToken)}&page_size=25`;
      const res = await resilientFetch(url, {
        headers: { Authorization: ENV.lithicApiKey, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        log.warn("listTransactions.api_error", { status: res.status, cardToken });
        return [];
      }
      const json = (await res.json()) as { data?: unknown[] };
      const raw = Array.isArray(json.data) ? json.data : [];
      return raw.map((t: unknown) => {
        const tx = t as Record<string, unknown>;
        const merchant = (tx.merchant ?? {}) as Record<string, unknown>;
        return {
          token: String(tx.token ?? ""),
          amount: Number(tx.amount ?? 0),
          currency: String(tx.currency ?? "USD"),
          status: String(tx.status ?? ""),
          merchantDescriptor: String(merchant.descriptor ?? ""),
          created: String(tx.created ?? ""),
        };
      });
    } catch (err) {
      if (!(err instanceof CircuitOpenError)) {
        log.error("listTransactions.fetch_error", { error: (err as Error).message });
      }
      return [];
    }
  }

  /**
   * Encrypt a sensitive token using AES-256-GCM.
   * Key is derived from ENV.lithicApiKey so no extra secret is needed.
   */
  private encryptToken(plaintext: string): {
    encryptedData: string;
    ivHex: string;
    authTagHex: string;
  } {
    const key = crypto
      .createHash("sha256")
      .update(ENV.lithicApiKey + "virtualcard")
      .digest(); // 32 bytes

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedData: encrypted.toString("base64"),
      ivHex: iv.toString("hex"),
      authTagHex: authTag.toString("hex"),
    };
  }

  private decryptToken(encryptedData: string, ivHex: string, authTagHex: string): string {
    const key = crypto
      .createHash("sha256")
      .update(ENV.lithicApiKey + "virtualcard")
      .digest();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}

// Helper used internally — not exported (avoid polluting the module namespace)
function uuidv4(): string {
  return crypto.randomUUID();
}
