import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../api';
import { formatMessageTime } from '../../lib/dates';
import styles from './Sidebar.module.scss';
import { Menu, Search as SearchIcon, Monitor, Sun, Moon, LogOut, Check } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useSearchStore } from '../../stores/search';
import { useAuthStore } from '../../stores/auth';
import { useIsMobile } from '../../hooks/useIsMobile';

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const setMobileChatOpen = useUIStore((s) => s.setMobileChatOpen);
  const setSearchOpen = useSearchStore((s) => s.setOpen);
  const { logout } = useAuthStore();
  const isMobile = useIsMobile();

  const { data } = useQuery({
    queryKey: messageKeys.latest,
    queryFn: () => messagesApi.list(undefined, 1),
    refetchInterval: 30000,
  });

  const lastMessage = data?.messages?.[0];

  const themeItems = [
    { icon: <Monitor size={20} />, label: 'System theme', value: 'system' as const },
    { icon: <Sun size={20} />, label: 'Light theme', value: 'light' as const },
    { icon: <Moon size={20} />, label: 'Dark theme', value: 'dark' as const },
  ];

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <button
          className={styles.iconBtn}
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <div className={styles.searchBar} onClick={() => setSearchOpen(true)} role="button" tabIndex={0}
             onKeyDown={(e) => { if (e.key === 'Enter') setSearchOpen(true); }}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search"
            className={styles.searchInput}
            aria-label="Search messages"
            onFocus={() => setSearchOpen(true)}
          />
        </div>
      </div>

      <div className={styles.chatList}>
        <div
          className={styles.chatRow}
          onClick={() => { if (isMobile) setMobileChatOpen(true); }}
        >
          <div className={styles.avatar}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <div className={styles.chatInfo}>
            <div className={styles.chatTop}>
              <span className={styles.chatName}>FileHelper</span>
              {lastMessage && (
                <span className={styles.chatTime}>{formatMessageTime(lastMessage.createdAt)}</span>
              )}
            </div>
            <div className={styles.chatPreview}>
              {lastMessage?.text || lastMessage?.attachment?.filename || 'file transfer assistant'}
            </div>
          </div>
        </div>
      </div>

      {menuOpen && (
        <>
          <div className={styles.overlay} onClick={() => setMenuOpen(false)} />
          <div className={styles.menu} role="menu">
            {themeItems.map((item) => (
              <button
                key={item.value}
                className={styles.menuItem}
                onClick={() => setTheme(item.value)}
                role="menuitem"
              >
                {item.icon}
                <span>{item.label}</span>
                {theme === item.value && <Check size={16} className={styles.menuCheck} />}
              </button>
            ))}
            <div className={styles.menuDivider} />
            <button
              className={styles.menuItem}
              onClick={() => { setMenuOpen(false); logout(); }}
              role="menuitem"
            >
              <LogOut size={20} />
              <span>Log out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}