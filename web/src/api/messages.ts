import { request } from './client';

export interface MessageAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number;
  sha256: string;
  contentUrl: string;
  downloadUrl: string;
}

export interface Message {
  id: string;
  kind: 'text' | 'image' | 'video' | 'audio' | 'document';
  text: string | null;
  createdAt: string;
  attachment: MessageAttachment | null;
}

export interface MessageListResponse {
  messages: Message[];
  nextCursor: string | null;
}

export interface MessageContextResponse {
  /** Messages ordered old → new, target message included. */
  messages: Message[];
  nextCursor: string | null;
}

export interface RealtimeEvent {
  type: 'message.created' | 'message.deleted';
  message?: Message;
  messageId?: string;
}

export const messagesApi = {
  list: (before?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    params.set('limit', String(limit));
    return request<MessageListResponse>(`/messages?${params}`);
  },
  create: (text: string) => request<Message>('/messages', {
    method: 'POST',
    body: JSON.stringify({ text }),
    headers: { 'Content-Type': 'application/json' },
  }),
  delete: (id: string) => request<void>(`/messages/${id}`, { method: 'DELETE' }),
  context: (id: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    return request<MessageContextResponse>(`/messages/${id}/context?${params}`);
  },
};