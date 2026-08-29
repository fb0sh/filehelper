import { useSyncExternalStore } from 'react';
import { decryptedCache } from '../lib/decryptedCache';

/**
 * Re-render whenever the in-memory decrypted cache mutates (new decrypted
 * history, realtime message, delete, clear). Drives the client-side
 * search results without polling or manual event plumbing.
 */
export function useDecryptedCacheVersion(): number {
  return useSyncExternalStore(
    decryptedCache.subscribe,
    decryptedCache.getVersion
  );
}
