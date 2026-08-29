import { create } from 'zustand';
import { authApi } from '../api';

interface AuthState {
  isAuthenticated: boolean;
  loginError: string | null;
  login: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  loginError: null,
  login: async (code) => {
    try {
      await authApi.login({ code });
      set({ isAuthenticated: true, loginError: null });
      return true;
    } catch (e) {
      set({ loginError: e instanceof Error ? e.message : 'Invalid access code' });
      return false;
    }
  },
  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore network errors on logout
    }
    set({ isAuthenticated: false });
  },
  checkSession: async () => {
    try {
      await authApi.session();
      set({ isAuthenticated: true });
    } catch {
      set({ isAuthenticated: false });
    }
  },
}));