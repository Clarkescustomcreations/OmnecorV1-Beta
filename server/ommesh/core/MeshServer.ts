// server/ommesh/core/MeshServer.ts
//
// Inbound side of OMMESH cross-node inference. Each node advertises port 3001
// over mDNS (see DiscoveryService); this is the server that actually listens
// there. It is a strict-mTLS HTTPS endpoint — only peers whose client cert was
// signed by our shared CA can connect (getServerTlsOptions sets requestCert +
// rejectUnauthorized + TLSv1.3). A connecting peer POSTs an inference request
// and we execute it locally, returning the completion.
//
// The handler calls MeshNode.executeLocal() directly (never routeInference) so
// an inbound request can never bounce back out and create a routing loop.
import * as https from "https";
import type { IncomingMessage, ServerResponse } from "http";
import * as tls from "tls";
import { verifyHmacSig } from "../crypto.js";
import { securityManager } from "./SecurityManager.js";
import type { MeshNode } from "./MeshNode.js";
import { createLogger } from "../../_core/logger.js";
const log = createLogger("OMMESH:Server");

/** LAN mesh port advertised over mDNS and used for peer-to-peer inference. */
export const MESH_PORT = 3001;

/** Reject oversized request bodies (a prompt should never approach this). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Sync body size cap: 1 MB */
const MAX_SYNC_BYTES = 1 * 1024 * 1024;

/** Discourse body size cap: 64 KB */
const MAX_DISCOURSE_BYTES = 64 * 1024;

export class MeshServer {
  private server: https.Server | null = null;

  constructor(private node: MeshNode) {}

