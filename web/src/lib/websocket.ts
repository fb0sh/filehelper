export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export interface WebSocketHandlers {
  onEvent?: (event: unknown) => void;
  onStatus?: (status: WsStatus) => void;
}

// WebSocket with exponential backoff reconnect (1s → 15s, + jitter).
// Status lifecycle: connecting → connected → (close) disconnected →
// (retry) connecting → …
export function createWebSocket({ onEvent, onStatus }: WebSocketHandlers): () => void {
  let ws: WebSocket | null = null;
  let retryDelay = 1000;
  const maxRetryDelay = 15000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const scheduleReconnect = () => {
    onStatus?.('disconnected');
    timer = setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      connect();
    }, retryDelay + Math.random() * 1000);
  };

  function connect() {
    if (destroyed) return;
    onStatus?.('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/ws`);

    ws.onopen = () => {
      retryDelay = 1000;
      onStatus?.('connected');
    };

    ws.onmessage = (event) => {
      try {
        onEvent?.(JSON.parse(event.data));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!destroyed) scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return () => {
    destroyed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}