import { useUIStore } from '../../stores/ui';
import { useRealtimeStore } from '../../stores/realtime';
import { useSearchStore } from '../../stores/search';
import { useIsMobile } from '../../hooks/useIsMobile';
import { TopbarSearch } from '../search/TopbarSearch';
import { ArrowLeft, Search } from 'lucide-react';
import styles from './ChatHeader.module.scss';

export function ChatHeader() {
  const { status } = useRealtimeStore();
  const setMobileChatOpen = useUIStore((s) => s.setMobileChatOpen);
  const searchOpen = useSearchStore((s) => s.open);
  const setSearchOpen = useSearchStore((s) => s.setOpen);
  const isMobile = useIsMobile();
  const subtitle = status === 'connected' ? 'file transfer assistant' : 'Connecting...';

  if (searchOpen) {
    return (
      <div className={styles.header}>
        <TopbarSearch />
      </div>
    );
  }

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        {isMobile && (
          <button
            className={styles.iconBtn}
            onClick={() => setMobileChatOpen(false)}
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
        )}
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
      </div>
      <button
        className={styles.iconBtn}
        onClick={() => setSearchOpen(true)}
        aria-label="Search"
      >
        <Search size={20} />
      </button>
    </div>
  );
}