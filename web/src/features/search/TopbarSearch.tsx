import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSearchStore } from '../../stores/search';
import { useEffectiveSearchQuery } from '../../hooks/useEffectiveSearchQuery';
import { useDecryptedCacheVersion } from '../../hooks/useDecryptedCacheVersion';
import { decryptedCache } from '../../lib/decryptedCache';
import { searchMessages } from '../../lib/clientSearch';
import {
  startHistorySearch,
  subscribeHistoryLoader,
  getHistoryLoaderVersion,
  isHistoryLoading,
} from '../../lib/searchHistory';
import type { DecryptedMessage } from '../../lib/crypto/messages';
import { ArrowLeft, Search as SearchIcon, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import styles from './TopbarSearch.module.scss';

// Telegram Web K topbar search, fully client-side: the server stores only
// ciphertext, so matching happens over decrypted in-memory messages.
//
// Behavior contract:
//  - As soon as the debounced query has results, the NEWEST match becomes
//    the active result and the chat auto-jumps to it — the user never
//    sees "1 / N" while still parked somewhere unrelated.
//  - ↑ / Enter walk toward older matches, ↓ / Shift+Enter toward newer.
//  - Background history backfill keeps adding results live (counter +
//    spinner) without stealing the active result.
export function TopbarSearch() {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const activeResultId = useSearchStore((s) => s.activeResultId);
  const setActiveResultId = useSearchStore((s) => s.setActiveResultId);
  const requestJump = useSearchStore((s) => s.requestJump);
  const closeSearch = useSearchStore((s) => s.closeSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useEffectiveSearchQuery();
  const cacheVersion = useDecryptedCacheVersion();
  // Re-render whenever the loader toggles (page fetched / finished).
  useSyncExternalStore(subscribeHistoryLoader, getHistoryLoaderVersion);
  const historyLoading = isHistoryLoading();

  // Start (or resume) the history backfill when the search opens. The
  // loader is query-agnostic: typing a new query never restarts it.
  useEffect(() => {
    startHistorySearch();
  }, []);

  // Reactive results: recomputed only when the query or the cache changes.
  const results: DecryptedMessage[] = useMemo(() => {
    void cacheVersion; // reactive dependency: recompute when the cache mutates
    return searchMessages(decryptedCache.all(), debouncedQuery);
  }, [debouncedQuery, cacheVersion]);

  const activeIndex =
    activeResultId !== null ? results.findIndex((r) => r.id === activeResultId) : -1;
  // The auto-jump effect adopts results[0] within a frame; until then the
  // counter simply shows position 1 instead of a confusing 0 / N.
  const shownIndex = activeIndex >= 0 ? activeIndex : results.length > 0 ? 0 : -1;

  // Auto-jump: whenever the active result is missing (first search, query
  // change, active message deleted) and results exist, adopt the newest
  // match and jump to it. A valid active result is never disturbed by
  // results growing in the background or realtime inserts.
  useEffect(() => {
    if (!debouncedQuery || results.length === 0) {
      if (activeResultId !== null) setActiveResultId(null);
      return;
    }
    const stillValid = activeResultId !== null && results.some((r) => r.id === activeResultId);
    if (!stillValid) {
      const first = results[0];
      setActiveResultId(first.id);
      requestJump(first);
    }
  }, [debouncedQuery, results, activeResultId, requestJump, setActiveResultId]);

  const goOlder = () => {
    if (activeIndex < 0 || activeIndex + 1 >= results.length) return;
    const next = results[activeIndex + 1];
    setActiveResultId(next.id);
    requestJump(next);
  };

  const goNewer = () => {
    if (activeIndex <= 0) return;
    const next = results[activeIndex - 1];
    setActiveResultId(next.id);
    requestJump(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      return;
    }
    // IME composition (Chinese/Japanese/etc.): Enter commits the candidate
    // — it must never be treated as search navigation.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goNewer();
      else goOlder();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      goOlder();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      goNewer();
    }
  };

  const olderDisabled = activeIndex < 0 || activeIndex + 1 >= results.length;
  const newerDisabled = activeIndex <= 0;  return (
    <div className={styles.search}>
      <button className={styles.iconBtn} onClick={closeSearch} aria-label="Back">
        <ArrowLeft size={20} />
      </button>
      <SearchIcon size={16} className={styles.searchIcon} />
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Search messages..."
        aria-label="Search messages"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {debouncedQuery && (
        <div className={styles.counter} aria-live="polite">
          {results.length > 0 ? (
            <>
              <span className={styles.count}>
                {shownIndex + 1} / {results.length}
              </span>
              {historyLoading && <Loader2 size={12} className={styles.spinner} />}
            </>
          ) : historyLoading ? (
            <span className={styles.historyHint}>
              <Loader2 size={12} className={styles.spinner} /> Searching…
            </span>
          ) : (
            <span>No results</span>
          )}
        </div>
      )}
      <button
        className={styles.iconBtn}
        onClick={goNewer}
        disabled={newerDisabled}
        aria-label="Newer match"
      >
        <ChevronDown size={18} />
      </button>
      <button
        className={styles.iconBtn}
        onClick={goOlder}
        disabled={olderDisabled}
        aria-label="Older match"
      >
        <ChevronUp size={18} />
      </button>
      <button className={styles.iconBtn} onClick={closeSearch} aria-label="Close search">
        <X size={18} />
      </button>
    </div>
  );
}
