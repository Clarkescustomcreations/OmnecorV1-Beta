import { describe, it, expect } from "vitest";
import { assertOutboundUrlAllowed } from "../security.js";

describe("assertOutboundUrlAllowed (SSRF guard)", () => {
  it("rejects the cloud metadata IP", async () => {
    await expect(assertOutboundUrlAllowed("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /Security Violation/,
    );
  });

  it("rejects other link-local addresses", async () => {
    await expect(assertOutboundUrlAllowed("http://169.254.0.1/")).rejects.toThrow(/Security Violation/);
  });

  it("rejects IPv4-mapped IPv6 link-local", async () => {
    await expect(assertOutboundUrlAllowed("http://[::ffff:169.254.169.254]/")).rejects.toThrow(
      /Security Violation/,
    );
  });

  it("rejects the cloud metadata hostname before any DNS lookup", async () => {
    await expect(assertOutboundUrlAllowed("http://metadata.google.internal/")).rejects.toThrow(
      /Security Violation/,
    );
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertOutboundUrlAllowed("file:///etc/passwd")).rejects.toThrow(/only http/);
    await expect(assertOutboundUrlAllowed("ftp://example.com/")).rejects.toThrow(/only http/);
  });

  it("rejects malformed URLs", async () => {
    await expect(assertOutboundUrlAllowed("not a url")).rejects.toThrow(/invalid URL/);
  });

  it("allows loopback and private LAN literals (self-hosted services)", async () => {
    await expect(assertOutboundUrlAllowed("http://127.0.0.1:9001/")).resolves.toBeUndefined();
    await expect(assertOutboundUrlAllowed("http://192.168.1.50:9001/")).resolves.toBeUndefined();
    await expect(assertOutboundUrlAllowed("http://10.0.0.5:8080/")).resolves.toBeUndefined();
  });
});
