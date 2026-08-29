import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../api';
import { formatMessageTime } from '../../lib/dates';
import { decryptEncryptedMessage } from '../../lib/crypto/messages';
import { loadCryptoSession } from '../../lib/crypto/session';
import type { DecryptedMessage } from '../../lib/crypto/messages';
import styles from './Sidebar.module.scss';
import { Menu, Search as SearchIcon, HardDrive, Palette, Info, Lock, Check } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useAuthStore } from '../../stores/auth';
import { useIsMobile } from '../../hooks/useIsMobile';

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastDecrypted, setLastDecrypted] = useState<DecryptedMessage | null>(null);
  const setMobileChatOpen = useUIStore((s) => s.setMobileChatOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const { lock } = useAuthStore();
  const isMobile = useIsMobile();

  const { data } = useQuery({
    queryKey: messageKeys.latest,
    queryFn: () => messagesApi.list(undefined, 1),
    refetchInterval: 30000,
  });

  // Decrypt the newest message for the chat-row preview (server only
  // stores ciphertext).
  useEffect(() => {
    const record = data?.messages?.[0];
    if (!record) {
      setLastDecrypted(null);
      return;
    }
    const session = loadCryptoSession();
    if (!session) return;
    const outcome = decryptEncryptedMessage(session.messageKey, session.spaceId, record);
    if (outcome.ok) setLastDecrypted(outcome.message);
  }, [data]);

  const menuItems = [
    { icon: <HardDrive size={20} />, label: 'Storage', onClick: () => openSettings('storage') },
    { icon: <Palette size={20} />, label: 'Appearance', onClick: () => openSettings('appearance') },
    { icon: <Info size={20} />, label: 'About', onClick: () => openSettings('about') },
  ];

  const trimmed = searchQuery.trim().toLowerCase();
  const chatVisible = trimmed === '' || 'filehelper'.includes(trimmed);

  const preview =
    lastDecrypted?.text ??
    lastDecrypted?.attachment?.filename ??
    'end-to-end encrypted';

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
                {lastDecrypted && (
                  <span className={styles.chatTime}>{formatMessageTime(lastDecrypted.createdAt)}</span>
                )}
              </div>
              <div className={styles.chatPreview}>{preview}</div>
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
              onClick={() => { setMenuOpen(false); void lock(); }}
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
