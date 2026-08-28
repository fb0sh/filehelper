import { Chat } from './chat/Chat';
import { useRealtimeStore } from '../stores/realtime';
import { useEffect } from 'react';
import { createWebSocket } from '../lib/websocket';
import { useQueryClient } from '@tanstack/react-query';
import { Message } from '../api';
import { useGlobalDragDrop } from '../hooks/useGlobalDragDrop';
import { useGlobalPaste } from '../hooks/useGlobalPaste';
import { useUploadManager } from '../hooks/useUploadManager';
import { Paperclip } from 'lucide-react';
import styles from './MainLayout.module.scss';

export function MainLayout() {
  const { setStatus } = useRealtimeStore();
  const queryClient = useQueryClient();

  const dragOver = useGlobalDragDrop();
  useGlobalPaste();
  useUploadManager();

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

  return (
    <>
      {dragOver && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropContent}>
            <div className={styles.dropIcon}>
              <Paperclip size={48} />
            </div>
            <div className={styles.dropTitle}>Drop files here</div>
            <div className={styles.dropSubtitle}>to send them to FileHelper</div>
          </div>
        </div>
      )}

      <div className={styles.layout}>
        <Chat />
      </div>
    </>
  );
}