import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSocket, WsStatus } from '../lib/websocket';
import { setSessionToken } from '../api/client';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e?: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.onclose?.({ code: 1000 });
    }
  }

  closeWith(code: number) {
    if (!this.closed) {
      this.closed = true;
      this.onclose?.({ code });
    }
  }

  emit(json: string) {
    this.onmessage?.({ data: json });
  }
}

describe('createWebSocket auth-first lifecycle', () => {
  let statuses: WsStatus[];
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    statuses = [];
    setSessionToken('token-1');
    cleanup = createWebSocket({ onStatus: (s) => statuses.push(s) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setSessionToken(null);
  });

  it('sends the auth frame as the first message and connects on auth.ok', () => {
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    expect(ws.sent[0]).toBe(JSON.stringify({ type: 'auth', token: 'token-1' }));
    expect(statuses).toEqual(['connecting']);
    ws.emit('{"type":"auth.ok"}');
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('never delivers events before auth.ok', () => {
    const events: unknown[] = [];
    cleanup();
    cleanup = createWebSocket({
      onStatus: (s) => statuses.push(s),
      onEvent: (e) => events.push(e),
    });
    const ws = MockWebSocket.instances[1];
    ws.onopen?.();
    ws.emit(JSON.stringify({ type: 'message.created', message: { id: '1' } }));
    expect(events).toEqual([]);
    ws.emit('{"type":"auth.ok"}');
    ws.emit(JSON.stringify({ type: 'message.created', message: { id: '2' } }));
    expect(events).toEqual([{ type: 'message.created', message: { id: '2' } }]);
  });

  it('reconnects with backoff after close', () => {
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.emit('{"type":"auth.ok"}');
    ws.close();
    expect(statuses[statuses.length - 1]).toBe('disconnected');
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances.length).toBe(2);
    expect(statuses[statuses.length - 1]).toBe('connecting');
  });

  it('waits for a session token before dialing', () => {
    cleanup();
    setSessionToken(null);
    cleanup = createWebSocket({ onStatus: (s) => statuses.push(s) });
    expect(MockWebSocket.instances.length).toBe(1); // the earlier one
    setSessionToken('token-2');
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances.length).toBe(2);
    MockWebSocket.instances[1].onopen?.();
    expect(MockWebSocket.instances[1].sent[0]).toContain('token-2');
  });

  it('stops reconnecting after cleanup', () => {
    const ws = MockWebSocket.instances[0];
    ws.close();
    cleanup();
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances.length).toBe(1);
  });
});
