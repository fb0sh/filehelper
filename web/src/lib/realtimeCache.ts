import { Message, MessageListResponse } from '../api';

// Shape of a TanStack Query infinite query cache entry for messages.
export interface InfiniteMessages {
  pages: MessageListResponse[];
  pageParams: unknown[];
}

// Prepend a realtime message to the newest page, skipping duplicates
// (e.g. our own optimistic echo from the server broadcast).
export function prependMessageDedupe(
  data: InfiniteMessages | undefined,
  message: Message
): InfiniteMessages | undefined {
  if (!data?.pages?.length) return data;
  const exists = data.pages.some((page) =>
    page.messages.some((m) => m.id === message.id)
  );
  if (exists) return data;
  const pages = [...data.pages];
  pages[0] = { ...pages[0], messages: [message, ...pages[0].messages] };
  return { ...data, pages };
}

export function removeMessageFromPages(
  data: InfiniteMessages | undefined,
  id: string
): InfiniteMessages | undefined {
  if (!data?.pages) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.filter((m) => m.id !== id),
    })),
  };
}

// Replace the whole cache with a context window around a jumped-to
// message. Input must be old → new; pages are stored newest → oldest.
// Preserves real time ordering in the rendered list.
export function contextToInfiniteData(
  messagesOldToNew: Message[],
  nextCursor: string | null
): InfiniteMessages {
  return {
    pages: [{ messages: [...messagesOldToNew].reverse(), nextCursor }],
    pageParams: [undefined],
  };
}