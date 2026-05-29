import { useState, useEffect, useRef, useCallback } from "react";

export interface FileEvent {
  eventType: "add" | "addDir" | "change" | "unlink" | "unlinkDir";
  relativePath: string;
  size: number;
  extension: string;
  timestamp: string;
}

export interface JobProgressEvent {
  percent: number;
  message: string;
}
export interface LoopAlert {
  sessionId: string;
  actionHash: string;
  count: number;
}

export function useOmnecorSocket(
  options: {
    projectId?: string;
    jobId?: string;
    listenForLoops?: boolean;
  } = {}
) {
  const { projectId, jobId, listenForLoops } = options;
  const [connected, setConnected] = useState(false);
  const [fileEvents, setFileEvents] = useState<FileEvent[]>([]);
  const [jobProgress, setJobProgress] = useState<JobProgressEvent | null>(null);
  const [jobLifecycle, setJobLifecycle] = useState<
    "idle" | "running" | "completed" | "failed"
  >("idle");
  const [loopAlert, setLoopAlert] = useState<LoopAlert | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const pingIntervalRef = useRef<any>(null);
  const subscribedChannels = useRef<Set<string>>(new Set());

  const WS_URL =
    import.meta.env.VITE_WS_URL ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}://${window.location.host}/ws`;

  const subscribe = useCallback((channel: string) => {
    subscribedChannels.current.add(channel);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "subscribe", channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    subscribedChannels.current.delete(channel);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "unsubscribe", channel }));
    }
  }, []);

  const clearLoopAlert = useCallback(() => setLoopAlert(null), []);

  const connect = useCallback(
    (reconnectDelay = 1000) => {
      socketRef.current = new WebSocket(WS_URL);

      socketRef.current.onopen = () => {
        setConnected(true);
        reconnectDelay = 1000; // Reset backoff

        // Resubscribe on reconnect
        subscribedChannels.current.forEach(channel => {
          socketRef.current?.send(
            JSON.stringify({ type: "subscribe", channel })
          );
        });

        pingIntervalRef.current = setInterval(() => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "ping" }));
          }
        }, 25000);
      };

      socketRef.current.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "pong") return;

          if (message.type === "fileEvent") {
            setFileEvents(prev => [...prev.slice(-199), message.data]);
          } else if (message.type === "trainingProgress") {
            setJobProgress(message.data);
          } else if (message.type === "lifecycle") {
            setJobLifecycle(
              message.data.state === "completed" ? "completed" : "failed"
            );
          } else if (message.type === "loopDetected" && listenForLoops) {
            setLoopAlert(message.data);
          }
        } catch (e) {
          console.error("Socket message parse error", e);
        }
      };

      socketRef.current.onclose = () => {
        setConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect(Math.min(reconnectDelay * 2, 30000));
        }, reconnectDelay);
      };
    },
    [WS_URL, listenForLoops]
  );

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close();
      if (reconnectTimeoutRef.current)
        clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [connect]);

  // Handle projectId change
  useEffect(() => {
    if (projectId) {
      subscribe(`files:${projectId}`);
      return () => unsubscribe(`files:${projectId}`);
    }
  }, [projectId, subscribe, unsubscribe]);

  // Handle jobId change
  useEffect(() => {
    if (jobId) {
      subscribe(`hardware:${jobId}`);
      return () => unsubscribe(`hardware:${jobId}`);
    }
  }, [jobId, subscribe, unsubscribe]);

  return {
    connected,
    fileEvents,
    jobProgress,
    jobLifecycle,
    loopAlert,
    clearLoopAlert,
    subscribe,
    unsubscribe,
  };
}