  /**
   * Start the mTLS inference listener. No-op (with a warning) when certificates
   * have not been provisioned yet — a node without certs can still discover and
   * route outbound, it just cannot accept inbound work.
   */
  async start(): Promise<void> {
    if (this.server) return;

    if (!securityManager.isReady()) {
      log.warn("Mesh inference server not started: mTLS certificates not provisioned");
      return;
    }

    const tlsOptions = securityManager.getServerTlsOptions();

    await new Promise<void>((resolve, reject) => {
      const server = https.createServer(tlsOptions, (req, res) => {
        this.handleRequest(req, res).catch((err) => {
          log.warn("Mesh request handler error", { error: (err as Error).message });
          this.sendJson(res, 500, { error: "internal_error" });
        });
      });

      server.on("error", (err) => {
        // EADDRINUSE / permission errors must not crash boot — the mesh is optional.
        log.warn("Mesh inference server error", { error: (err as Error).message });
        if (!this.server) reject(err);
      });

      server.listen(MESH_PORT, () => {
        this.server = server;
        log.info("Mesh inference server listening (mTLS)", { port: MESH_PORT });
        resolve();
      });
    }).catch((err) => {
      // Swallow listen failures so OMMESH degrades gracefully (mDNS still runs).
      log.warn("Mesh inference server failed to bind", { port: MESH_PORT, error: (err as Error).message });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    log.info("Mesh inference server stopped");
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const socket = req.socket as tls.TLSSocket;
    const peerCn = this.peerName(socket);

    // Liveness probe is answerable to any mTLS-valid peer BEFORE the per-peer
    // fingerprint trust gate. A peer must be able to confirm reachability during
    // the approval handshake (before it appears in the trusted set), and /health
    // only exposes { ok, nodeId } — no inference, sync, or discourse capability.
    // The endpoint is still fully protected by mutual TLS (CA-signed certs only).
    if (req.method === "GET" && req.url === "/health") {
      this.sendJson(res, 200, { ok: true, nodeId: this.node.getIdentity().id });
      return;
    }

    // Enforce explicit per-peer fingerprint trust on top of CA-cert mTLS validation.
    // The trusted set is loaded from DB at startup; an empty set means no peers
    // have been approved yet — all inbound work requests are rejected (fail-closed).
    const peerFingerprint = (() => {
      try {
        return socket.getPeerCertificate?.()?.fingerprint ?? "";
      } catch {
        return "";
      }
    })();
    if (!securityManager.isTrusted(peerFingerprint)) {
      log.warn("Mesh request rejected: untrusted peer fingerprint", { from: peerCn, fingerprint: peerFingerprint });
      this.sendJson(res, 403, { error: "untrusted_peer" });
      return;
    }

    if (req.method === "POST" && req.url === "/sync") {
      await this.handleSync(req, res, peerCn);
      return;
    }

    if (req.method === "POST" && req.url === "/discourse") {
      await this.handleDiscourse(req, res, peerCn);
      return;
    }

    if (req.method !== "POST" || req.url !== "/inference") {
      this.sendJson(res, 404, { error: "not_found" });
      return;
    }

    const body = await this.readBody(req);
    if (body === null) {
      this.sendJson(res, 413, { error: "payload_too_large" });
      return;
    }

    let parsed: { prompt?: unknown; options?: unknown };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    if (typeof parsed.prompt !== "string" || parsed.prompt.length === 0) {
      this.sendJson(res, 400, { error: "missing_prompt" });
      return;
    }

    const options = (parsed.options && typeof parsed.options === "object" ? parsed.options : {}) as Record<string, unknown>;
    log.info("Executing inbound mesh inference", { from: peerCn, promptChars: parsed.prompt.length });

    const result = await this.node.executeLocal(parsed.prompt, options);
    this.sendJson(res, 200, result);
  }

  /**
   * Handle POST /sync — receive persona knowledge from a remote peer.
   * Fail-closed: reject if cert or signature verification fails.
   */
  private async handleSync(req: IncomingMessage, res: ServerResponse, peerCn: string): Promise<void> {
    const rawBody = await this.readBodyCapped(req, MAX_SYNC_BYTES);
    if (rawBody === null) {
      this.sendJson(res, 413, { error: "payload_too_large" });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      this.sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    if (typeof parsed.nodeId !== "string" || !parsed.nodeId) {
      this.sendJson(res, 400, { error: "missing_nodeId" });
      return;
    }

    // Replay-guard: timestamp must be present and within 5 minutes
    const ts = typeof parsed.timestamp === "number" ? parsed.timestamp : NaN;
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 300_000) {
      log.warn("Sync rejected: timestamp out of window", { from: peerCn, nodeId: parsed.nodeId });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    // Signature verification — fail-closed
    if (typeof parsed.sig !== "string" || !parsed.sig) {
      log.warn("Sync rejected: missing signature", { from: peerCn });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const verified = verifyHmacSig(parsed, parsed.sig as string, process.env.OMMESH_SECRET);
    if (!verified) {
      log.warn("Sync rejected: signature mismatch", { from: peerCn, nodeId: parsed.nodeId });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const personasArr = Array.isArray(parsed.personas) ? parsed.personas : [];
    log.info("Received peer sync", { from: peerCn, nodeId: parsed.nodeId, personaCount: personasArr.length });

    // Delegate to the node — it holds the in-memory cache and emits the WS event
    await this.node.receivePeerSync(parsed.nodeId as string, personasArr);

    this.sendJson(res, 200, { ok: true });
  }

  /**
   * Handle POST /discourse — receive an inter-agent message from a remote peer.
   * Fail-closed: reject if cert or signature verification fails.
   */
  private async handleDiscourse(req: IncomingMessage, res: ServerResponse, peerCn: string): Promise<void> {
    const rawBody = await this.readBodyCapped(req, MAX_DISCOURSE_BYTES);
    if (rawBody === null) {
      this.sendJson(res, 413, { error: "payload_too_large" });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      this.sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    // Validate required fields
    if (
      typeof parsed.fromNode !== "string" || !parsed.fromNode ||
      typeof parsed.fromAgentId !== "string" || !parsed.fromAgentId ||
      typeof parsed.toAgentId !== "string" || !parsed.toAgentId ||
      typeof parsed.content !== "string" || !parsed.content
    ) {
      this.sendJson(res, 400, { error: "missing_fields" });
      return;
    }

    // Replay-guard
    const ts = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : NaN;
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 300_000) {
      log.warn("Discourse rejected: timestamp out of window", { from: peerCn });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    // Signature verification — fail-closed
    if (typeof parsed.sig !== "string" || !parsed.sig) {
      log.warn("Discourse rejected: missing signature", { from: peerCn });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const verified = verifyHmacSig(parsed, parsed.sig as string, process.env.OMMESH_SECRET);
    if (!verified) {
      log.warn("Discourse rejected: signature mismatch", { from: peerCn });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    log.info("Received peer discourse", {
      from: peerCn,
      fromNode: parsed.fromNode,
      fromAgentId: parsed.fromAgentId,
      toAgentId: parsed.toAgentId,
    });

    const result = await this.node.receiveDiscourse(
      parsed.fromNode as string,
      parsed.fromAgentId as string,
      parsed.toAgentId as string,
      parsed.content as string,
    );

    this.sendJson(res, 200, result);
  }

  /** Read the request body, enforcing a hard size cap. Returns null if exceeded. */
  private readBody(req: IncomingMessage): Promise<string | null> {
    return this.readBodyCapped(req, MAX_BODY_BYTES);
  }

  /** Read the request body with a caller-specified byte cap. Returns null if exceeded. */
  private readBodyCapped(req: IncomingMessage, maxBytes: number): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  /** Best-effort peer identity from the verified client certificate. */
  private peerName(socket: tls.TLSSocket): string {
    try {
      const cert = socket.getPeerCertificate?.();
      const ou = cert?.subject?.OU;
      if (typeof ou === "string" && ou) return ou;
      const cn = cert?.subject?.CN;
      if (typeof cn === "string" && cn) return cn;
    } catch {
      /* not a TLS socket / no peer cert */
    }
    return "unknown";
  }

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const data = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
    res.end(data);
  }
}
