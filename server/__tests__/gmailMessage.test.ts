import { describe, it, expect } from "vitest";
import { buildRawMessage } from "../routers/gmailRouter.js";

/** Decode the base64url raw message back to its RFC 2822 text. */
function decode(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf-8");
}

describe("gmail buildRawMessage", () => {
  it("produces well-formed To/Subject headers and a body", () => {
    const msg = decode(
      buildRawMessage({ to: "a@b.com", subject: "Hello", body: "Hi there" }),
    );
    expect(msg).toContain("To: a@b.com");
    expect(msg).toContain("Subject: Hello");
    expect(msg).toContain("\r\n\r\nHi there");
  });

  it("strips CR/LF from the subject to prevent header injection", () => {
    const msg = decode(
      buildRawMessage({
        to: "a@b.com",
        subject: "Hi\r\nBcc: victim@evil.com",
        body: "x",
      }),
    );
    // The injected Bcc must NOT become its own header line.
    expect(msg).not.toMatch(/^Bcc:/m);
    expect(msg).toContain("Subject: Hi Bcc: victim@evil.com");
    // Exactly one CRLF-CRLF separator (headers/body), no injected blank lines.
    expect(msg.split("\r\n\r\n").length).toBe(2);
  });

  it("RFC 2047 encodes a non-ASCII subject", () => {
    const msg = decode(
      buildRawMessage({ to: "a@b.com", subject: "Olá 🎉", body: "x" }),
    );
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });

  it("sets the content type from the html flag", () => {
    expect(decode(buildRawMessage({ to: "a@b.com", subject: "s", body: "<b>x</b>", html: true })))
      .toContain("Content-Type: text/html");
    expect(decode(buildRawMessage({ to: "a@b.com", subject: "s", body: "x" })))
      .toContain("Content-Type: text/plain");
  });
});
