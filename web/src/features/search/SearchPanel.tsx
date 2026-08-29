import { useQuery } from '@tanstack/react-query';
import { searchApi, searchKeys } from '../../api';
import { useSearchStore } from '../../stores/search';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useIsMobile } from '../../hooks/useIsMobile';
import { X, Search as SearchIcon } from 'lucide-react';
import { formatMessageTime } from '../../lib/dates';
import styles from './SearchPanel.module.scss';

export function SearchPanel() {
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setOpen = useSearchStore((s) => s.setOpen);
  const requestJump = useSearchStore((s) => s.requestJump);
  const isMobile = useIsMobile();

  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  const { data, isFetching } = useQuery({
    queryKey: searchKeys.results(debouncedQuery),
    queryFn: () => searchApi.search(debouncedQuery, 50),
    enabled: debouncedQuery.length > 0,
    staleTime: 10000,
  });

  if (!open) return null;

  const results = data?.results ?? [];

  return (
    <div className={isMobile ? styles.overlay : styles.panel}>
      <div className={styles.header}>
        <SearchIcon size={18} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.input}
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          autoFocus
        />
        <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className={styles.results}>
        {debouncedQuery && isFetching && (
          <div className={styles.empty}>Searching...</div>
        )}
        {results.map((msg) => (
          <button
            key={msg.id}
            className={styles.resultItem}
            onClick={() => {
              setOpen(false);
              requestJump(msg);
            }}
          >
            <div className={styles.resultText}>
              {msg.text || msg.attachment?.filename || 'File'}
            </div>
            <div className={styles.resultTime}>{formatMessageTime(msg.createdAt)}</div>
          </button>
        ))}
        {debouncedQuery && !isFetching && results.length === 0 && (
          <div className={styles.empty}>No results found</div>
        )}
      </div>
    </div>
  );
}