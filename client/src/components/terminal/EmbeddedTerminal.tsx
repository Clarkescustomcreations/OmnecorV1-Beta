/**
 * EmbeddedTerminal
 *
 * A live in-browser terminal powered by xterm.js + node-pty on the server.
 * Communication is over the existing /ws WebSocket using the pty:* protocol
 * defined in shared/types/terminal.types.ts (imported by both this component
 * and WebSocketServer.ts so the wire contract can't silently drift apart).
 *
 * Features:
 * - Shell selector (bash, zsh, sh, python3, node)
 * - HITL command approval: pressing Enter intercepts the buffer, requests
 *   approval, then either sends to PTY or prints "[Denied]"
 * - Bidirectional chat bridge: Chat.tsx dispatches an "omnecor:cli_command"
 *   CustomEvent when the AI's response contains a <terminal_command> directive;
 *   this component gates it through the same requestApproval() HITL flow as
 *   manual typing, then writes it into the PTY. Terminal output fires an
 *   "omnecor:terminal_output" CustomEvent so the chat can capture context.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { FloatingWindow } from "@/components/window-system/FloatingWindow";
import { useCommandAllowlistStore } from "@/lib/stores/commandAllowlistStore";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Terminal } from "lucide-react";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import type { PtyClientMessage, PtyServerMessage } from "@shared/types/terminal.types";

// ── Types matching the server's WS protocol ────────────────────────────────

type ClientMsg = PtyClientMessage;

type ServerMsg =
  | PtyServerMessage
  | { type: "error"; data?: { message: string } }
  | { type: string; data?: unknown };

const SHELLS = ["bash", "zsh", "sh", "fish", "python3", "node"] as const;
type Shell = (typeof SHELLS)[number];

interface AiCliCommandDetail {
  command: string;
  cwd?: string;
}

interface EmbeddedTerminalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  /** Called when an AI-initiated command needs the terminal window visible/spawned. */
  onRequestOpen?: () => void;
}

