type MessageHandler = (event: any) => void;

export function createWebSocket(onMessage: MessageHandler): () => void {
  let ws: WebSocket | null = null;
  let retryDelay = 1000;
  let maxRetryDelay = 15000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function connect() {
    if (destroyed) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/v1/ws`;
    
    ws = new WebSocket(url);
    
    ws.onopen = () => {
      retryDelay = 1000;
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch {}
    };
    
    ws.onclose = () => {
      if (!destroyed) {
        timer = setTimeout(() => {
          connect();
          retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
        }, retryDelay + Math.random() * 1000);
      }
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