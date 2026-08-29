import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptMessagePayload } from '../lib/crypto/messages';
import { bytesToBase64url } from '../lib/crypto/encoding';
import { decryptedCache } from '../lib/decryptedCache';
import { searchMessages } from '../lib/clientSearch';
import {
  startHistorySearch,
  cancelHistorySearch,
  resetHistoryLoader,
  isHistoryLoading,
  isHistoryFullyLoaded,
} from '../lib/searchHistory';
import type { EncryptedMessage } from '../api';
import type { DecryptedMessage } from '../lib/crypto/messages';
import type { CryptoSession } from '../lib/crypto/session';

// The loader decrypts real envelopes, so build real encrypted records.
const messageKey = bytesToBase64url(new Uint8Array(32).fill(7));
const spaceId = 'search-history-test-space';

function makeRecord(id: string, text: string, createdAt: string, withAttachment = false): EncryptedMessage {
  return {
    id,
    payload: encryptMessagePayload(messageKey, spaceId, { type: 'text', text }),
    createdAt,
    attachment: withAttachment
      ? { id: `att-${id}`, ciphertextSize: 100, downloadUrl: `/api/v1/files/att-${id}/download` }
      : null,
  };
}

function decrypted(id: string, text: string, createdAt: string): DecryptedMessage {
  return { id, type: 'text', text, createdAt };
}

interface Page {
  messages: EncryptedMessage[];
  nextCursor: string | null;
}

const { loadSessionMock } = vi.hoisted(() => ({ loadSessionMock: vi.fn() }));
vi.mock('../lib/crypto/session', () => ({ loadCryptoSession: () => loadSessionMock() }));

function fakeSession(): CryptoSession {
  return {
    instanceId: 'instance-test',
    spaceId,
    authKey: 'A'.repeat(43),
    messageKey,
    fileMasterKey: 'B'.repeat(43),
  };
}

/** Stub fetch to serve pages in order. Records URLs for assertions. */
function stubPages(pages: Page[]) {
  const urls: string[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      const page = pages[Math.min(i, pages.length - 1)];
      i += 1;
      return { ok: true, status: 200, json: async () => page };
    })
  );
  return urls;
}

