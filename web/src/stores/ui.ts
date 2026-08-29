import { create } from 'zustand';

type Theme = 'system' | 'light' | 'dark';
export type SettingsSection = 'appearance' | 'storage' | 'about';

interface UIState {
  theme: Theme;
  mobileChatOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  setTheme: (theme: Theme) => void;
  setMobileChatOpen: (open: boolean) => void;
  openSettings: (section: SettingsSection) => void;
  closeSettings: () => void;
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
  mobileChatOpen: false,
  settingsOpen: false,
  settingsSection: 'appearance',
  setTheme: (theme) => {
    localStorage.setItem('filehelper.theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  setMobileChatOpen: (open) => set({ mobileChatOpen: open }),
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
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