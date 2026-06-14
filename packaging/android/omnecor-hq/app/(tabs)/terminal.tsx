/**
 * Terminal — live remote shell on the PC over WebSocket PTY.
 *
 * Drives a real pseudo-terminal on the Omnecor server (the PC already implements
 * the pty:* protocol). Auto-connects on mount when a server IP is configured in
 * Settings. Output is rendered via xterm.js in a WebView (full ANSI colour);
 * the mobile command bar provides a convenience TextInput + history for thumb
 * typing, but the WebView terminal itself accepts direct keyboard input too.
 */
import { View, Text, TextInput, useWindowDimensions } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useEffect, useRef, useCallback } from "react";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useTerminal, type TerminalStatus } from "@/hooks/use-terminal";
import { isServerConfigured, getServerIp } from "@/lib/_core/server-config";

// ── Status bar metadata ──────────────────────────────────────────────────────

const STATUS_COLOR: Record<TerminalStatus, string> = {
  disconnected: "text-muted",
  connecting:   "text-warning",
  ready:        "text-success",
  error:        "text-error",
};

const STATUS_LABEL: Record<TerminalStatus, string> = {
  disconnected: "Disconnected",
  connecting:   "Connecting…",
  ready:        "● Connected",
  error:        "Connection error",
};

// ── Inline xterm.js WebView HTML ─────────────────────────────────────────────
//
// Loaded once from CDN; once the DOM is ready it posts {type:'ready',cols,rows}
// back to RN. After that:
//   RN → WebView : injectJavaScript calls window.writeToTerm / window.fitTerm /
//                  window.clearTerm
//   WebView → RN : postMessage with {type:'input',data} or {type:'resize',cols,rows}

