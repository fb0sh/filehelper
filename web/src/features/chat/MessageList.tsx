import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, messageKeys, EncryptedMessage } from '../../api';
import { useUploadStore } from '../../stores/upload';
import { useSelectionStore } from '../../stores/selection';
import { useSearchStore } from '../../stores/search';
import { useEffectiveSearchQuery } from '../../hooks/useEffectiveSearchQuery';
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
import clsx from 'clsx';
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
  const searchOpen = useSearchStore((s) => s.open);
  const activeResultId = useSearchStore((s) => s.activeResultId);
  // Debounced query shared with the search results computation, so the
  // highlight and the matching semantics can never disagree.
  const searchQuery = useEffectiveSearchQuery();
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
        } catch {
          return;
        }
      }
      // Wait for the wrapper to actually be in the DOM (context fetch →
      // query cache → decrypt → render). Poll with requestAnimationFrame
      // instead of a magic setTimeout so the jump is never flaky; the
      // retry is bounded so a missing element just gives up silently.
      const el = await waitForMessageEl(containerRef, msg.id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                const isSearchActive = searchOpen && activeResultId === msg.id;
                return (
                  <div
                    key={msg.id}
                    data-message-id={msg.id}
                    data-search-active={isSearchActive ? 'true' : undefined}
                    className={clsx(
                      highlightId === msg.id && styles.highlighted,
                      isSearchActive && styles.searchActive
                    )}
                  >
                    <MessageBubble
                      message={msg}
                      selectionMode={selectionActive}
                      selected={selected}
                      onToggleSelect={() => toggleSelected(msg.id)}
                      searchQuery={searchOpen ? searchQuery : undefined}
                      searchActive={isSearchActive}
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

const JUMP_WAIT_FRAMES = 60; // ≈ 1 s of requestAnimationFrame retries

/** Wait for the message wrapper to exist in the DOM, polling with
 * requestAnimationFrame (bounded). Resolves null if it never appears. */
function waitForMessageEl(
  containerRef: React.RefObject<HTMLDivElement | null>,
  id: string
): Promise<Element | null> {
  return new Promise((resolve) => {
    let frames = 0;
    const check = () => {
      const el = containerRef.current?.querySelector(`[data-message-id="${id}"]`);
      if (el) return resolve(el);
      if (frames >= JUMP_WAIT_FRAMES) return resolve(null);
      frames += 1;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export type { EncryptedMessage };
