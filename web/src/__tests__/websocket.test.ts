import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSocket, WsStatus } from '../lib/websocket';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.onclose?.();
    }
  }

  // test helper
  emit(json: string) {
    this.onmessage?.({ data: json });
  }
}

describe('createWebSocket lifecycle', () => {
  let statuses: WsStatus[];
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    statuses = [];
    cleanup = createWebSocket({
      onStatus: (s) => statuses.push(s),
      onEvent: () => {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('goes connecting → connected on open', () => {
    const ws = MockWebSocket.instances[0];
    expect(statuses).toEqual(['connecting']);
    ws.onopen?.();
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('goes disconnected on close and reconnects with jitter', () => {
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.close();
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);

    // Advance past the initial 1s retry delay + jitter.
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances.length).toBe(2);
    expect(statuses[statuses.length - 1]).toBe('connecting');

    MockWebSocket.instances[1].onopen?.();
    expect(statuses[statuses.length - 1]).toBe('connected');
  });

  it('delivers parsed events to onEvent', () => {
    const events: unknown[] = [];
    cleanup();
    cleanup = createWebSocket({
      onStatus: (s) => statuses.push(s),
      onEvent: (e) => events.push(e),
    });
    const ws = MockWebSocket.instances[1];
    ws.emit(JSON.stringify({ type: 'message.created', message: { id: '1' } }));
    ws.emit('not-json');
    expect(events).toEqual([{ type: 'message.created', message: { id: '1' } }]);
  });

  it('stops reconnecting after cleanup', () => {
    const ws = MockWebSocket.instances[0];
    ws.close();
    cleanup();
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances.length).toBe(1);
  });
});