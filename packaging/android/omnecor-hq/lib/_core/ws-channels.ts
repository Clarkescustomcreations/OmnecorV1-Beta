/**
 * Shared WebSocket channel subscriber.
 *
 * Opens ONE connection to the PC's /ws endpoint and multiplexes the server's
 * channel-based pub/sub (the same protocol the desktop UI uses):
 *
 *   Phone → PC:  { type: "subscribe",   channel }
 *                { type: "unsubscribe", channel }
 *   PC → Phone:  { type: <event>, channel, data, timestamp }
 *
 * Screens call `subscribeChannel("hitl:pending", fn)` / `("training:all", fn)`
 * and receive live events. The socket auto-(re)subscribes all desired channels
 * on (re)connect and auto-reconnects while any listener is active.
 *
 * This is separate from the OMMESH node socket (mobile-mesh-node.ts) and the
 * terminal socket (use-terminal.ts) on purpose — each has a distinct lifecycle.
 */
import { getAuthedWsUrl, isServerConfigured } from "./server-config";

type ChannelListener = (data: any, type: string) => void;

let _ws: WebSocket | null = null;
let _connected = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const _listeners = new Map<string, Set<ChannelListener>>();
const _desired = new Set<string>();

function send(obj: object) {
  if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(obj));
}

export function sendWsMessage(obj: object) {
  send(obj);
}

function ensureSocket() {
  if (!isServerConfigured()) return;
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  // Resolve the session-token-authenticated URL first — the PC verifies it at
  // upgrade time and unauthenticated sockets cannot subscribe to channels.
  getAuthedWsUrl()
    .then((url) => {
      if (!url) return scheduleReconnect();
      if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
      openSocket(url);
    })
    .catch(() => scheduleReconnect());
}

function openSocket(url: string) {
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  _ws = ws;

  ws.onopen = () => {
    _connected = true;
    for (const ch of _desired) send({ type: "subscribe", channel: ch });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      const set = msg.channel ? _listeners.get(msg.channel) : undefined;
      if (set) set.forEach((fn) => fn(msg.data, msg.type));
    } catch {
      /* ignore malformed frames */
    }
  };

  ws.onerror = () => { /* close handler drives reconnect */ };

  ws.onclose = () => {
    _connected = false;
    _ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  if (_desired.size === 0) return; // nothing wants the socket anymore
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    ensureSocket();
  }, 8_000);
}

/**
 * Subscribe to a server channel. Returns an unsubscribe function.
 * The underlying socket opens on first subscription and closes itself (by
 * stopping reconnects) once the last listener for every channel is gone.
 */
export function subscribeChannel(channel: string, fn: ChannelListener): () => void {
  let set = _listeners.get(channel);
  if (!set) {
    set = new Set();
    _listeners.set(channel, set);
  }
  set.add(fn);
  _desired.add(channel);

  ensureSocket();
  if (_connected) send({ type: "subscribe", channel });

  return () => {
    const s = _listeners.get(channel);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) {
      _listeners.delete(channel);
      _desired.delete(channel);
      if (_connected) send({ type: "unsubscribe", channel });
    }
  };
}

/** True if the shared channel socket is currently open. */
export function isChannelSocketConnected(): boolean {
  return _connected;
}