const XTERM_HTML = `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css"/>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<style>html,body,#t{margin:0;height:100%;width:100%;background:#0b1220}</style>
</head><body><div id="t"></div><script>
  var post = function(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var term = new Terminal({fontSize:12,convertEol:false,cursorBlink:true,theme:{background:'#0b1220'}});
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  window.writeToTerm = function(s){ term.write(s); };
  window.clearTerm   = function(){ term.clear(); };
  window.fitTerm     = function(){
    try{ fit.fit(); post({type:'resize',cols:term.cols,rows:term.rows}); }catch(e){}
  };
  term.onData(function(d){ post({type:'input',data:d}); });
  window.addEventListener('resize', function(){ window.fitTerm(); });
  post({type:'ready',cols:term.cols,rows:term.rows});
<\/script></body></html>`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function TerminalScreen() {
  const colors = useColors();
  const { width, height } = useWindowDimensions();

  const {
    status,
    connect,
    disconnect,
    sendInput,
    sendCommand,
    interrupt,
    clear,
    sendResize,
    subscribeOutput,
  } = useTerminal();

  const webviewRef = useRef<WebView>(null);

  // Track whether we've triggered the first connect (the WebView drives it via
  // the 'ready' message so we know the real initial cols/rows).
  const connectedRef = useRef(false);

  const [commandInput, setCommandInput]     = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex]     = useState(-1);

  // ── Subscribe to raw PTY output → push to xterm.js ──────────────────────
  useEffect(() => {
    const unsub = subscribeOutput((chunk) => {
      // Escape the chunk as a JSON string so it survives injection safely.
      webviewRef.current?.injectJavaScript(
        "window.writeToTerm(" + JSON.stringify(chunk) + ");true;"
      );
    });
    return unsub;
  }, [subscribeOutput]);

  // ── Re-fit xterm when the device rotates / window resizes ───────────────
  useEffect(() => {
    webviewRef.current?.injectJavaScript("window.fitTerm&&window.fitTerm();true;");
  }, [width, height]);

  // Disconnect on unmount.
  useEffect(() => {
    return () => { disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebView → RN message bridge ──────────────────────────────────────────
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        cols?: number;
        rows?: number;
        data?: string;
      };
      switch (msg.type) {
        case "ready":
          // First paint: connect the PTY with the real terminal dimensions.
          if (!connectedRef.current && isServerConfigured()) {
            connectedRef.current = true;
            connect(msg.cols ?? 80, msg.rows ?? 24);
          }
          break;
        case "input":
          if (msg.data !== undefined) sendInput(msg.data);
          break;
        case "resize":
          if (msg.cols !== undefined && msg.rows !== undefined) {
            sendResize(msg.cols, msg.rows);
          }
          break;
      }
    } catch {
      /* ignore malformed messages */
    }
  }, [connect, sendInput, sendResize]);

  // ── Command bar helpers ──────────────────────────────────────────────────
  const handleExecuteCommand = () => {
    if (!commandInput.trim() || status !== "ready") return;
    sendCommand(commandInput);
    setCommandHistory((h) => [...h, commandInput]);
    setHistoryIndex(-1);
    setCommandInput("");
  };

  const handleHistoryUp = () => {
    if (commandHistory.length === 0) return;
    const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
    setHistoryIndex(newIndex);
    setCommandInput(commandHistory[commandHistory.length - 1 - newIndex]);
  };

  const handleHistoryDown = () => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      setCommandInput("");
    } else {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCommandInput(commandHistory[commandHistory.length - 1 - newIndex]);
    }
  };

  const handleConnect = useCallback(() => {
    connectedRef.current = false;
    // If the WebView hasn't fired 'ready' yet, fall back to default size.
    // The 'ready' message handler will call connect with real cols/rows if it
    // fires first; otherwise this ensures a manual tap always works.
    connect();
    connectedRef.current = true;
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    connectedRef.current = false;
    disconnect();
  }, [disconnect]);

  const handleClear = useCallback(() => {
    webviewRef.current?.injectJavaScript("window.clearTerm&&window.clearTerm();true;");
    clear();
  }, [clear]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* ── Status bar ──────────────────────────────────────────────── */}
      <View className="flex-row items-center justify-between px-4 py-2 border-b border-border bg-surface">
        <Text className={`text-xs font-semibold ${STATUS_COLOR[status]}`}>
          {STATUS_LABEL[status]}
          {isServerConfigured() ? `  ·  ${getServerIp()}` : ""}
        </Text>
        {status === "ready" || status === "connecting" ? (
          <Pressable
            onPress={handleDisconnect}
            className="px-2 py-1 rounded border border-error active:opacity-70"
          >
            <Text className="text-error text-xs font-semibold">Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleConnect}
            className="px-2 py-1 rounded bg-primary active:opacity-80"
          >
            <Text className="text-background text-xs font-semibold">Connect</Text>
          </Pressable>
        )}
      </View>

      {/* ── xterm.js WebView ────────────────────────────────────────── */}
      <WebView
        ref={webviewRef}
        style={{ flex: 1 }}
        source={{ html: XTERM_HTML }}
        originWhitelist={["*"]}
        javaScriptEnabled
        onMessage={handleMessage}
        // Allow loading CDN resources
        mixedContentMode="always"
      />

      {/* ── Controls ────────────────────────────────────────────────── */}
      <View className="border-t border-border bg-surface p-4 gap-3">
        <View className="flex-row gap-2 items-center">
          <Text className="text-foreground font-mono">$</Text>
          <TextInput
            value={commandInput}
            onChangeText={setCommandInput}
            onSubmitEditing={handleExecuteCommand}
            editable={status === "ready"}
            placeholder={status === "ready" ? "Enter command…" : "Not connected"}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs"
          />
          <Pressable
            onPress={handleExecuteCommand}
            disabled={status !== "ready"}
            className={`rounded-lg px-3 py-2 ${status === "ready" ? "bg-primary active:opacity-80" : "bg-primary/30"}`}
          >
            <Text className="text-background font-semibold text-xs">Enter</Text>
          </Pressable>
        </View>

        <View className="flex-row gap-2">
          <Pressable
            onPress={handleHistoryUp}
            className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70"
          >
            <Text className="text-foreground text-xs">↑ History</Text>
          </Pressable>
          <Pressable
            onPress={handleHistoryDown}
            className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70"
          >
            <Text className="text-foreground text-xs">↓ History</Text>
          </Pressable>
          <Pressable
            onPress={() => sendInput("\x03")}
            disabled={status !== "ready"}
            className={`flex-1 border rounded-lg p-2 items-center ${status === "ready" ? "bg-warning/20 border-warning active:opacity-70" : "border-muted/30"}`}
          >
            <Text className={`text-xs font-semibold ${status === "ready" ? "text-warning" : "text-muted"}`}>^C</Text>
          </Pressable>
          <Pressable
            onPress={handleClear}
            className="flex-1 bg-error/20 border border-error rounded-lg p-2 items-center active:opacity-70"
          >
            <Text className="text-error text-xs font-semibold">Clear</Text>
          </Pressable>
        </View>

        <View className="bg-background border border-border rounded-lg p-2">
          <Text className="text-xs text-muted">
            Real shell on the PC. Type directly in the terminal above, or use the bar below. Runs over Tailscale/LAN.
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
