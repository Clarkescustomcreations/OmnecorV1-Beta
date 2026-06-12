import { useState, useEffect, useRef, useCallback } from "react";
import { FileEvent } from "@/types/neural";
import { useAppStore } from "@/lib/store/app.store";
import { IS_DEMO } from "@/lib/demo";

export interface JobProgressEvent {
  percent: number;
  message: string;
}

export interface LoopAlert {
  sessionId: string;
  actionHash: string;
  count: number;
}

export type OmnecorEventType =
  | "FILE_CREATED"
  | "FILE_UPDATED"
  | "FILE_DELETED"
  | "DIRECTORY_CREATED"
  | "DIRECTORY_REMOVED"
  | "GRAPH_UPDATED"
  | "WATCHER_STATUS"
  | "HITL_ALERT"
  | "AI_ACTIVITY"
  | "INDEXING_PROGRESS"
  | "MAP_SWITCHED"
  | "MAP_REINDEXED"
  | "FICTION_EVENT"
  | "budget:spend"
  | "notification";

export function useOmnecorSocket(
  options: {
    projectId?: string;
    jobId?: string;
    listenForLoops?: boolean;
    onEvent?: (type: OmnecorEventType, data: Record<string, unknown>) => void;
  } = {}
) {
  const { projectId, jobId, listenForLoops, onEvent } = options;
  const [connected, setConnected] = useState(false);
  const [fileEvents, setFileEvents] = useState<FileEvent[]>([]);
  const [jobProgress, setJobProgress] = useState<JobProgressEvent | null>(null);
  const [jobLifecycle, setJobLifecycle] = useState<
    "idle" | "running" | "completed" | "failed"
  >("idle");
  const [loopAlert, setLoopAlert] = useState<LoopAlert | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subscribedChannels = useRef<Set<string>>(new Set());

  const WS_URL = (() => {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    if (typeof window === "undefined") return "ws://localhost:3000/ws";
    // Capacitor thin-client: connect to desktop brain
    const capacitorHost = localStorage.getItem("omnecor_server_ip");
    const capacitorPort = localStorage.getItem("omnecor_server_port") || "3000";
    if (capacitorHost && capacitorHost !== "localhost") {
      return `ws://${capacitorHost}:${capacitorPort}/ws`;
    }
    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${wsProto}://${window.location.host}/ws`;
  })();

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

  const connect = useCallback(
    (reconnectDelay = 1000) => {
      // Demo/static build: no backend, so never open the socket (and never
      // enter the reconnect loop that would spam failed-connection errors).
      if (IS_DEMO) return;

      // Close existing if any
      if (socketRef.current) {
        socketRef.current.close();
      }

      socketRef.current = new WebSocket(WS_URL);

      socketRef.current.onopen = () => {
        setConnected(true);
        reconnectDelay = 1000;

        // Base subscriptions
        const baseChannels = [
          "trainingProgress",
          "lifecycle",
          ...(listenForLoops ? ["loopDetected"] : [])
        ];
        
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: "subscribe",
            projectId,
            channels: baseChannels
          }));
        }

        // Resubscribe custom channels
        subscribedChannels.current.forEach(channel => {
          socketRef.current?.send(
            JSON.stringify({ type: "subscribe", channel })
          );
        });

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
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

          // Dispatch to generic onEvent if provided
          if (onEvent && message.type) {
            onEvent(message.type as OmnecorEventType, message.data);
          }

          if (message.type === "fileEvent" || message.type === "FILE_CREATED" || message.type === "FILE_UPDATED") {
            const fileData: FileEvent = message.data;
            setFileEvents(prev => [...prev.slice(-199), fileData]);
          } else if (message.type === "trainingProgress" || message.type === "INDEXING_PROGRESS") {
            setJobProgress(message.data);
          } else if (message.type === "lifecycle") {
            setJobLifecycle(
              message.data.state === "completed" ? "completed" : "failed"
            );
          } else if (message.type === "loopDetected" || message.type === "HITL_ALERT") {
            setLoopAlert(message.data);
          } else if (message.type === "budget:spend") {
            useAppStore.getState().setWalletSpend(message.data);
          }
        } catch (e) {
          console.error("Socket message parse error", e);
        }
      };

      socketRef.current.onerror = (event) => {
        console.error("[OmnecorSocket] WebSocket error", event);
        setConnected(false);
      };

      socketRef.current.onclose = () => {
        setConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect(Math.min(reconnectDelay * 2, 30000));
        }, reconnectDelay);
      };
    },
    [WS_URL, listenForLoops, onEvent, projectId]
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

  useEffect(() => {
    if (projectId) {
      subscribe(`files:${projectId}`);
      subscribe(`neural:${projectId}`); // New neural channel
      return () => {
        unsubscribe(`files:${projectId}`);
        unsubscribe(`neural:${projectId}`);
      };
    }
  }, [projectId, subscribe, unsubscribe]);

  useEffect(() => {
    if (jobId) {
      subscribe(`hardware:${jobId}`);
      return () => unsubscribe(`hardware:${jobId}`);
    }
  }, [jobId, subscribe, unsubscribe]);

  return {
    connected,
    fileEvents,
    clearFileEvents: () => setFileEvents([]),
    jobProgress,
    jobLifecycle,
    loopAlert,
    clearLoopAlert: () => setLoopAlert(null),
    subscribe,
    unsubscribe,
    send: (msg: Record<string, unknown>) => socketRef.current?.send(JSON.stringify(msg)),
  };
}
