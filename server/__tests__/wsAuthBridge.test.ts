import { describe, it, expect } from "vitest";
import { bridgeWsAuthToken, type WsAuthRequest } from "../core_services/websocket/wsAuthBridge.js";

describe("bridgeWsAuthToken", () => {
  it("promotes a ?token= query param to a Bearer header when unauthenticated", () => {
    const req: WsAuthRequest = { url: "/ws?token=abc123", headers: {} };
    const wrote = bridgeWsAuthToken(req);
    expect(wrote).toBe(true);
    expect(req.headers.authorization).toBe("Bearer abc123");
  });

  it("url-decodes the token value", () => {
    const req: WsAuthRequest = { url: "/ws?token=a%2Bb%2Fc%3D", headers: {} };
    bridgeWsAuthToken(req);
    // URLSearchParams decodes percent-encoding — the mobile client encodeURIComponent's the token.
    expect(req.headers.authorization).toBe("Bearer a+b/c=");
  });

  it("does not overwrite an existing Authorization header", () => {
    const req: WsAuthRequest = { url: "/ws?token=abc", headers: { authorization: "Bearer real" } };
    const wrote = bridgeWsAuthToken(req);
    expect(wrote).toBe(false);
    expect(req.headers.authorization).toBe("Bearer real");
  });

  it("does not touch a request that already carries a cookie (web)", () => {
    const req: WsAuthRequest = { url: "/ws?token=abc", headers: { cookie: "app_session_id=xyz" } };
    const wrote = bridgeWsAuthToken(req);
    expect(wrote).toBe(false);
    expect(req.headers.authorization).toBeUndefined();
  });

  it("no-ops when there is no token param", () => {
    const req: WsAuthRequest = { url: "/ws", headers: {} };
    expect(bridgeWsAuthToken(req)).toBe(false);
    expect(req.headers.authorization).toBeUndefined();
  });

  it("no-ops on a malformed url without throwing", () => {
    const req: WsAuthRequest = { url: "http://[::bad", headers: {} };
    expect(() => bridgeWsAuthToken(req)).not.toThrow();
    expect(req.headers.authorization).toBeUndefined();
  });

  it("tolerates missing req / headers", () => {
    expect(bridgeWsAuthToken(undefined)).toBe(false);
    expect(bridgeWsAuthToken(null)).toBe(false);
  });
});
