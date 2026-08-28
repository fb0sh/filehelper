import { useUIStore } from '../../stores/ui';
import { useQuery } from '@tanstack/react-query';
import { messagesApi } from '../../api';
import { formatMessageTime } from '../../lib/dates';
import styles from './Sidebar.module.scss';
import { Menu, X, Search as SearchIcon, Settings, Database, Sun, Moon, Info, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '../../stores/auth';

export function Sidebar() {
  const { toggleSidebar, setMobileChatOpen } = useUIStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const { logout } = useAuthStore();

  const { data } = useQuery({
    queryKey: ['messages'],
    queryFn: () => messagesApi.list(undefined, 1),
    refetchInterval: 30000,
  });

  const lastMessage = data?.messages?.[0];

  const handleChatClick = () => {
    setMobileChatOpen(true);
  };

  const menuItems = [
    { icon: <Info size={20} />, label: 'FileHelper', onClick: () => setMenuOpen(false) },
    { icon: <Database size={20} />, label: 'Storage', onClick: () => setMenuOpen(false) },
    { icon: <Sun size={20} />, label: 'Appearance', onClick: () => setMenuOpen(false) },
    { icon: <Info size={20} />, label: 'About', onClick: () => setMenuOpen(false) },
    { icon: <LogOut size={20} />, label: 'Logout', onClick: () => { logout(); setMenuOpen(false); } },
  ];

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <button className={styles.iconBtn} onClick={toggleSidebar} aria-label="Menu">
          <Menu size={22} />
        </button>
        <div className={styles.searchBar}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input type="text" placeholder="Search" className={styles.searchInput} />
        </div>
      </div>

      <div className={styles.chatList}>
        <div className={styles.chatRow} onClick={handleChatClick}>
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
          <div className={styles.menu}>
            {menuItems.map((item, i) => (
              <button key={i} className={styles.menuItem} onClick={item.onClick}>
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}