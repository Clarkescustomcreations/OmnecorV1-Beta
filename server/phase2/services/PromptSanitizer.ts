/**
 * @file server/phase2/services/PromptSanitizer.ts
 * @description Omnecor — Prompt Sanitizer (Phase 22)
 *
 * Singleton service that sanitizes all incoming prompts before they reach
 * LLM providers. Handles:
 *   - Unicode normalization (NFC)
 *   - Null byte removal
 *   - Homoglyph detection (mixed Cyrillic/Greek + Latin)
 *   - Prompt injection pattern detection
 *   - Oversized input truncation
 */

export interface SanitizerResult {
  /** Sanitized text, safe to send to LLM */
  clean: string;
  /** True if any changes were made to the text */
  modified: boolean;
  /** True if injection attempt detected (should be logged) */
  flagged: boolean;
  /** List of violation types found */
  violations: string[];
  originalLength: number;
  cleanLength: number;
}

export class PromptSanitizer {
  private static instance: PromptSanitizer | null = null;
  private readonly maxLength: number;

  private constructor(maxLength = 32000) {
    this.maxLength = maxLength;
  }

  public static getInstance(): PromptSanitizer {
    if (!PromptSanitizer.instance) {
      PromptSanitizer.instance = new PromptSanitizer();
    }
    return PromptSanitizer.instance;
  }

  sanitize(input: string): SanitizerResult {
    const violations: string[] = [];
    let text = input;
    const originalLength = text.length;

    // 1. Unicode normalization (NFC)
    const normalized = text.normalize("NFC");
    if (normalized !== text) {
      violations.push("unicode_normalization");
      text = normalized;
    }

    // 2. Null byte removal
    if (text.includes("\0")) {
      violations.push("null_byte");
      text = text.replace(/\0/g, "");
    }

    // 3. Oversized input — truncate but mark as modified
    if (text.length > this.maxLength) {
      violations.push("oversized_input");
      text = text.slice(0, this.maxLength);
    }

    // 4. Homoglyph detection — check for mixed-script suspicious patterns
    const homoglyphPattern = /[Ѐ-ӿͰ-Ͽ]/u; // Cyrillic or Greek mixed with Latin
    if (homoglyphPattern.test(text) && /[a-zA-Z]/.test(text)) {
      // Mixed Latin + Cyrillic/Greek — suspicious but don't remove, just flag
      violations.push("homoglyph_suspect");
    }

    // 5. Prompt injection patterns
    const injectionPatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /ignore\s+(all\s+)?previous\s+instructions?/i, label: "injection_ignore_instructions" },
      { pattern: /you\s+are\s+now\s+(a|an)\s+/i, label: "injection_persona_override" },
      { pattern: /system\s*:\s*you\s+(are|must|should)/i, label: "injection_system_impersonation" },
      { pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i, label: "injection_token_stuffing" },
      { pattern: /disregard\s+(your\s+)?(previous|prior|above)\s+(prompt|instruction|guideline)/i, label: "injection_disregard" },
      { pattern: /print\s+your\s+(system\s+prompt|instructions?|guidelines?)/i, label: "injection_exfiltrate_prompt" },
      { pattern: /act\s+as\s+(if\s+you\s+are|a)\s+/i, label: "injection_act_as" },
    ];

    for (const { pattern, label } of injectionPatterns) {
      if (pattern.test(text)) {
        violations.push(label);
      }
    }

    const flagged = violations.some(
      v => v.startsWith("injection_") || v === "homoglyph_suspect"
    );
    const modified = violations.some(v =>
      ["unicode_normalization", "null_byte", "oversized_input"].includes(v)
    );

    return {
      clean: text,
      modified,
      flagged,
      violations,
      originalLength,
      cleanLength: text.length,
    };
  }

  /**
   * Sanitize an array of chat messages, returning sanitized messages and
   * an aggregate flagged/violations summary.
   */
  sanitizeMessages(messages: Array<{ role: string; content: string }>): {
    messages: Array<{ role: string; content: string }>;
    anyFlagged: boolean;
    violations: string[];
  } {
    let anyFlagged = false;
    const allViolations: string[] = [];
    const sanitized = messages.map(msg => {
      const result = this.sanitize(msg.content);
      if (result.flagged) anyFlagged = true;
      allViolations.push(...result.violations);
      return { ...msg, content: result.clean };
    });
    return { messages: sanitized, anyFlagged, violations: [...new Set(allViolations)] };
  }
}
