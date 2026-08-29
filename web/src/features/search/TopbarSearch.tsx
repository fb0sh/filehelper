import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi, searchKeys, Message } from '../../api';
import { useSearchStore } from '../../stores/search';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ArrowLeft, Search as SearchIcon, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import styles from './TopbarSearch.module.scss';

// Telegram Web K topbar search: the chat header turns into a search
// field with a result counter and previous/next navigation. Results are
// newest-first; ↑ walks toward older matches, ↓ toward newer.
export function TopbarSearch() {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setOpen = useSearchStore((s) => s.setOpen);
  const requestJump = useSearchStore((s) => s.requestJump);
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(0);

  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  const { data, isFetching } = useQuery({
    queryKey: searchKeys.results(debouncedQuery),
    queryFn: () => searchApi.search(debouncedQuery, 50),
    enabled: debouncedQuery.length > 0,
    staleTime: 10000,
  });

  const results: Message[] = data?.results ?? [];

  // New query → start at the newest match; clamp index when results shrink.
  useEffect(() => {
    setIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    if (index >= results.length && results.length > 0) {
      setIndex(results.length - 1);
    }
  }, [results.length, index]);

  // Navigate: ↑ = older match, ↓ = newer match.
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
          {isFetching ? (
            <Loader2 size={14} className={styles.spinner} />
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