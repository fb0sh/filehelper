import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveCryptoSession,
  loadCryptoSession,
  clearCryptoSession,
} from '../lib/crypto/session';
import { bytesToBase64url } from '../lib/crypto/encoding';

const key = bytesToBase64url(new Uint8Array(32).fill(7));

function session(over: Record<string, unknown> = {}) {
  return {
    spaceId: 'space-test',
    authKey: key,
    messageKey: key,
    fileMasterKey: key,
    instanceId: 'instance-test',
    ...over,
  };
}

describe('crypto session storage', () => {
  beforeEach(() => sessionStorage.clear());

  it('persists across a simulated refresh (sessionStorage)', () => {
    saveCryptoSession(session());
    const loaded = loadCryptoSession();
    expect(loaded?.spaceId).toBe('space-test');
    expect(loaded?.messageKey).toBe(key);
  });

  it('never touches localStorage', () => {
    saveCryptoSession(session());
    expect(localStorage.getItem('filehelper.cryptoSession')).toBeNull();
    expect(sessionStorage.getItem('filehelper.cryptoSession')).not.toBeNull();
  });

  it('rejects malformed stored sessions', () => {
    sessionStorage.setItem('filehelper.cryptoSession', 'not json');
    expect(loadCryptoSession()).toBeNull();

    sessionStorage.setItem(
      'filehelper.cryptoSession',
      JSON.stringify({ spaceId: 'x', authKey: 'short', messageKey: 'x', fileMasterKey: 'y', instanceId: 'i' })
    );
    expect(loadCryptoSession()).toBeNull();
  });

  it('clear removes the session', () => {
    saveCryptoSession(session());
    clearCryptoSession();
    expect(loadCryptoSession()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