export function EmbeddedTerminal({ isOpen, onClose, projectId, onRequestOpen }: EmbeddedTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const [shell, setShell] = useState<Shell>("bash");
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "exited" | "error">("idle");
  const inputBufRef = useRef(""); // accumulates typed chars for HITL intercept
  const pendingAiCommandRef = useRef<string | null>(null); // AI command queued until the PTY session is ready

  const { activeMap } = useNeuralMap();
  const { requestApproval } = useCommandAllowlistStore();

  // ── xterm init ─────────────────────────────────────────────────────────

  const initXterm = useCallback(() => {
    if (!termRef.current) return;
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }

    const term = new XTerm({
      theme: {
        background: "#020817",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selectionBackground: "#38bdf840",
        black: "#1e293b",
        brightBlack: "#475569",
        red: "#f87171",
        brightRed: "#fca5a5",
        green: "#4ade80",
        brightGreen: "#86efac",
        yellow: "#facc15",
        brightYellow: "#fde047",
        blue: "#60a5fa",
        brightBlue: "#93c5fd",
        magenta: "#c084fc",
        brightMagenta: "#d8b4fe",
        cyan: "#38bdf8",
        brightCyan: "#7dd3fc",
        white: "#cbd5e1",
        brightWhite: "#f1f5f9",
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(termRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    // Key handler: intercept Enter for HITL; pass everything else directly
    term.onData(async (data) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!sessionReadyRef.current) return;

      // Backspace
      if (data === "\x7f" || data === "\b") {
        if (inputBufRef.current.length > 0) {
          inputBufRef.current = inputBufRef.current.slice(0, -1);
        }
        send(ws, { type: "pty:input", data: { input: data } });
        return;
      }

      // Enter — HITL check
      if (data === "\r" || data === "\n") {
        const cmd = inputBufRef.current.trim();
        inputBufRef.current = "";

        if (!cmd) {
          send(ws, { type: "pty:input", data: { input: data } });
          return;
        }

        const cwd = activeMap?.rootDirectories[0];
        const scope = await requestApproval(cmd, cwd, projectId);

        if (scope === null) {
          // Denied — print feedback, don't send to PTY
          term.write("\r\n\x1b[31m[HITL] Command denied.\x1b[0m\r\n");
          // Re-print the prompt character by sending a blank line followed by Ctrl-U (clear line)
          send(ws, { type: "pty:input", data: { input: "\x15" } }); // Ctrl-U: clear line
          return;
        }

        // Approved — forward Enter
        send(ws, { type: "pty:input", data: { input: data } });
        return;
      }

      // Normal character — accumulate
      if (data.length === 1 && data >= " ") {
        inputBufRef.current += data;
      } else if (data === "\x1b[A" || data === "\x1b[B") {
        // Up/Down history — clear buffer since shell will fill a new command
        inputBufRef.current = "";
      } else {
        inputBufRef.current = "";
      }

      send(ws, { type: "pty:input", data: { input: data } });
    });

    return term;
  }, [requestApproval, projectId, activeMap]);

  // ── WebSocket connect + PTY spawn ─────────────────────────────────────

  const connect = useCallback(
    (selectedShell: Shell) => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      sessionReadyRef.current = false;
      setStatus("connecting");

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        const term = xtermRef.current;
        if (!term || !fitRef.current) return;
        const { cols, rows } = term;
        const cwd = activeMap?.rootDirectories[0] ?? undefined;
        send(ws, { type: "pty:spawn", data: { shell: selectedShell, cwd, cols, rows } });
      };

      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data as string) as ServerMsg; }
        catch { return; }

        const term = xtermRef.current;

        if (msg.type === "pty:ready") {
          sessionReadyRef.current = true;
          setStatus("ready");
          term?.write("\x1b[2J\x1b[H"); // clear
          term?.write(`\x1b[32m● Session started (${selectedShell})\x1b[0m\r\n`);
          // Flush an AI-initiated command that was approved before the session finished spawning
          if (pendingAiCommandRef.current) {
            const cmd = pendingAiCommandRef.current;
            pendingAiCommandRef.current = null;
            send(ws, { type: "pty:input", data: { input: cmd + "\r" } });
          }
        } else if (msg.type === "pty:output") {
          const out = (msg.data as { output?: string } | undefined)?.output ?? "";
          if (!out) return;
          term?.write(out);
          // Fire CustomEvent so chat can observe terminal output
          window.dispatchEvent(new CustomEvent("omnecor:terminal_output", { detail: out }));
        } else if (msg.type === "pty:exit") {
          sessionReadyRef.current = false;
          setStatus("exited");
          const { exitCode, signal } = (msg.data as { exitCode?: number; signal?: number } | undefined) ?? {};
          const reason = signal ? `signal ${signal}` : `code ${exitCode ?? "unknown"}`;
          term?.write(`\r\n\x1b[33m● Process exited (${reason})\x1b[0m\r\n`);
        } else if (msg.type === "error") {
          setStatus("error");
          const message = (msg.data as { message?: string } | undefined)?.message ?? "Unknown terminal error";
          term?.write(`\r\n\x1b[31m[Error] ${message}\x1b[0m\r\n`);
        }
      };

      ws.onerror = () => setStatus("error");
      ws.onclose = () => {
        sessionReadyRef.current = false;
        if (status !== "exited") setStatus("idle");
      };
    },
    [activeMap, requestApproval, projectId, status]
  );

  // ── Resize observer ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const obs = new ResizeObserver(() => {
      fitRef.current?.fit();
      const term = xtermRef.current;
      const ws = wsRef.current;
      if (term && ws?.readyState === WebSocket.OPEN && sessionReadyRef.current) {
        send(ws, { type: "pty:resize", data: { cols: term.cols, rows: term.rows } });
      }
    });
    if (termRef.current) obs.observe(termRef.current);
    return () => obs.disconnect();
  }, [isOpen]);

  // ── Auto-start when opened ─────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const term = initXterm();
    connect(shell);
    return () => {
      wsRef.current?.close();
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── AI-initiated command bridge ─────────────────────────────────────────
  // Chat.tsx dispatches this once an assistant message finishes streaming and
  // contains a <terminal_command> directive. Gated through the exact same
  // requestApproval() HITL flow as manual typing before anything reaches the
  // PTY — an AI-initiated command is never trusted more than a typed one.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<AiCliCommandDetail>).detail;
      const command = detail?.command?.trim();
      if (!command) return;

      const cwd = detail.cwd ?? activeMap?.rootDirectories[0];
      const scope = await requestApproval(command, cwd, projectId);
      if (scope === null) return; // denied — nothing further to do

      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN && sessionReadyRef.current) {
        send(ws, { type: "pty:input", data: { input: command + "\r" } });
      } else {
        // No live PTY session yet — queue it and ask the parent to open/spawn one;
        // pty:ready flushes pendingAiCommandRef once the session comes up.
        pendingAiCommandRef.current = command;
        onRequestOpen?.();
      }
    };
    window.addEventListener("omnecor:cli_command", handler);
    return () => window.removeEventListener("omnecor:cli_command", handler);
  }, [requestApproval, projectId, activeMap, onRequestOpen]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, []);

  // ── Reconnect with new shell ───────────────────────────────────────────

  const handleRestart = (newShell: Shell) => {
    setShell(newShell);
    inputBufRef.current = "";
    connect(newShell);
  };

  const statusColor =
    status === "ready" ? "text-emerald-400" :
    status === "connecting" ? "text-amber-400" :
    status === "error" ? "text-rose-400" :
    status === "exited" ? "text-slate-500" :
    "text-slate-600";

  const statusLabel =
    status === "ready" ? "Connected" :
    status === "connecting" ? "Connecting…" :
    status === "error" ? "Error" :
    status === "exited" ? "Session ended" :
    "Idle";

  return (
    <FloatingWindow
      title="Live Terminal"
      isOpen={isOpen}
      onClose={() => {
        wsRef.current?.close();
        onClose();
      }}
      initialPosition={{ x: 100, y: 60 }}
      initialSize={{ width: 780, height: 480 }}
    >
      <div className="flex flex-col h-full bg-[#020817] overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border-b border-slate-800 flex-shrink-0">
          <Terminal className="w-3.5 h-3.5 text-slate-500" />
          <span className={cn("text-[10px] font-semibold", statusColor)}>{statusLabel}</span>
          <span className="text-slate-700 text-[10px]">|</span>

          {/* Shell selector */}
          <select
            value={shell}
            onChange={e => handleRestart(e.target.value as Shell)}
            className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          >
            {SHELLS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <button
            onClick={() => handleRestart(shell)}
            className="ml-auto p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title="Restart session"
          >
            {status === "connecting"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* xterm.js mount point */}
        <div
          ref={termRef}
          className="flex-1 p-1 overflow-hidden"
          style={{ minHeight: 0 }}
        />
      </div>
    </FloatingWindow>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: ClientMsg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
