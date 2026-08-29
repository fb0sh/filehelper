import { useEffect, useRef, useState } from 'react';
import { useRealtimeStore } from '../../stores/realtime';
import { Search } from 'lucide-react';
import { searchApi, messagesApi, Message } from '../../api';
import { formatMessageTime } from '../../lib/dates';
import styles from './ChatHeader.module.scss';

interface Props {
  onJumpToMessage: (message: Message) => void;
}

export function ChatHeader({ onJumpToMessage }: Props) {
  const { status } = useRealtimeStore();
  const subtitle = status === 'disconnected' ? 'Connecting...' : 'file transfer assistant';

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      setQuery('');
      setResults([]);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || query.trim().length === 0) {
      setResults([]);
      return;
    }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchApi.search(query.trim(), 20);
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchOpen]);

  const handleJump = async (msg: Message) => {
    try {
      // Fetch full message to ensure we have it, then jump
      const full = await messagesApi.get(msg.id);
      setSearchOpen(false);
      onJumpToMessage(full);
    } catch {
      setSearchOpen(false);
      onJumpToMessage(msg);
    }
  };

  return (
    <div className={styles.header}>
      {searchOpen ? (
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            placeholder="Search messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchOpen(false);
            }}
          />
          <button className={styles.searchClose} onClick={() => setSearchOpen(false)} aria-label="Close search">
            ✕
          </button>
          {query.trim() && (
            <div className={styles.searchResults}>
              {searching && <div className={styles.searchEmpty}>Searching...</div>}
              {!searching && results.length === 0 && (
                <div className={styles.searchEmpty}>No results</div>
              )}
              {results.map((msg) => (
                <button key={msg.id} className={styles.searchResult} onClick={() => handleJump(msg)}>
                  <div className={styles.searchResultText}>
                    {msg.text || msg.attachment?.filename || 'File'}
                  </div>
                  <div className={styles.searchResultTime}>{formatMessageTime(msg.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={styles.avatar}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <div className={styles.info}>
            <div className={styles.name}>FileHelper</div>
            <div className={styles.subtitle}>{subtitle}</div>
          </div>
          <button className={styles.searchBtn} onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search size={18} />
          </button>
        </>
      )}
    </div>
  );
}