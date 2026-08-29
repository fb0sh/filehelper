import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../api';
import { formatMessageTime } from '../../lib/dates';
import styles from './Sidebar.module.scss';
import { Menu, Search as SearchIcon, HardDrive, Palette, Info, Lock, Check } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useAuthStore } from '../../stores/auth';
import { useIsMobile } from '../../hooks/useIsMobile';

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const setMobileChatOpen = useUIStore((s) => s.setMobileChatOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const { logout } = useAuthStore();
  const isMobile = useIsMobile();

  const { data } = useQuery({
    queryKey: messageKeys.latest,
    queryFn: () => messagesApi.list(undefined, 1),
    refetchInterval: 30000,
  });

  const lastMessage = data?.messages?.[0];

  const menuItems = [
    { icon: <HardDrive size={20} />, label: 'Storage', onClick: () => openSettings('storage') },
    { icon: <Palette size={20} />, label: 'Appearance', onClick: () => openSettings('appearance') },
    { icon: <Info size={20} />, label: 'About', onClick: () => openSettings('about') },
  ];

  // Sidebar search filters chats (only "FileHelper" exists) — it does not
  // search message content; message search lives in the Chat header.
  const trimmed = searchQuery.trim().toLowerCase();
  const chatVisible = trimmed === '' || 'filehelper'.includes(trimmed);

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
        <div className={styles.searchBar}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search"
            className={styles.searchInput}
            aria-label="Search chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.chatList}>
        {chatVisible ? (
          <div
            className={`${styles.chatRow} ${styles.selected}`}
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
            <Check size={16} className={styles.selectedMark} />
          </div>
        ) : (
          <div className={styles.noChats}>No chats found</div>
        )}
      </div>

      {menuOpen && (
        <>
          <div className={styles.overlay} onClick={() => setMenuOpen(false)} />
          <div className={styles.menu} role="menu">
            {menuItems.map((item) => (
              <button
                key={item.label}
                className={styles.menuItem}
                onClick={() => { setMenuOpen(false); item.onClick(); }}
                role="menuitem"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
            <div className={styles.menuDivider} />
            <button
              className={styles.menuItem}
              onClick={() => { setMenuOpen(false); logout(); }}
              role="menuitem"
            >
              <Lock size={20} />
              <span>Lock</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}