function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timed out'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('history search loader', () => {
  beforeEach(() => {
    decryptedCache.clear();
    resetHistoryLoader();
    loadSessionMock.mockReturnValue(fakeSession());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    loadSessionMock.mockReset();
  });

  it('backfills until nextCursor is null and marks the history fully loaded', async () => {
    const recs1 = Array.from({ length: 500 }, (_, i) =>
      makeRecord(`p1-${i}`, `common fill ${i}`, `2026-01-01T00:00:00.${String(i).padStart(3, '0')}Z`)
    );
    const recs2 = [makeRecord('target', 'DEEP_TARGET', '2025-12-01T00:00:00.000Z')];
    const urls = stubPages([
      { messages: recs1, nextCursor: 'c2' },
      { messages: recs2, nextCursor: null },
    ]);

    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());
    await waitUntil(() => isHistoryFullyLoaded());

    expect(decryptedCache.size()).toBe(501);
    expect(decryptedCache.get('target')?.text).toBe('DEEP_TARGET');
    // Two pages fetched, cursor advanced once.
    expect(urls.length).toBe(2);
  });

  it('REGRESSION: a fully-cached page (added === 0) does NOT stop pagination', async () => {
    // The 500 newest messages are already decrypted in the cache...
    const cached = Array.from({ length: 500 }, (_, i) =>
      decrypted(`p1-${i}`, `common fill ${i}`, `2026-01-01T00:00:00.${String(i).padStart(3, '0')}Z`)
    );
    decryptedCache.setMany(cached);

    // ...but there IS older history with the target message.
    const target = makeRecord('target', 'CACHED_PAGE_REGRESSION_TARGET', '2025-12-01T00:00:00.000Z');
    const urls = stubPages([
      {
        messages: Array.from({ length: 500 }, (_, i) => ({
          id: `p1-${i}`,
          payload: 'FH1.ignored', // never decrypted: already cached
          createdAt: `2026-01-01T00:00:00.${String(i).padStart(3, '0')}Z`,
          attachment: null,
        })),
        nextCursor: 'c2',
      },
      { messages: [target], nextCursor: null },
    ]);

    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());

    // The old implementation would break here on added === 0 and never
    // fetch page 2 — the target would be unfindable.
    expect(urls.length).toBe(2);
    expect(decryptedCache.has('target')).toBe(true);
    const results = searchMessages(decryptedCache.all(), 'CACHED_PAGE_REGRESSION_TARGET');
    expect(results.map((r) => r.id)).toEqual(['target']);
  });

  it('results grow live: one cache version bump per page (not per message)', async () => {
    const page1 = [
      makeRecord('m1', 'needle one', '2026-01-03T00:00:00.000Z'),
      makeRecord('m2', 'needle two', '2026-01-02T00:00:00.000Z'),
    ];
    const page2 = [
      makeRecord('m3', 'needle three', '2026-01-01T00:00:00.000Z'),
      makeRecord('m4', 'needle four', '2025-12-31T00:00:00.000Z'),
      makeRecord('m5', 'needle five', '2025-12-30T00:00:00.000Z'),
    ];
    stubPages([
      { messages: page1, nextCursor: 'c2' },
      { messages: page2, nextCursor: null },
    ]);

    // Subscribe to the cache version to count per-page decrypted updates.
    const cacheBumps: number[] = [];
    const unsubCache = subscribeCacheVersion(cacheBumps);

    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());

    // After both pages: 5 matches, newest first.
    const results = searchMessages(decryptedCache.all(), 'needle');
    expect(results.map((r) => r.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    // Two page insertions → 2 cache version bumps (never 500 per-message).
    expect(cacheBumps.length).toBe(2);
    unsubCache();
  });

  it('detects a pagination cursor loop and stops with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubPages([
      { messages: [makeRecord('a', 'loop fill', '2026-01-01T00:00:00.000Z')], nextCursor: 'loop' },
      { messages: [makeRecord('b', 'loop fill 2', '2026-01-02T00:00:00.000Z')], nextCursor: 'loop' },
    ]);

    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());

    expect(isHistoryFullyLoaded()).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('cursor loop')
    );
    warn.mockRestore();
  });

  it('cancel preserves the cursor; the next search resumes where it stopped', async () => {
    let resolvePage1: (p: Page) => void = () => {};
    const page1Gate = new Promise<Page>((r) => (resolvePage1 = r));
    let page2Fetched = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (!u.includes('before=')) {
          return { ok: true, status: 200, json: async () => page1Gate };
        }
        page2Fetched = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [makeRecord('target', 'RESUME_TARGET', '2025-12-01T00:00:00.000Z')], nextCursor: null }),
        };
      })
    );

    startHistorySearch();
    // Page 1 in flight → cancel (search closed).
    await waitUntil(() => isHistoryLoading());
    cancelHistorySearch();
    resolvePage1({ messages: [makeRecord('r1', 'cancelled page', '2026-01-02T00:00:00.000Z')], nextCursor: 'c2' });
    await waitUntil(() => decryptedCache.has('r1'));

    // Reopen search → resumes from c2, finds the older target.
    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());
    expect(page2Fetched).toBe(true);
    expect(decryptedCache.has('target')).toBe(true);
  });

  it('starting while loading is a no-op (no duplicate loops)', async () => {
    let resolvePage1: (p: Page) => void = () => {};
    const page1Gate = new Promise<Page>((r) => (resolvePage1 = r));
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => page1Gate };
      })
    );

    startHistorySearch();
    await waitUntil(() => isHistoryLoading());
    startHistorySearch(); // duplicate start must not spawn a second loop
    startHistorySearch();
    resolvePage1({ messages: [makeRecord('x', 'x', '2026-01-01T00:00:00.000Z')], nextCursor: null });
    await waitUntil(() => !isHistoryLoading());

    expect(calls).toBe(1);
  });

  it('reset clears progress so the next search restarts from newest', async () => {
    const urls = stubPages([
      { messages: [makeRecord('a', 'first run', '2026-01-02T00:00:00.000Z')], nextCursor: null },
      { messages: [makeRecord('b', 'second run', '2026-01-03T00:00:00.000Z')], nextCursor: null },
    ]);

    startHistorySearch();
    await waitUntil(() => isHistoryFullyLoaded());
    expect(urls.length).toBe(1);

    resetHistoryLoader();
    expect(isHistoryFullyLoaded()).toBe(false);
    expect(isHistoryLoading()).toBe(false);

    startHistorySearch();
    await waitUntil(() => isHistoryFullyLoaded());
    // Refetched from the newest message (no before= cursor).
    expect(urls.length).toBe(2);
  });

  it('never downloads attachment ciphertext (only the message list)', async () => {
    const recs = [makeRecord('f', 'file-ish text', '2026-01-01T00:00:00.000Z', true)];
    const urls = stubPages([{ messages: recs, nextCursor: null }]);

    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());
    expect(decryptedCache.has('f')).toBe(true);
    expect(urls.some((u) => u.includes('/download'))).toBe(false);
  });

  it('stops on a fetch error and searches what it has', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL' } }) }))
    );
    startHistorySearch();
    await waitUntil(() => !isHistoryLoading());
    expect(decryptedCache.size()).toBe(0);
  });
});

/** Count cache version notifications (each = one results recompute trigger). */
function subscribeCacheVersion(record: number[]): () => void {
  let last = -1;
  return decryptedCache.subscribe(() => {
    const v = decryptedCache.getVersion();
    if (v !== last) {
      last = v;
      record.push(v);
    }
  });
}
