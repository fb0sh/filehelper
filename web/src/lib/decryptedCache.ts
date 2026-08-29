// In-memory decrypted message cache for the current tab. Never persisted
// (no IndexedDB/localStorage plaintext). A refresh reloads from the
// server and decrypts again.

import type { DecryptedMessage } from './crypto/messages';

const cache = new Map<string, DecryptedMessage>();

export const decryptedCache = {
  get(id: string): DecryptedMessage | undefined {
    return cache.get(id);
  },
  set(message: DecryptedMessage): void {
    cache.set(message.id, message);
  },
  delete(id: string): void {
    cache.delete(id);
  },
  deleteMany(ids: Iterable<string>): void {
    for (const id of ids) cache.delete(id);
  },
  clear(): void {
    cache.clear();
  },
  has(id: string): boolean {
    return cache.has(id);
  },
  /** All decrypted messages currently in memory (for client search). */
  all(): DecryptedMessage[] {
    return [...cache.values()];
  },
  size(): number {
    return cache.size;
  },
};
