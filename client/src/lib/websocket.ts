
import { useAppStore } from "./store/app.store";

export class WebSocketManager {
  private static instance: WebSocketManager;
  private ws: WebSocket | null = null;
  private messageQueue: string[] = [];
  private reconnectAttempts = 0;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private url: string | null = null;

  private constructor() {}

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  connect(url: string): void {
    this.url = url;
    this.ws = new WebSocket(url);

    if (this.reconnectAttempts === 0) {
      useAppStore.getState().setWsStatus('connecting');
    } else {
      useAppStore.getState().setWsStatus('reconnecting');
    }

    this.ws.onopen = () => {
      console.log('[WS] Connected to', url);
      this.reconnectAttempts = 0;
      useAppStore.getState().setWsStatus('connected');
      this.flushQueue();
    };

    this.ws.onmessage = (event) => {
      this.dispatch(event);
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.ws = null;
      useAppStore.getState().setWsStatus('offline');
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
      this.ws?.close();
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.url = null;
  }

  send(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      console.log('[WS] Queuing message:', type);
      this.messageQueue.push(message);
    }
  }

  on(type: string, handler: (data: any) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);

    return () => {
      const handlers = this.listeners.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }

  private handleReconnect(): void {
    if (!this.url || this.reconnectAttempts >= 5) {
      if (this.reconnectAttempts >= 5) {
        console.error('[WS] Max reconnect attempts reached');
      }
      return;
    }

    const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 16000);
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.url) {
        this.connect(this.url);
      }
    }, delay);
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      if (message) {
        this.ws.send(message);
      }
    }
  }

  private dispatch(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      const type = data.type;
      const handlers = this.listeners.get(type);
      if (handlers) {
        handlers.forEach((handler) => handler(data.payload));
      }
    } catch (error) {
      console.error('[WS] Failed to dispatch message:', error);
    }
  }
}
