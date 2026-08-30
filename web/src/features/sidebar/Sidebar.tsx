import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../api';
import { formatMessageTime } from '../../lib/dates';
import { decryptEncryptedMessage } from '../../lib/crypto/messages';
import { loadCryptoSession } from '../../lib/crypto/session';
import type { DecryptedMessage } from '../../lib/crypto/messages';
import styles from './Sidebar.module.scss';
import { Menu, Search as SearchIcon, HardDrive, Palette, Info, Lock, Check, Pencil } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useAuthStore } from '../../stores/auth';
import { useIsMobile } from '../../hooks/useIsMobile';

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'personal' | 'unread'>('all');
  const [lastDecrypted, setLastDecrypted] = useState<DecryptedMessage | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
  // The space has content only when the latest-message query returns
  // something; after Clear All Data it is empty, so the group counts
  // must drop to zero (and the badge hide) instead of staying "1".
  const hasMessages = (data?.messages?.length ?? 0) > 0;
  // Telegram-style filter chips: All / Personal / Unread. The single chat
  // is a personal space, so Personal matches All; Unread stays empty (no
  // unread tracking exists) and shows the empty state honestly.
  const chatCount = chatVisible && hasMessages ? 1 : 0;
  const showChat = chatVisible && filter !== 'unread';
  const chips: { key: 'all' | 'personal' | 'unread'; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: chatCount },
    { key: 'personal', label: 'Personal', count: chatCount },
    { key: 'unread', label: 'Unread', count: 0 },
  ];

  const preview =
    lastDecrypted?.text ??
    lastDecrypted?.attachment?.filename ??
    (hasMessages ? 'end-to-end encrypted' : '');

  return (
    <div className={styles.sidebar} data-tg="sidebar">
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
            ref={searchRef}
            type="text"
            placeholder="Search"
            className={styles.searchInput}
            aria-label="Search chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.chips} role="tablist" aria-label="Chat filters">
        {chips.map((chip) => (
          <button
            key={chip.key}
            role="tab"
            aria-selected={filter === chip.key}
            className={`${styles.chip} ${filter === chip.key ? styles.chipActive : ''}`}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
            {chip.count > 0 && (
              <span className={`${styles.chipCount} ${filter === chip.key ? styles.chipCountActive : ''}`}>
                {chip.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.chatList}>
        {showChat ? (
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

      {/* Telegram-style FAB: single-chat "new message" affordance — focuses
          the search so a chat can be found; real, not decorative. */}
      {!isMobile && (
        <button
          className={styles.fab}
          onClick={() => { searchRef.current?.focus(); searchRef.current?.select(); }}
          aria-label="New chat"
          title="New chat"
        >
          <Pencil size={22} />
        </button>
      )}

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
