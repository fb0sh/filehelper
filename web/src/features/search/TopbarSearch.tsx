import { useEffect, useRef, useState } from 'react';
import { messagesApi } from '../../api';
import { useSearchStore } from '../../stores/search';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { decryptedCache } from '../../lib/decryptedCache';
import { decryptEncryptedMessage } from '../../lib/crypto/messages';
import { loadCryptoSession } from '../../lib/crypto/session';
import { searchMessages } from '../../lib/clientSearch';
import type { DecryptedMessage } from '../../lib/crypto/messages';
import { ArrowLeft, Search as SearchIcon, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import styles from './TopbarSearch.module.scss';

const HISTORY_PAGE = 500;

// Telegram Web K topbar search, now fully client-side: the server stores
// only ciphertext, so matching happens over decrypted in-memory messages.
// History is backfilled in large pages in the background; ↑ walks toward
// older matches, ↓ toward newer. The search never closes after a jump.
export function TopbarSearch() {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setOpen = useSearchStore((s) => s.setOpen);
  const requestJump = useSearchStore((s) => s.requestJump);
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(0);
  const [searchingHistory, setSearchingHistory] = useState(false);

  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  // Background history backfill: fetch encrypted pages of 500, decrypt
  // into the shared cache. No attachment ciphertext is downloaded.
  useEffect(() => {
    if (!debouncedQuery) return;
    let cancelled = false;
    const session = loadCryptoSession();
    if (!session) return;

    (async () => {
      setSearchingHistory(true);
      let cursor: string | undefined;
      for (let page = 0; page < 200; page++) {
        if (cancelled) return;
        try {
          const res = await messagesApi.list(cursor, HISTORY_PAGE);
          let added = 0;
          for (const record of res.messages) {
            if (decryptedCache.has(record.id)) continue;
            const outcome = decryptEncryptedMessage(
              session.messageKey,
              session.spaceId,
              record
            );
            if (outcome.ok) {
              decryptedCache.set(outcome.message);
              added += 1;
            }
          }
          if (!res.nextCursor || added === 0) break;
          cursor = res.nextCursor;
        } catch {
          break; // stop backfilling on any error; search what we have
        }
      }
      if (!cancelled) setSearchingHistory(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Re-run matching over whatever is currently decrypted.
  const results: DecryptedMessage[] = searchMessages(decryptedCache.all(), debouncedQuery);

  useEffect(() => {
    setIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    if (results.length > 0 && index >= results.length) {
      setIndex(results.length - 1);
    }
  }, [results.length, index]);

  const goOlder = () => {
    if (index + 1 >= results.length) return;
    const next = index + 1;
    setIndex(next);
    requestJump(results[next]);
  };

  const goNewer = () => {
    if (index - 1 < 0) return;
    const next = index - 1;
    setIndex(next);
    requestJump(results[next]);
  };

  const close = () => setOpen(false);

  return (
    <div className={styles.search}>
      <button className={styles.iconBtn} onClick={close} aria-label="Back">
        <ArrowLeft size={20} />
      </button>
      <SearchIcon size={16} className={styles.searchIcon} />
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Search messages..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'ArrowUp') { e.preventDefault(); goOlder(); }
          if (e.key === 'ArrowDown') { e.preventDefault(); goNewer(); }
        }}
        autoFocus
      />
      {debouncedQuery && (
        <div className={styles.counter}>
          {searchingHistory ? (
            <span className={styles.historyHint}>
              <Loader2 size={13} className={styles.spinner} /> Searching history…
            </span>
          ) : results.length > 0 ? (
            `${index + 1} of ${results.length}`
          ) : (
            'No results'
          )}
        </div>
      )}
      <button
        className={styles.iconBtn}
        onClick={goNewer}
        disabled={index <= 0 || results.length === 0}
        aria-label="Newer match"
      >
        <ChevronDown size={18} />
      </button>
      <button
        className={styles.iconBtn}
        onClick={goOlder}
        disabled={index + 1 >= results.length || results.length === 0}
        aria-label="Older match"
      >
        <ChevronUp size={18} />
      </button>
      <button className={styles.iconBtn} onClick={close} aria-label="Close search">
        <X size={18} />
      </button>
    </div>
  );
}
