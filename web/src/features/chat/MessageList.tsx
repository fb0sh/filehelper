import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, Message, messageKeys } from '../../api';
import { useUploadStore } from '../../stores/upload';
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { MessageBubble } from './messages/MessageBubble';
import { UploadMessage } from './messages/UploadMessage';
import { DateSeparator } from './DateSeparator';
import { ScrollToBottom } from './ScrollToBottom';
import { formatDateSeparator } from '../../lib/dates';
import { isNearBottom, shouldLoadMore } from '../../lib/scroll';
import { contextToInfiniteData } from '../../lib/realtimeCache';
import styles from './MessageList.module.scss';

export interface MessageListHandle {
  jumpToMessage: (msg: Message) => void;
}

export const MessageList = forwardRef<MessageListHandle>((_props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);
  const isLoadingMore = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const uploadTasks = useUploadStore((s) => s.tasks);
  const cancelTask = useUploadStore((s) => s.cancelTask);
  const retryTask = useUploadStore((s) => s.retryTask);
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

  const allMessages = data?.pages.flatMap((p) => p.messages) ?? [];
  // Cache is newest-first; render old → new.
  const messages = [...allMessages].reverse();

  useEffect(() => {
    if (containerRef.current && !isLoadingMore.current) {
      const container = containerRef.current;
      if (isNearBottom(container, 100)) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages.length, activeTasks.length]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scroll button state must be updated on every scroll, independent
    // of pagination.
    setShowScrollBtn(!isNearBottom(container, 200));

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
    jumpToMessage: async (msg: Message) => {
      const exists = messages.some((m) => m.id === msg.id);
      if (!exists) {
        // Load the real context window around the target so time order
        // stays intact — never splice a lone message into the cache.
        try {
          const ctx = await messagesApi.context(msg.id, 50);
          queryClient.setQueryData(
            messageKeys.infinite,
            contextToInfiniteData(ctx.messages, ctx.nextCursor)
          );
          // Allow a frame for the list to render.
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
    <div className={styles.container} ref={containerRef} onScroll={handleScroll}>
      <div className={styles.messagesWrapper}>
        {isFetchingNextPage && (
          <div className={styles.loadingMore}>Loading...</div>
        )}
        {grouped.map((group, gi) => (
          <div key={gi}>
            <DateSeparator date={group.date} />
            {group.messages.map((msg) => (
              <div
                key={msg.id}
                data-message-id={msg.id}
                className={highlightId === msg.id ? styles.highlighted : undefined}
              >
                <MessageBubble message={msg} />
              </div>
            ))}
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
      <ScrollToBottom
        visible={showScrollBtn}
        onClick={() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          setShowScrollBtn(false);
        }}
      />
    </div>
  );
});

MessageList.displayName = 'MessageList';

function groupByDate(messages: Message[]): { date: string; messages: Message[] }[] {
  const groups: { date: string; messages: Message[] }[] = [];
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