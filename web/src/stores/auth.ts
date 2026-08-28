import { create } from 'zustand';
import { authApi } from '../api';

interface AuthState {
  isAuthenticated: boolean;
  loginError: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  loginError: null,
  login: async (password) => {
    try {
      await authApi.login({ password });
      set({ isAuthenticated: true, loginError: null });
      return true;
    } catch (e: any) {
      set({ loginError: e.message || 'Invalid password' });
      return false;
    }
  },
  logout: async () => {
    try {
      await authApi.logout();
    } catch {}
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