import { create } from 'zustand';
import { authApi } from '../api';
import {
  clearSessionToken,
  setLockHandler,
  setReauthHandler,
  setSessionToken,
} from '../api/client';
import { cryptoClient, terminateCryptoWorker } from '../lib/crypto/workerClient';
import {
  clearCryptoSession,
  loadCryptoSession,
  saveCryptoSession,
} from '../lib/crypto/session';
import { decryptedCache } from '../lib/decryptedCache';
import { imagePreviewCache } from '../lib/imagePreviewCache';

export type AuthPhase = 'locked' | 'unlocking' | 'creating' | 'ready';

interface AuthState {
  phase: AuthPhase;
  loginError: string | null;
  /** Set when the server says the space does not exist yet. */
  needsCreate: boolean;
  pendingCreate: {
    spaceId: string;
    authKey: string;
    messageKey: string;
    fileMasterKey: string;
  } | null;
  /** info for the about page */
  instanceId: string | null;
  unlock: (code: string) => Promise<boolean>;
  confirmCreate: () => Promise<boolean>;
  cancelCreate: () => void;
  autoLogin: () => Promise<void>;
  lock: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'locked',
  loginError: null,
  needsCreate: false,
  pendingCreate: null,
  instanceId: null,

  unlock: async (code) => {
    set({ phase: 'unlocking', loginError: null, needsCreate: false, pendingCreate: null });
    try {
      const info = await authApi.info();
      set({ instanceId: info.instanceId });

      // KDF runs in the Web Worker — never on the main thread.
      const keys = await cryptoClient.unlock(code, info.instanceId);
      return await tryLogin(set, keys, info.instanceId);
    } catch (e) {
      set({
        phase: 'locked',
        loginError: e instanceof Error ? e.message : 'Failed to unlock',
      });
      return false;
    }
  },

  confirmCreate: async () => {
    const pending = get().pendingCreate;
    if (!pending) return false;
    set({ phase: 'creating', loginError: null });
    try {
      await authApi.create(pending.spaceId, pending.authKey);
      set({ pendingCreate: null, needsCreate: false });
      const info = await authApi.info();
      return await tryLogin(set, pending, info.instanceId);
    } catch (e) {
      set({
        phase: 'locked',
        needsCreate: false,
        pendingCreate: null,
        loginError:
          e instanceof Error && e.message.includes('already exists')
            ? 'This code already has data — try again.'
            : e instanceof Error
              ? e.message
              : 'Failed to create space',
      });
      return false;
    }
  },

  cancelCreate: () => set({ needsCreate: false, pendingCreate: null, phase: 'locked' }),

  autoLogin: async () => {
    const session = loadCryptoSession();
    if (!session) {
      set({ phase: 'locked' });
      return;
    }
    set({ instanceId: session.instanceId, phase: 'unlocking' });
    try {
      const ok = await tryLogin(set, session, session.instanceId);
      if (!ok) {
        // Server no longer knows this space (e.g. data dir replaced):
        // forget the session and ask for the CODE again.
        clearCryptoSession();
        set({ phase: 'locked' });
      }
    } catch {
      set({ phase: 'locked' });
    }
  },

  lock: async () => {
    clearCryptoSession();
    clearSessionToken();
    terminateCryptoWorker();
    decryptedCache.clear();
    imagePreviewCache.clear();
    set({ phase: 'locked', needsCreate: false, pendingCreate: null, loginError: null });
  },
}));

/** Shared login tail: POST /auth/login, handle SPACE_NOT_FOUND by asking
 * to create, otherwise save the session and enter the app. */
async function tryLogin(
  set: (partial: Partial<AuthState>) => void,
  keys: { spaceId: string; authKey: string; messageKey: string; fileMasterKey: string },
  instanceId: string
): Promise<boolean> {
  try {
    const res = await authApi.login(keys.spaceId, keys.authKey);
    saveCryptoSession({
      spaceId: keys.spaceId,
      authKey: keys.authKey,
      messageKey: keys.messageKey,
      fileMasterKey: keys.fileMasterKey,
      instanceId,
    });
    setSessionToken(res.sessionToken);
    set({ phase: 'ready', loginError: null, needsCreate: false, pendingCreate: null });
    return true;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'SPACE_NOT_FOUND') {
      set({
        phase: 'locked',
        needsCreate: true,
        pendingCreate: {
          spaceId: keys.spaceId,
          authKey: keys.authKey,
          messageKey: keys.messageKey,
          fileMasterKey: keys.fileMasterKey,
        },
      });
      return false;
    }
    set({
      phase: 'locked',
      loginError: err.code === 'RATE_LIMITED' ? 'Too many attempts. Try again later.' : 'Wrong code or server error.',
    });
    return false;
  }
}

// Wire the API client's silent re-auth + lock hooks to this store.
setReauthHandler(async () => {
  const session = loadCryptoSession();
  if (!session) return null;
  try {
    const res = await authApi.login(session.spaceId, session.authKey);
    setSessionToken(res.sessionToken);
    return res.sessionToken;
  } catch {
    return null;
  }
});

setLockHandler(() => {
  void useAuthStore.getState().lock();
});
