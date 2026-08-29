import { EncryptedMessage, MessageListResponse } from '../api';

// Shape of a TanStack Query infinite query cache entry for messages.
export interface InfiniteMessages {
  pages: MessageListResponse[];
  pageParams: unknown[];
}

// Prepend a realtime message to the newest page, skipping duplicates
// (e.g. our own echo from the server broadcast).
export function prependMessageDedupe(
  data: InfiniteMessages | undefined,
  message: EncryptedMessage
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

export function removeMessagesFromPages(
  data: InfiniteMessages | undefined,
  ids: string[]
): InfiniteMessages | undefined {
  if (!data?.pages || ids.length === 0) return data;
  const set = new Set(ids);
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.filter((m) => !set.has(m.id)),
    })),
  };
}

// Replace the whole cache with a context window around a jumped-to
// message. Input must be old → new; pages are stored newest → oldest.
export function contextToInfiniteData(
  messagesOldToNew: EncryptedMessage[],
  nextCursor: string | null
): InfiniteMessages {
  return {
    pages: [{ messages: [...messagesOldToNew].reverse(), nextCursor }],
    pageParams: [undefined],
  };
}
