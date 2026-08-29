// Tiny in-memory image preview cache (LRU, ~128 MiB cap). Evicted or
// deleted entries have their object URL revoked. No third-party lib.

import { IMAGE_CACHE_MAX_BYTES } from './crypto/constants';

interface PreviewEntry {
  attachmentId: string;
  url: string;
  bytes: number;
  lastUsed: number;
}

const entries = new Map<string, PreviewEntry>();
let totalBytes = 0;

function revoke(entry: PreviewEntry) {
  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    // no-op in non-browser test env
  }
}

function touch(attachmentId: string) {
  const e = entries.get(attachmentId);
  if (e) e.lastUsed = Date.now();
}

function evictIfNeeded() {
  while (totalBytes > IMAGE_CACHE_MAX_BYTES && entries.size > 0) {
    // Find the least recently used entry.
    let lru: PreviewEntry | null = null;
    for (const e of entries.values()) {
      if (!lru || e.lastUsed < lru.lastUsed) lru = e;
    }
    if (!lru) break;
    entries.delete(lru.attachmentId);
    totalBytes -= lru.bytes;
    revoke(lru);
  }
}

export const imagePreviewCache = {
  get(attachmentId: string): string | undefined {
    const e = entries.get(attachmentId);
    if (e) {
      e.lastUsed = Date.now();
      return e.url;
    }
    return undefined;
  },
  set(attachmentId: string, url: string, bytes: number): void {
    const existing = entries.get(attachmentId);
    if (existing) {
      // Same attachment re-decoded: revoke the old URL, keep budget sane.
      revoke(existing);
      totalBytes -= existing.bytes;
    }
    entries.set(attachmentId, { attachmentId, url, bytes, lastUsed: Date.now() });
    totalBytes += bytes;
    evictIfNeeded();
  },
  has(attachmentId: string): boolean {
    return entries.has(attachmentId);
  },
  delete(attachmentId: string): void {
    const e = entries.get(attachmentId);
    if (e) {
      entries.delete(attachmentId);
      totalBytes -= e.bytes;
      revoke(e);
    }
  },
  clear(): void {
    for (const e of entries.values()) revoke(e);
    entries.clear();
    totalBytes = 0;
  },
  size(): number {
    return entries.size;
  },
  /** test/diagnostics helper */
  byteCount(): number {
    return totalBytes;
  },
};

// Also touch on read (kept separate from get for clarity).
export { touch };
