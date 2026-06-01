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

const log = createLogger("VirtualCardService");

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

    const response = await fetch(`${LITHIC_API_BASE}/cards`, {
      method: "POST",
      headers: {
        "Authorization": ENV.lithicApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Lithic API error ${response.status}: ${errorText}`);
    }

    const card: any = await response.json();

    // Encrypt the PAN — never store or return it in plaintext
    const { encryptedData, ivHex, authTagHex } = this.encryptToken(card.pan ?? "");

    return {
      id: card.token ?? uuidv4(),
      last4: card.last_four ?? card.pan?.slice(-4) ?? "****",
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
