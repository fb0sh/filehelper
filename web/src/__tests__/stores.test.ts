import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useUIStore } from '../stores/ui';
import { useSearchStore } from '../stores/search';
import { useRealtimeStore } from '../stores/realtime';
import { messageKeys, searchKeys } from '../api/queryKeys';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { renderHook, act } from '@testing-library/react';
import { Message } from '../api';

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({ theme: 'system', mobileChatOpen: false });
    localStorage.clear();
  });

  it('changes theme and persists', () => {
    useUIStore.getState().setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('filehelper.theme')).toBe('dark');
  });

  it('sets mobile chat open', () => {
    useUIStore.getState().setMobileChatOpen(true);
    expect(useUIStore.getState().mobileChatOpen).toBe(true);
  });
});

describe('useSearchStore', () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, query: '', jumpRequest: null });
  });

  it('opens and closes search without keeping query state', () => {
    const { setOpen, setQuery } = useSearchStore.getState();
    setOpen(true);
    setQuery('hello');
    expect(useSearchStore.getState().open).toBe(true);
    setOpen(false);
    expect(useSearchStore.getState().open).toBe(false);
    // Closing does not fire a jump; query is reset by consumers on next open.
  });

  it('requestJump carries a message with an incrementing nonce', () => {
    const msg = { id: 'm1' } as Message;
    const { requestJump } = useSearchStore.getState();
    requestJump(msg);
    const first = useSearchStore.getState().jumpRequest;
    expect(first?.message.id).toBe('m1');
    requestJump(msg);
    const second = useSearchStore.getState().jumpRequest;
    expect(second!.nonce).toBeGreaterThan(first!.nonce);
    useSearchStore.getState().clearJump();
    expect(useSearchStore.getState().jumpRequest).toBeNull();
  });
});

describe('useRealtimeStore', () => {
  it('starts in connecting state', () => {
    expect(useRealtimeStore.getState().status).toBe('connecting');
  });

  it('tracks status transitions', () => {
    useRealtimeStore.getState().setStatus('connected');
    expect(useRealtimeStore.getState().status).toBe('connected');
    useRealtimeStore.getState().setStatus('disconnected');
    expect(useRealtimeStore.getState().status).toBe('disconnected');
  });
});

describe('query keys', () => {
  it('separates infinite and latest message caches', () => {
    expect(messageKeys.infinite).toEqual(['messages', 'infinite']);
    expect(messageKeys.latest).toEqual(['messages', 'latest']);
    expect(messageKeys.infinite).not.toEqual(messageKeys.latest);
  });

  it('scopes search cache by query', () => {
    expect(searchKeys.results('abc')).toEqual(['search', 'abc']);
    expect(searchKeys.results('abc')).not.toEqual(searchKeys.results('abd'));
  });
});

describe('useDebouncedValue', () => {
  it('updates only after the delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } }
    );
    expect(result.current).toBe('a');
    rerender({ value: 'ab' });
    // Before the delay elapses the old value is still served.
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('ab');
    vi.useRealTimers();
  });

  it('cancels pending updates when the value changes again', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'first' } }
    );
    rerender({ value: 'second' });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ value: 'third' });
    act(() => { vi.advanceTimersByTime(200); });
    // 'second' was pending but got cancelled — never leaks through.
    expect(result.current).toBe('first');
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('third');
    vi.useRealTimers();
  });
});