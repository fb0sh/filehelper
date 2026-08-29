import { request } from './client';

/** Server-side encrypted message record. Payload is opaque. */
export interface EncryptedMessage {
  id: string;
  payload: string;
  createdAt: string;
  attachment: EncryptedAttachment | null;
}

export interface EncryptedAttachment {
  id: string;
  ciphertextSize: number;
  downloadUrl: string;
}

export interface MessageListResponse {
  messages: EncryptedMessage[];
  nextCursor: string | null;
}

export interface MessageContextResponse {
  messages: EncryptedMessage[];
  nextCursor: string | null;
}

export interface RealtimeEvent {
  type: 'message.created' | 'message.deleted' | 'messages.deleted';
  message?: EncryptedMessage;
  messageId?: string;
  messageIds?: string[];
}

export const messagesApi = {
  list: (before?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    params.set('limit', String(limit));
    return request<MessageListResponse>(`/messages?${params}`);
  },
  create: (payload: string) =>
    request<EncryptedMessage>('/messages', {
      method: 'POST',
      body: JSON.stringify({ payload }),
      headers: { 'Content-Type': 'application/json' },
    }),
  delete: (id: string) => request<void>(`/messages/${id}`, { method: 'DELETE' }),
  batchDelete: (ids: string[]) =>
    request<{ deleted: number }>('/messages/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
      headers: { 'Content-Type': 'application/json' },
    }),
  context: (id: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    return request<MessageContextResponse>(`/messages/${id}/context?${params}`);
  },
  clearAll: () =>
    request<{ ok: boolean }>('/clear', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    }),
  storage: () => request<{ ciphertextBytes: number; messageCount: number; fileCount: number }>('/storage'),
};
