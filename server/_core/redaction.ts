/**
 * @file server/_core/redaction.ts
 * @description Centralized sensitive-data redaction for logs and error messages.
 *
 * Used anywhere untrusted/third-party text (API error bodies, response payloads)
 * may be written to logs or surfaced to users. Extends the pattern set originally
 * in MemoryArchitectService to cover payment card PANs, OAuth tokens, and PEM
 * private keys — required so a Lithic/payment-processor error body can never leak
 * a PAN, CVV, or bearer token into the audit log.
 *
 * Backward compatible: pure function, no new dependencies.
 */

/**
 * Luhn check — used to avoid redacting arbitrary 13-19 digit numbers that are
 * not valid payment cards (e.g. order IDs). Cards must pass Luhn.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48; // '0' = 48
    if (n < 0 || n > 9) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const REDACTION_RULES: Array<[RegExp, string | ((match: string) => string)]> = [
  // PEM private key blocks — redact first (multi-line, highest priority)
  [
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    "[PRIVATE_KEY_REDACTED]",
  ],
  // JWT (three base64url segments) — covers most OAuth access/id tokens
  [/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/]*/g, "[JWT_REDACTED]"],
  // Bearer / Authorization header values
  [/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED]"],
  // JSON credential-looking fields (api keys, tokens, PAN, CVV, secrets)
  [
    /("(?:password|secret|token|api_?key|access_?token|refresh_?token|client_secret|pan|cvv|cvc|card_number|security_code)"\s*:\s*")[^"]+(")/gi,
    "$1[REDACTED]$2",
  ],
  // .env / config KEY=<secret> pairs
  [
    /^([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|API_KEY|ACCESS_KEY|PRIVATE)[A-Z0-9_]*)=.+$/gm,
    "$1=[REDACTED]",
  ],
  // Payment card PANs: 13-19 digits, optionally separated by spaces/dashes,
  // that pass the Luhn checksum. Function replacement validates before redacting.
  [
    /\b(?:\d[ -]?){12,18}\d\b/g,
    (match: string) => {
      const digits = match.replace(/[ -]/g, "");
      if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) {
        return "[CARD_REDACTED]";
      }
      return match;
    },
  ],
  // Long high-entropy base64/url-safe strings (>= 40 chars) — opaque OAuth
  // tokens, API keys not caught above.
  [/\b[A-Za-z0-9\-_]{40,}\b/g, "[TOKEN_REDACTED]"],
  // Generic high-entropy hex strings (32-64 hex chars) — secrets/hashes
  [/\b[0-9a-f]{32,64}\b/gi, "[HEX_SECRET_REDACTED]"],
];

/**
 * Redact sensitive data (card PANs, OAuth tokens, private keys, API keys) from
 * arbitrary text. Safe to call on third-party API error bodies before logging.
 */
export function redactSensitive(text: string): string {
  if (!text) return text;
  let result = text;
  for (const [pattern, replacement] of REDACTION_RULES) {
    result =
      typeof replacement === "function"
        ? result.replace(pattern, replacement as (m: string) => string)
        : result.replace(pattern, replacement);
  }
  return result;
}
