// Per-tab crypto session storage. Derived keys live only in
// sessionStorage (survives refresh, gone when the tab/browser closes).
// The CODE, root key and content keys are NEVER written to localStorage.

import { base64urlToBytes, bytesToBase64url } from './encoding';
import type { DerivedKeys } from './core';

const SESSION_KEY = 'filehelper.cryptoSession';

export interface CryptoSession extends DerivedKeys {
  instanceId: string;
}

export function saveCryptoSession(session: CryptoSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadCryptoSession(): CryptoSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CryptoSession;
    if (
      typeof parsed.spaceId !== 'string' ||
      typeof parsed.authKey !== 'string' ||
      typeof parsed.messageKey !== 'string' ||
      typeof parsed.fileMasterKey !== 'string' ||
      typeof parsed.instanceId !== 'string'
    ) {
      return null;
    }
    // Sanity: keys must be valid 32-byte base64url.
    for (const k of [parsed.authKey, parsed.messageKey, parsed.fileMasterKey]) {
      if (base64urlToBytes(k).length !== 32) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCryptoSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/** Encode a 32-byte key as base64url (used by tests). */
export function encodeKey(bytes: Uint8Array): string {
  return bytesToBase64url(bytes);
}

export { bytesToBase64url };
