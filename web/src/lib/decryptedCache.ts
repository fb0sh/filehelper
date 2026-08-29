// In-memory decrypted message cache for the current tab. Never persisted
// (no IndexedDB/localStorage plaintext). A refresh reloads from the
// server and decrypts again.
//
// The cache is reactive: every mutation bumps a version and notifies
// subscribers, so the client-side search can recompute results with
// useSyncExternalStore instead of guessing when to re-render.

import type { DecryptedMessage } from './crypto/messages';

const cache = new Map<string, DecryptedMessage>();

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const decryptedCache = {
  get(id: string): DecryptedMessage | undefined {
    return cache.get(id);
  },
  set(message: DecryptedMessage): void {
    cache.set(message.id, message);
    bump();
  },
  /** Batch insert (e.g. one search-history page) → a single version bump,
   * so result recomputation happens once per page, not once per message. */
  setMany(messages: Iterable<DecryptedMessage>): void {
    let changed = false;
    for (const m of messages) {
      cache.set(m.id, m);
      changed = true;
    }
    if (changed) bump();
  },
  delete(id: string): void {
    if (cache.delete(id)) bump();
  },
  deleteMany(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (cache.delete(id)) changed = true;
    }
    if (changed) bump();
  },
  clear(): void {
    if (cache.size === 0) return;
    cache.clear();
    bump();
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
  /** External-store subscription: returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Monotonic version, incremented on every mutation. */
  getVersion(): number {
    return version;
  },
};
