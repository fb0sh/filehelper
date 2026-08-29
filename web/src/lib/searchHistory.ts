// Background history loader for client-side search.
//
// A single per-tab loop walks the encrypted history from the newest
// message toward the oldest in pages of HISTORY_PAGE, decrypting message
// envelopes into the shared decryptedCache (NEVER attachment ciphertext).
//
// Correctness rules this loader must obey:
//  - The only terminal conditions are `nextCursor == null` (history end)
//    and cursor-loop detection. "This page added 0 new messages" is NOT a
//    terminal condition — a fully-cached page still has older history.
//  - Query changes must not restart the loop; the loader is decoupled
//    from the query and simply keeps filling the cache.
//  - Closing the search cancels the in-flight loop but preserves
//    nextCursor/fullyLoaded, so the next search resumes where it stopped.

import { messagesApi } from '../api';
import { decryptedCache } from './decryptedCache';
import { decryptEncryptedMessage } from './crypto/messages';
import { loadCryptoSession } from './crypto/session';

const HISTORY_PAGE = 500;
const MAX_PAGES = 200; // 100k messages of in-memory search index, safety cap

interface LoaderState {
  spaceId: string | null;
  nextCursor: string | null;
  fullyLoaded: boolean;
  loading: boolean;
  seenCursors: Set<string>;
  page: number;
}

let state: LoaderState = {
  spaceId: null,
  nextCursor: null,
  fullyLoaded: false,
  loading: false,
  seenCursors: new Set(),
  page: 0,
};

let loopSeq = 0;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const l of listeners) l();
}

function bindToSpace(spaceId: string): void {
  if (state.spaceId === spaceId) return;
  state = {
    spaceId,
    nextCursor: null,
    fullyLoaded: false,
    loading: false,
    seenCursors: new Set(),
    page: 0,
  };
  notify();
}

/** Start (or resume) the backfill for the current crypto session's space.
 * No-op when already running or fully loaded. Safe to call on every
 * search open / query change. */
export function startHistorySearch(): void {
  const session = loadCryptoSession();
  if (!session) return;
  bindToSpace(session.spaceId);
  if (state.fullyLoaded || state.loading) return;

  state.loading = true;
  const id = ++loopSeq;
  void runLoop(session.spaceId, session.messageKey, id);
  notify();
}

/** Cancel the in-flight loop (search closed). Cursor state is preserved so
 * the next startHistorySearch resumes from where we stopped. */
export function cancelHistorySearch(): void {
  loopSeq += 1; // invalidate any in-flight loop
  if (!state.loading) return;
  state.loading = false;
  notify();
}

/** Full reset (lock, clear space, code switch). Next search restarts from
 * the newest message. */
export function resetHistoryLoader(): void {
  loopSeq += 1;
  state = {
    spaceId: null,
    nextCursor: null,
    fullyLoaded: false,
    loading: false,
    seenCursors: new Set(),
    page: 0,
  };
  notify();
}

/** External-store API for the counter UI (loading spinner, "No results"). */
export function subscribeHistoryLoader(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHistoryLoaderVersion(): number {
  return version;
}

export function isHistoryLoading(): boolean {
  return state.loading;
}

export function isHistoryFullyLoaded(): boolean {
  return state.fullyLoaded;
}

async function runLoop(
  spaceId: string,
  messageKey: string,
  id: number
): Promise<void> {
  try {
    for (; state.page < MAX_PAGES; state.page++) {
      if (id !== loopSeq || state.spaceId !== spaceId) return; // cancelled, superseded, or space switched

      const res = await messagesApi.list(state.nextCursor ?? undefined, HISTORY_PAGE);

      const fresh: import('./crypto/messages').DecryptedMessage[] = [];
      for (const record of res.messages) {
        if (decryptedCache.has(record.id)) continue;
        const outcome = decryptEncryptedMessage(messageKey, spaceId, record);
        if (outcome.ok) fresh.push(outcome.message);
      }
      // One version bump per page → the search results update live,
      // once per page, without a full-scan churn per message.
      decryptedCache.setMany(fresh);

      if (!res.nextCursor) {
        state.fullyLoaded = true;
        break;
      }
      if (state.seenCursors.has(res.nextCursor)) {
        // Server/cursor bug guard: the same cursor again means we would
        // loop forever. Stop and search what we have.
        console.warn('[search] pagination cursor loop detected; stopping history backfill');
        state.fullyLoaded = true;
        break;
      }
      state.seenCursors.add(res.nextCursor);
      state.nextCursor = res.nextCursor;
    }
    if (state.page >= MAX_PAGES) {
      state.fullyLoaded = true; // safety cap reached; treat as complete
    }
  } catch {
    // Stop backfilling on any error (offline / 401 / server hiccup);
    // search whatever is already decrypted.
  } finally {
    if (id === loopSeq) {
      state.loading = false;
      notify();
    }
  }
}
