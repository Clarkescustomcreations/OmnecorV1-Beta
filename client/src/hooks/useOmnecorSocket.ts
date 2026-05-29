import { useState, useEffect, useRef, useCallback } from 'react';

export interface FileEvent {
  type: 'add' | 'unlink' | 'change';
  path: string;
  timestamp: number;
}

export interface TrainingProgress {
  jobId: string;
  progress: number;
  eta: number;
}

export interface LifecycleEvent {
  service: string;
  status: 'started' | 'stopped' | 'error';
  message: string;
}

export interface LoopEvent {
  agentId: string;
  hash: string;
  count: number;
  halted: boolean;
}

interface UseOmnecorSocketOptions {
  projectId?: string;
  listenForLoops?: boolean;
}

export function useOmnecorSocket({ projectId, listenForLoops }: UseOmnecorSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [fileEvents, setFileEvents] = useState<FileEvent[]>([]);
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleEvent | null>(null);
  const [loopDetected, setLoopDetected] = useState<LoopEvent | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const reconnectDelayRef = useRef(1000);

  const getWsUrl = () => {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  };

  const connect = useCallback(() => {
    const wsUrl = getWsUrl();
    socketRef.current = new WebSocket(wsUrl);

    socketRef.current.onopen = () => {
      setIsConnected(true);
      reconnectDelayRef.current = 1000;
      
      // Subscribe
      const channels = ['fileEvents', 'trainingProgress', 'lifecycle'];
      if (listenForLoops) channels.push('loopDetected');
      
      socketRef.current?.send(JSON.stringify({ 
        type: 'subscribe', 
        projectId, 
        channels 
      }));

      // Keep-alive ping
      pingIntervalRef.current = setInterval(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    socketRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') return;

        if (msg.type === 'fileEvent') {
          setFileEvents(prev => [...prev.slice(-199), msg.data]);
        } else if (msg.type === 'trainingProgress') {
          setTrainingProgress(msg.data);
        } else if (msg.type === 'lifecycle') {
          setLifecycle(msg.data);
        } else if (msg.type === 'loopDetected' && listenForLoops) {
          setLoopDetected(msg.data);
        }
      } catch (e) {
        console.error('Socket message parse error', e);
      }
    };

    socketRef.current.onclose = () => {
      setIsConnected(false);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
        connect();
      }, reconnectDelayRef.current);
    };
  }, [projectId, listenForLoops]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close(1000);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [connect]);

  const clearFileEvents = () => setFileEvents([]);

  return {
    isConnected,
    fileEvents,
    trainingProgress,
    lifecycle,
    loopDetected,
    clearFileEvents,
  };
}
