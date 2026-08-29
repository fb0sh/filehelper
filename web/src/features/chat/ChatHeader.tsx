import { useState } from 'react';
import { useUIStore } from '../../stores/ui';
import { useRealtimeStore } from '../../stores/realtime';
import { useSearchStore } from '../../stores/search';
import { useAuthStore } from '../../stores/auth';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ArrowLeft, Search, MoreVertical, HardDrive, Palette, Info, Lock } from 'lucide-react';
import styles from './ChatHeader.module.scss';

export function ChatHeader() {
  const { status } = useRealtimeStore();
  const setMobileChatOpen = useUIStore((s) => s.setMobileChatOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const setSearchOpen = useSearchStore((s) => s.setOpen);
  const logout = useAuthStore((s) => s.logout);
  const isMobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const subtitle = status === 'connected' ? 'file transfer assistant' : 'Connecting...';

  const moreItems = [
    { icon: <HardDrive size={18} />, label: 'Storage', onClick: () => openSettings('storage') },
    { icon: <Palette size={18} />, label: 'Appearance', onClick: () => openSettings('appearance') },
    { icon: <Info size={18} />, label: 'About', onClick: () => openSettings('about') },
  ];

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
      <div className={styles.right}>
        <button
          className={styles.iconBtn}
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
        >
          <Search size={20} />
        </button>
        <button
          className={styles.iconBtn}
          onClick={() => setMoreOpen(!moreOpen)}
          aria-label="More"
        >
          <MoreVertical size={20} />
        </button>
        {moreOpen && (
          <>
            <div className={styles.menuOverlay} onClick={() => setMoreOpen(false)} />
            <div className={styles.menu} role="menu">
              {moreItems.map((item) => (
                <button
                  key={item.label}
                  className={styles.menuItem}
                  onClick={() => { setMoreOpen(false); item.onClick(); }}
                  role="menuitem"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
              <div className={styles.menuDivider} />
              <button
                className={styles.menuItem}
                onClick={() => { setMoreOpen(false); logout(); }}
                role="menuitem"
              >
                <Lock size={18} />
                <span>Lock</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}