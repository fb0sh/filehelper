import { Sidebar } from './sidebar/Sidebar';
import { Chat } from './chat/Chat';
import { SearchPanel } from './search/SearchPanel';
import { useUIStore } from '../stores/ui';
import { useRealtimeStore } from '../stores/realtime';
import { useEffect } from 'react';
import { createWebSocket } from '../lib/websocket';
import { useQueryClient } from '@tanstack/react-query';
import { Message } from '../api';
import styles from './MainLayout.module.scss';

export function MainLayout() {
  const { sidebarOpen, mobileChatOpen, searchOpen } = useUIStore();
  const { setStatus } = useRealtimeStore();
  const queryClient = useQueryClient();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  useEffect(() => {
    const cleanup = createWebSocket((event) => {
      setStatus('connected');
      if (event.type === 'message.created' && event.message) {
        queryClient.setQueryData(['messages'], (old: any) => {
          if (!old?.pages || old.pages.length === 0) return old;
          const pages = [...old.pages];
          const firstPage = { ...pages[0], messages: [event.message, ...(pages[0]?.messages || [])] };
          pages[0] = firstPage;
          return { ...old, pages };
        });
      } else if (event.type === 'message.deleted' && event.messageId) {
        queryClient.setQueryData(['messages'], (old: any) => {
          if (!old?.pages) return old;
          const pages = old.pages.map((page: any) => ({
            ...page,
            messages: page.messages.filter((m: Message) => m.id !== event.messageId),
          }));
          return { ...old, pages };
        });
      }
    });

    return cleanup;
  }, [queryClient, setStatus]);

  if (isMobile) {
    return (
      <div className={styles.mobileLayout}>
        <div className={`${styles.mobilePanel} ${mobileChatOpen ? styles.hidden : ''}`}>
          <Sidebar />
        </div>
        <div className={`${styles.mobilePanel} ${!mobileChatOpen ? styles.hidden : ''}`}>
          <Chat />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <Sidebar />
      <Chat />
      {searchOpen && <SearchPanel />}
    </div>
  );
}