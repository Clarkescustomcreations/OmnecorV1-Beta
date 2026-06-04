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

const LITHIC_API_BASE = "https://api.lithic.com/v1";
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

export interface IssueCardInput {
  spendLimitCents: number;
  memo?: string;
  userId: string;
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

    log.info("card.issue.success", {
      userId: input.userId,
      cardId: card.token ?? "(generated)",
      last4,
    });

    return {
      id: card.token ?? uuidv4(),
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
}

// Helper used internally — not exported (avoid polluting the module namespace)
function uuidv4(): string {
  return crypto.randomUUID();
}
