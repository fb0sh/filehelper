import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi, Message } from '../../api';
import { useUIStore } from '../../stores/ui';
import { X, Search as SearchIcon } from 'lucide-react';
import { formatMessageTime } from '../../lib/dates';
import styles from './SearchPanel.module.scss';

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const { searchOpen, setSearchOpen } = useUIStore();
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const { data } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchApi.search(debouncedQuery),
    enabled: debouncedQuery.length > 0,
  });

  const handleChange = (value: string) => {
    setQuery(value);
    const timer = setTimeout(() => setDebouncedQuery(value), 300);
    return () => clearTimeout(timer);
  };

  if (!searchOpen) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <SearchIcon size={18} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.input}
          placeholder="Search messages..."
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          autoFocus
        />
        <button className={styles.closeBtn} onClick={() => setSearchOpen(false)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className={styles.results}>
        {data?.results.map((msg: Message) => (
          <div key={msg.id} className={styles.resultItem}>
            <div className={styles.resultText}>{msg.text || msg.attachment?.filename}</div>
            <div className={styles.resultTime}>{formatMessageTime(msg.createdAt)}</div>
          </div>
        ))}
        {debouncedQuery && data?.results.length === 0 && (
          <div className={styles.empty}>No results found</div>
        )}
      </div>
    </div>
  );
}