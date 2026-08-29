// WebSocket with in-band auth and exponential backoff reconnect.
// The browser cannot set an Authorization header on WS, so the client
// sends `{"type":"auth","token":...}` as its FIRST frame. The server
// replies `{"type":"auth.ok"}` or closes with 1008. If the session
// token expired, the caller re-auths via HTTP and reconnects.

import { getSessionToken, reauthOnce } from '../api/client';

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export interface WebSocketHandlers {
  onEvent?: (event: unknown) => void;
  onStatus?: (status: WsStatus) => void;
  /** Called when the server rejects our token (close 1008). Return a
   * fresh token, or null to give up (lock). */
  onAuthRejected?: () => Promise<string | null>;
}

export function createWebSocket({ onEvent, onStatus, onAuthRejected = reauthOnce }: WebSocketHandlers): () => void {
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
    const token = getSessionToken();
    if (!token) {
      // No session yet (still unlocking): wait and retry shortly.
      timer = setTimeout(connect, 500);
      return;
    }
    onStatus?.('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/ws`);
    let authed = false;

    ws.onopen = () => {
      // First frame must be the auth message.
      ws?.send(JSON.stringify({ type: 'auth', token: getSessionToken() }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === 'auth.ok') {
          authed = true;
          retryDelay = 1000;
          onStatus?.('connected');
          return;
        }
        if (authed) onEvent?.(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = (event) => {
      if (destroyed) return;
      if (!authed && event.code === 1008 && onAuthRejected) {
        // Token rejected: try to refresh it once, then reconnect.
        void onAuthRejected().then((fresh) => {
          if (destroyed) return;
          if (fresh) {
            onStatus?.('connecting');
            retryDelay = 1000;
            connect();
          } else {
            scheduleReconnect();
          }
        });
        return;
      }
      scheduleReconnect();
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

