import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, messageKeys, EncryptedMessage } from '../../api';
import { useUploadStore } from '../../stores/upload';
import { useSelectionStore } from '../../stores/selection';
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { MessageBubble } from './messages/MessageBubble';
import { UploadMessage } from './messages/UploadMessage';
import { DateSeparator } from './DateSeparator';
import { ScrollToBottom } from './ScrollToBottom';
import { formatDateSeparator } from '../../lib/dates';
import { isNearBottom, shouldLoadMore } from '../../lib/scroll';
import { computeAddedNewest, decideNewMessage } from '../../lib/newMessages';
import { contextToInfiniteData } from '../../lib/realtimeCache';
import { useDecryptedMessages } from '../../hooks/useDecryptedMessages';
import type { DecryptedMessage } from '../../lib/crypto/messages';
import styles from './MessageList.module.scss';

export interface MessageListHandle {
  jumpToMessage: (msg: DecryptedMessage) => void;
}

export const MessageList = forwardRef<MessageListHandle>((_props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);
  const isLoadingMore = useRef(false);
  const wasNearBottomRef = useRef(true);
  const previousNewestIdRef = useRef<string | undefined>(undefined);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const uploadTasks = useUploadStore((s) => s.tasks);
  const cancelTask = useUploadStore((s) => s.cancelTask);
  const retryTask = useUploadStore((s) => s.retryTask);
  const selectionActive = useSelectionStore((s) => s.active);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const toggleSelected = useSelectionStore((s) => s.toggle);
  const queryClient = useQueryClient();

  const activeTasks = uploadTasks.filter(
    (t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'failed' || t.status === 'cancelled'
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: messageKeys.infinite,
    queryFn: ({ pageParam }) => messagesApi.list(pageParam, 50),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const encrypted = data?.pages.flatMap((p) => p.messages) ?? [];
  const { messages: decryptedMessages } = useDecryptedMessages(encrypted);

  // Keep the newest-first encrypted cache handy for jump/context work.
  const encryptedRef = useRef(encrypted);
  encryptedRef.current = encrypted;
  const newestId = encrypted[0]?.id;

  // Cache is newest-first; render old → new.
  const messages = [...decryptedMessages].reverse();

  useEffect(() => {
    const prev = previousNewestIdRef.current;
    if (prev === undefined) {
      previousNewestIdRef.current = newestId;
      wasNearBottomRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (newestId === prev) return;

    previousNewestIdRef.current = newestId;
    const added = computeAddedNewest(prev, encryptedRef.current);
    const decision = decideNewMessage(wasNearBottomRef.current, added);

    if (decision.kind === 'scroll') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setNewMessageCount(0);
      setShowScrollBtn(false);
    } else if (decision.count > 0) {
      setNewMessageCount((c) => c + decision.count);
      setShowScrollBtn(true);
    }
  }, [newestId]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const nearBottom = isNearBottom(container, 150);
    wasNearBottomRef.current = nearBottom;
    setShowScrollBtn(!nearBottom);
    if (nearBottom) setNewMessageCount(0);

    if (!shouldLoadMore(container.scrollTop, hasNextPage, isFetchingNextPage)) return;

    isLoadingMore.current = true;
    prevScrollHeight.current = container.scrollHeight;
    fetchNextPage().then(() => {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          const newScrollHeight = containerRef.current.scrollHeight;
          containerRef.current.scrollTop = newScrollHeight - prevScrollHeight.current;
        }
        isLoadingMore.current = false;
      });
    });
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useImperativeHandle(ref, () => ({
    jumpToMessage: async (msg: DecryptedMessage) => {
      const exists = messages.some((m) => m.id === msg.id);
      if (!exists) {
        // Load the real encrypted context window around the target and
        // replace the cache so time order stays intact (the display is
        // derived by useDecryptedMessages).
        try {
          const ctx = await messagesApi.context(msg.id, 50);
          queryClient.setQueryData(
            messageKeys.infinite,
            contextToInfiniteData(ctx.messages, ctx.nextCursor)
          );
          await new Promise((r) => setTimeout(r, 80));
        } catch {
          return;
        }
      }
      const el = containerRef.current?.querySelector(`[data-message-id="${msg.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(msg.id);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(null), 2000);
    },
  }));

  const grouped = groupByDate(messages);

  if (isLoading) {
    return <div className={styles.loading}>Loading messages...</div>;
  }

  return (
    <div className={styles.viewport}>
      <div className={styles.container} ref={containerRef} onScroll={handleScroll}>
        <div className={styles.messagesWrapper}>
          {isFetchingNextPage && (
            <div className={styles.loadingMore}>Loading...</div>
          )}
          {grouped.map((group, gi) => (
            <div key={gi}>
              <DateSeparator date={group.date} />
              {group.messages.map((msg) => {
                const selected = selectedIds.has(msg.id);
                return (
                  <div
                    key={msg.id}
                    data-message-id={msg.id}
                    className={
                      highlightId === msg.id
                        ? styles.highlighted
                        : undefined
                    }
                  >
                    <MessageBubble
                      message={msg}
                      selectionMode={selectionActive}
                      selected={selected}
                      onToggleSelect={() => toggleSelected(msg.id)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          {activeTasks.map((task) => (
            <div key={task.id} style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 8px' }}>
              <UploadMessage
                task={task}
                onCancel={cancelTask}
                onRetry={retryTask}
              />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <ScrollToBottom
        visible={showScrollBtn}
        newMessageCount={newMessageCount}
        onClick={() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          setNewMessageCount(0);
          setShowScrollBtn(false);
        }}
      />
    </div>
  );
});

MessageList.displayName = 'MessageList';

function groupByDate(messages: DecryptedMessage[]): { date: string; messages: DecryptedMessage[] }[] {
  const groups: { date: string; messages: DecryptedMessage[] }[] = [];
  for (const msg of messages) {
    const date = formatDateSeparator(msg.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.messages.push(msg);
    } else {
      groups.push({ date, messages: [msg] });
    }
  }
  return groups;
}

export type { EncryptedMessage };
