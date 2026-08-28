import { useUIStore } from '../../stores/ui';
import { useRealtimeStore } from '../../stores/realtime';
import { ArrowLeft, Search, MoreVertical } from 'lucide-react';
import styles from './ChatHeader.module.scss';
import { useState } from 'react';

export function ChatHeader() {
  const { setMobileChatOpen, setSearchOpen } = useUIStore();
  const { status } = useRealtimeStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const subtitle = status === 'disconnected' ? 'Connecting...' : 'file transfer assistant';

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        {isMobile && (
          <button className={styles.iconBtn} onClick={() => setMobileChatOpen(false)} aria-label="Back">
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
      <div className={styles.right}>
        <button className={styles.iconBtn} onClick={() => setSearchOpen(true)} aria-label="Search">
          <Search size={20} />
        </button>
        <button className={styles.iconBtn} onClick={() => setMenuOpen(!menuOpen)} aria-label="More">
          <MoreVertical size={20} />
        </button>
        {menuOpen && (
          <>
            <div className={styles.overlay} onClick={() => setMenuOpen(false)} />
            <div className={styles.menu}>
              <button className={styles.menuItem} onClick={() => setMenuOpen(false)}>Clear history</button>
              <button className={styles.menuItem} onClick={() => setMenuOpen(false)}>Export chat</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}