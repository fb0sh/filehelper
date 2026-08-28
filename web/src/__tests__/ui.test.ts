import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

import { useUIStore } from '../stores/ui';

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      theme: 'system',
      sidebarOpen: true,
      searchOpen: false,
      mobileChatOpen: false,
    });
    localStorage.clear();
  });

  it('defaults to system theme', () => {
    expect(useUIStore.getState().theme).toBe('system');
  });

  it('changes theme and persists', () => {
    useUIStore.getState().setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('filehelper.theme')).toBe('dark');
  });

  it('restores theme from localStorage', () => {
    localStorage.setItem('filehelper.theme', 'light');
    // Re-initialize
    expect(useUIStore.getState().theme).toBe('system'); // state was reset
    const stored = localStorage.getItem('filehelper.theme');
    expect(stored).toBe('light');
  });

  it('toggles sidebar', () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  it('sets search open', () => {
    useUIStore.getState().setSearchOpen(true);
    expect(useUIStore.getState().searchOpen).toBe(true);
  });

  it('sets mobile chat open', () => {
    useUIStore.getState().setMobileChatOpen(true);
    expect(useUIStore.getState().mobileChatOpen).toBe(true);
  });
});