/**
 * OMMESH Mobile Node
 *
 * Connects the phone to the PC's Omnecor WebSocket server and registers it as
 * an AI inference node.  When the PC needs to run a model, it can route the
 * request here, letting the phone's NPU do the work.
 *
 * Protocol extensions added on top of OmnecorV1-Beta's existing /ws protocol:
 *
 *   Phone → PC:
 *     { type: "mobile_node_register",  nodeId, nodeName, secret, capabilities }
 *     { type: "mobile_inference_response", requestId, content, done, error? }
 *     { type: "mobile_node_heartbeat", nodeId, stats }
 *
 *   PC → Phone:
 *     { type: "mobile_node_ack",        accepted: boolean, reason?: string }
 *     { type: "mobile_inference_request", requestId, prompt, options }
 *     { type: "mobile_node_ping" }
 *
 * To enable on the PC side add the handler block in:
 *   OmnecorV1-Beta/server/core_services/websocket/WebSocketServer.ts
 *   — look for the switch(message.type) block and add the cases above.
 *
 * Works over Tailscale (100.x.x.x) just like a LAN IP — Tailscale creates a
 * virtual layer-3 network, so mDNS / Bonjour is NOT needed for this flow.
 */

import { getWsUrl, getOmmeshSecret, getNodeName, isServerConfigured } from "./server-config";
import { runInference, isModelLoaded, getStats, recordStats } from "./local-inference";
import { generateTask, isTaskModelLoaded } from "./mediapipe-inference";
import { nanoid } from "nanoid/non-secure";

/**
 * The phone can serve mesh inference from either on-device engine:
 * llama.rn (GGUF) or LiteRT-LM (.litertlm — Google AI Edge Gallery Gemma
 * family). Registration/heartbeat advertise `modelLoaded` when EITHER has a
 * model, and inference prefers GGUF when both are loaded.
 */
function anyModelLoaded(): boolean {
  return isModelLoaded() || isTaskModelLoaded();
}

export type NodeStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "registered"
  | "error";

type StatusListener = (s: NodeStatus) => void;
type StatsListener  = (s: ReturnType<typeof getStats> & { tokensPerSec: number }) => void;

let _ws: WebSocket | null = null;
let _status: NodeStatus = "disconnected";
let _nodeId: string = nanoid(12);
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _lastTokenTime = Date.now();
let _recentTokens = 0;
let _tokensPerSec = 0;

const statusListeners = new Set<StatusListener>();
const statsListeners  = new Set<StatsListener>();

function setStatus(s: NodeStatus) {
  _status = s;
  statusListeners.forEach((fn) => fn(s));
}

function pushStats() {
  const base = getStats();
  statsListeners.forEach((fn) => fn({ ...base, tokensPerSec: _tokensPerSec }));
}

export function subscribeStatus(fn: StatusListener) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function subscribeStats(fn: StatsListener) {
  statsListeners.add(fn);
  return () => statsListeners.delete(fn);
}

export function getNodeStatus(): NodeStatus { return _status; }
export function getNodeId(): string         { return _nodeId; }

function send(payload: object) {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(payload));
  }
}

function startHeartbeat() {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer);
  _heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - _lastTokenTime) / 1000;
    _tokensPerSec = elapsed > 0 ? Math.round(_recentTokens / elapsed) : 0;
    _recentTokens = 0;
    _lastTokenTime = now;

    send({
      type: "mobile_node_heartbeat",
      nodeId: _nodeId,
      stats: { ...getStats(), tokensPerSec: _tokensPerSec, modelLoaded: anyModelLoaded() },
    });
    pushStats();
  }, 10_000);
}

function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

async function handleInferenceRequest(msg: {
  requestId: string;
  prompt: string;
  options?: { maxTokens?: number; temperature?: number };
}) {
  if (!anyModelLoaded()) {
    send({ type: "mobile_inference_response", requestId: msg.requestId, content: "", done: true, error: "No model loaded on phone" });
    return;
  }

  let accumulated = "";
  try {
    if (isModelLoaded()) {
      // llama.rn GGUF engine — onToken delivers deltas.
      await runInference(msg.prompt, {
        maxTokens: msg.options?.maxTokens ?? 512,
        temperature: msg.options?.temperature ?? 0.7,
        onToken: (token) => {
          accumulated += token;
          _recentTokens++;
          send({ type: "mobile_inference_response", requestId: msg.requestId, content: token, done: false });
        },
      });
    } else {
      // LiteRT-LM engine (.litertlm) — onToken delivers the CUMULATIVE text,
      // so convert to deltas to match the wire protocol.
      await generateTask(msg.prompt, (partial) => {
        const delta = partial.slice(accumulated.length);
        accumulated = partial;
        if (!delta) return;
        _recentTokens++;
        send({ type: "mobile_inference_response", requestId: msg.requestId, content: delta, done: false });
      });
    }
    recordStats(accumulated.split(" ").length); // rough token count
    send({ type: "mobile_inference_response", requestId: msg.requestId, content: "", done: true });
  } catch (err) {
    send({
      type: "mobile_inference_response",
      requestId: msg.requestId,
      content: "",
      done: true,
      error: String(err),
    });
  }
}

export function connect(): void {
  if (!isServerConfigured()) return;
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  setStatus("connecting");
  const url = getWsUrl();

  try {
    _ws = new WebSocket(url);
  } catch {
    setStatus("error");
    scheduleReconnect();
    return;
  }

  _ws.onopen = () => {
    setStatus("connected");
    // Register this phone as an OMMESH node
    send({
      type: "mobile_node_register",
      nodeId: _nodeId,
      nodeName: getNodeName(),
      secret: getOmmeshSecret(),
      capabilities: {
        roles: ["worker"],
        npu: true,
        platform: "android",
        chip: "snapdragon-8-elite",
        modelLoaded: anyModelLoaded(),
      },
    });
    startHeartbeat();
  };

  _ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      switch (msg.type) {
        case "mobile_node_ack":
          setStatus(msg.accepted ? "registered" : "error");
          // OMMESH zero-touch auto-pair: if the PC handed back a session token
          // and we aren't paired yet, store it so HTTP/tRPC calls authenticate.
          if (msg.accepted && typeof msg.sessionToken === "string" && msg.sessionToken) {
            void (async () => {
              try {
                const { getSessionToken, setSessionToken } = await import("./auth");
                if (!(await getSessionToken())) await setSessionToken(msg.sessionToken);
              } catch { /* best-effort */ }
            })();
          }
          break;
        case "mobile_inference_request":
          handleInferenceRequest(msg);
          break;
        case "mobile_node_ping":
          send({ type: "pong" });
          break;
      }
    } catch { /* ignore malformed messages */ }
  };

  _ws.onerror = () => setStatus("error");

  _ws.onclose = () => {
    stopHeartbeat();
    setStatus("disconnected");
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (isServerConfigured()) connect();
  }, 8_000);
}

export function disconnect(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  stopHeartbeat();
  if (_ws) {
    _ws.onclose = null; // prevent auto-reconnect
    _ws.close();
    _ws = null;
  }
  setStatus("disconnected");
}
