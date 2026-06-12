/**
 * useTerminal — live PTY shell over the PC's existing WebSocket protocol.
 *
 * Opens a dedicated WebSocket to the Omnecor server's /ws endpoint and drives a
 * real pseudo-terminal on the PC. The PC side already implements every message
 * type used here (pty:spawn / pty:input / pty:output / pty:exit / pty:kill) in
 * server/phase2/websocket/WebSocketServer.ts — no PC changes are required.
 *
 *   Phone → PC:
 *     { type: "pty:spawn",  data: { cols, rows } }
 *     { type: "pty:input",  data: { input } }
 *     { type: "pty:resize", data: { cols, rows } }
 *     { type: "pty:kill" }
 *
 *   PC → Phone:
 *     { type: "pty:ready",  data: { sessionId, shell, cwd } }
 *     { type: "pty:output", data: { output, sessionId } }
 *     { type: "pty:exit",   data: { exitCode, signal, sessionId } }
 *     { type: "error",      data: { message } }
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { getWsUrl, isServerConfigured } from "@/lib/_core/server-config";

export type TerminalStatus = "disconnected" | "connecting" | "ready" | "error";

// Strip ANSI/VT escape sequences + non-printing control bytes for plain display.
// Keeps tab (0x09), LF (0x0a), CR (0x0d) — CR is normalized separately below.
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][AB0-2]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

function clean(s: string): string {
  return s.replace(ANSI, "").replace(/\r\n/g, "\n").replace(/\r/g, "");
}

// Cap the rendered buffer so long sessions don't bloat memory / re-render cost.
const MAX_BUFFER = 40_000;
function clip(s: string): string {
  return s.length > MAX_BUFFER ? s.slice(s.length - MAX_BUFFER) : s;
}

export function useTerminal() {
  const [status, setStatus]       = useState<TerminalStatus>("disconnected");
  const [output, setOutput]       = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!isServerConfigured()) {
      setStatus("error");
      setOutput("[no server configured — set the PC IP in Settings → Omnecor Server]\n");
      return;
    }
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(getWsUrl());
    } catch {
      setStatus("error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "pty:spawn", data: { cols: 80, rows: 24 } }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case "pty:ready":
            setSessionId(msg.data?.sessionId ?? null);
            setStatus("ready");
            break;
          case "pty:output":
            setOutput((prev) => clip(prev + clean(msg.data?.output ?? "")));
            break;
          case "pty:exit":
            setOutput((prev) => prev + `\n[process exited — code ${msg.data?.exitCode ?? "?"}]\n`);
            setStatus("disconnected");
            break;
          case "error":
            setOutput((prev) => prev + `\n[error] ${msg.data?.message ?? "unknown"}\n`);
            break;
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      setStatus("disconnected");
      setSessionId(null);
    };
  }, []);

  const sendInput = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "pty:input", data: { input: text } }));
    }
  }, []);

  /** Send a full command line (appends the newline that runs it). */
  const sendCommand = useCallback((cmd: string) => {
    sendInput(cmd + "\n");
  }, [sendInput]);

  /** Send Ctrl+C to interrupt the foreground process. */
  const interrupt = useCallback(() => sendInput("\x03"), [sendInput]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try { ws.send(JSON.stringify({ type: "pty:kill" })); } catch {}
      ws.onclose = null; // prevent state churn after manual close
      try { ws.close(); } catch {}
      wsRef.current = null;
    }
    setStatus("disconnected");
    setSessionId(null);
  }, []);

  const clear = useCallback(() => setOutput(""), []);

  // Tear down the socket if the screen unmounts.
  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        try { ws.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, []);

  return { status, output, sessionId, connect, disconnect, sendInput, sendCommand, interrupt, clear };
}
