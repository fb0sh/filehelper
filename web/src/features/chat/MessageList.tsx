import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, Message } from '../../api';
import { useEffect, useRef, useCallback } from 'react';
import { MessageBubble } from './messages/MessageBubble';
import { DateSeparator } from './DateSeparator';
import { ScrollToBottom } from './ScrollToBottom';
import { formatDateSeparator } from '../../lib/dates';
import styles from './MessageList.module.scss';

export function MessageList() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);
  const isLoadingMore = useRef(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['messages'],
    queryFn: ({ pageParam }) => messagesApi.list(pageParam, 50),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const allMessages = data?.pages.flatMap((p) => p.messages) ?? [];
  // Reverse to show oldest first
  const messages = [...allMessages].reverse();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (containerRef.current && !isLoadingMore.current) {
      const container = containerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages.length]);

  // Scroll anchor for prepending
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || !hasNextPage || isFetchingNextPage) return;

    if (container.scrollTop < 50) {
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
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Group messages by date
  const grouped = groupByDate(messages);
  const isNearBottom = useCallback(() => {
    const c = containerRef.current;
    if (!c) return true;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 200;
  }, []);

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
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <ScrollToBottom
        visible={!isNearBottom()}
        onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
      />
    </div>
  );
}

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