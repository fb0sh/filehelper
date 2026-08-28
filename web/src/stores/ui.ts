import { create } from 'zustand';

type Theme = 'system' | 'light' | 'dark';

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  searchOpen: boolean;
  mobileChatOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setMobileChatOpen: (open: boolean) => void;
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem('filehelper.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'system';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export const useUIStore = create<UIState>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: true,
  searchOpen: false,
  mobileChatOpen: false,
  setTheme: (theme) => {
    localStorage.setItem('filehelper.theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setMobileChatOpen: (open) => set({ mobileChatOpen: open }),
}));

// Initialize theme
applyTheme(getStoredTheme());

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const state = useUIStore.getState();
    if (state.theme === 'system') {
      applyTheme('system');
    }
  });
}