import { describe, it, expect } from "vitest";
import { redactSensitive } from "../_core/redaction.js";

describe("redactSensitive", () => {
  it("redacts a Visa-style PAN (passes Luhn)", () => {
    // 4242424242424242 is a well-known Luhn-valid test PAN.
    const out = redactSensitive("Card declined: 4242424242424242 cvv 123");
    expect(out).not.toContain("4242424242424242");
    expect(out).toContain("[CARD_REDACTED]");
  });

  it("redacts a hyphen/space separated PAN", () => {
    const out = redactSensitive("pan 4242 4242 4242 4242 expired");
    expect(out).not.toContain("4242 4242 4242 4242");
    expect(out).toContain("[CARD_REDACTED]");
  });

  it("does NOT redact a 16-digit number that fails Luhn (e.g. order id)", () => {
    // 1234567890123456 fails Luhn.
    const out = redactSensitive("order 1234567890123456 placed");
    expect(out).toContain("1234567890123456");
  });

  it("redacts a JSON pan field", () => {
    const out = redactSensitive('{"pan":"4242424242424242","last_four":"4242"}');
    expect(out).toContain('"pan":"[REDACTED]"');
  });

  it("redacts a JSON cvv field", () => {
    const out = redactSensitive('{"cvv":"321"}');
    expect(out).toContain('"cvv":"[REDACTED]"');
  });

  it("redacts a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123signaturepart";
    const out = redactSensitive(`token=${jwt}`);
    expect(out).toContain("[JWT_REDACTED]");
    expect(out).not.toContain(jwt);
  });

  it("redacts a Bearer header value", () => {
    const out = redactSensitive("Authorization: Bearer sk-abc123def456ghi789");
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).not.toContain("sk-abc123def456ghi789");
  });

  it("redacts a PEM private key block", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkq\nhkiG9w0BAQEFAA==\n-----END PRIVATE KEY-----";
    const out = redactSensitive(`key:\n${pem}`);
    expect(out).toContain("[PRIVATE_KEY_REDACTED]");
    expect(out).not.toContain("MIIBVgIBADANBgkq");
  });

  it("redacts a long opaque OAuth token", () => {
    const tok = "ya29." + "A".repeat(60);
    const out = redactSensitive(`access=${tok}`);
    expect(out).not.toContain(tok);
  });

  it("simulates a Lithic error body — PAN is redacted", () => {
    const lithicError = JSON.stringify({
      error: "card_declined",
      card: { pan: "4242424242424242", cvv: "999", last_four: "4242" },
      debug: "Authorization: Bearer lithic_test_abcdefghijklmnop",
    });
    const out = redactSensitive(lithicError);
    expect(out).not.toContain("4242424242424242");
    expect(out).not.toContain("999\"");
    expect(out).toContain("[REDACTED]");
  });

  it("handles empty input safely", () => {
    expect(redactSensitive("")).toBe("");
  });
});
