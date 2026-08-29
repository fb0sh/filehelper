import { Sidebar } from './sidebar/Sidebar';
import { Chat } from './chat/Chat';
import { SettingsPanel } from './settings/SettingsPanel';
import { useUIStore } from '../stores/ui';
import { useRealtimeStore } from '../stores/realtime';
import { useEffect } from 'react';
import { InfiniteData, useQueryClient } from '@tanstack/react-query';
import { createWebSocket } from '../lib/websocket';
import {
  MessageListResponse,
  RealtimeEvent,
  messageKeys,
} from '../api';
import { prependMessageDedupe, removeMessageFromPages } from '../lib/realtimeCache';
import { useGlobalDragDrop } from '../hooks/useGlobalDragDrop';
import { useGlobalPaste } from '../hooks/useGlobalPaste';
import { useUploadManager } from '../hooks/useUploadManager';
import { useIsMobile } from '../hooks/useIsMobile';
import { FileText } from 'lucide-react';
import styles from './MainLayout.module.scss';

export function MainLayout() {
  const { setStatus } = useRealtimeStore();
  const mobileChatOpen = useUIStore((s) => s.mobileChatOpen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const dragOver = useGlobalDragDrop();
  useGlobalPaste();
  useUploadManager();

  useEffect(() => {
    const cleanup = createWebSocket({
      onStatus: (status) => {
        setStatus(status);
        if (status === 'connected') {
          // Reconnected: refetch to backfill anything missed offline.
          queryClient.invalidateQueries({ queryKey: messageKeys.infinite });
          queryClient.invalidateQueries({ queryKey: messageKeys.latest });
        }
      },
      onEvent: (event) => {
        const e = event as RealtimeEvent;
        if (e.type === 'message.created' && e.message) {
          queryClient.setQueryData<InfiniteData<MessageListResponse>>(
            messageKeys.infinite,
            (old) => prependMessageDedupe(old, e.message!)
          );
          queryClient.invalidateQueries({ queryKey: messageKeys.latest });
        } else if (e.type === 'message.deleted' && e.messageId) {
          queryClient.setQueryData<InfiniteData<MessageListResponse>>(
            messageKeys.infinite,
            (old) => removeMessageFromPages(old, e.messageId!)
          );
          queryClient.invalidateQueries({ queryKey: messageKeys.latest });
        }
      },
    });

    return cleanup;
  }, [queryClient, setStatus]);

  const settings = settingsOpen ? <SettingsPanel /> : null;

  if (isMobile) {
    return (
      <>
        {dragOver && <DropOverlay />}
        <div className={styles.mobileLayout}>
          <div className={`${styles.mobilePanel} ${mobileChatOpen ? styles.hidden : ''}`}>
            <Sidebar />
          </div>
          <div className={`${styles.mobilePanel} ${!mobileChatOpen ? styles.hidden : ''}`}>
            <Chat />
          </div>
        </div>
        {settings}
      </>
    );
  }

  return (
    <>
      {dragOver && <DropOverlay />}
      <div className={styles.layout}>
        <Sidebar />
        <Chat />
      </div>
      {settings}
    </>
  );
}

function DropOverlay() {
  return (
    <div className={styles.dropOverlay}>
      <div className={styles.dropContent}>
        <div className={styles.dropIcon}>
          <FileText size={48} />
        </div>
        <div className={styles.dropTitle}>Drop files here</div>
        <div className={styles.dropSubtitle}>to send them to FileHelper</div>
      </div>
    </div>
  );
}