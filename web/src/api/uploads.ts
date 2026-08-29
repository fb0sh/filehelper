import { authedFetch, request } from './client';
import type { EncryptedMessage } from './messages';

export interface UploadInitResponse {
  uploadId: string;
  attachmentId: string;
}

export const uploadsApi = {
  init: () => request<UploadInitResponse>('/uploads', { method: 'POST' }),

  /** PUT one encrypted chunk (sequential). Throws ApiError on failure. */
  async chunk(
    uploadId: string,
    index: number,
    ciphertext: Uint8Array,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await authedFetch(`/uploads/${uploadId}/chunks/${index}`, {
      method: 'PUT',
      body: ciphertext,
      headers: { 'Content-Type': 'application/octet-stream', 'X-FileHelper-Request': '1' },
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || `chunk upload failed (${res.status})`);
    }
  },

  complete: (uploadId: string, payload: string) =>
    request<EncryptedMessage>(`/uploads/${uploadId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ payload }),
      headers: { 'Content-Type': 'application/json' },
    }),

  cancel: (uploadId: string) =>
    request<void>(`/uploads/${uploadId}`, { method: 'DELETE' }),
};
