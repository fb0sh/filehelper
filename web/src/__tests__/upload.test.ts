import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUploadStore } from '../stores/upload';
import { uploadsApi } from '../api/uploads';
import { encryptMessagePayload, decryptEncryptedMessage } from '../lib/crypto/messages';
import { bytesToBase64url } from '../lib/crypto/encoding';
import { saveCryptoSession } from '../lib/crypto/session';

const KEY = bytesToBase64url(new Uint8Array(32).fill(5));

describe('upload pipeline helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useUploadStore.setState({ tasks: [] });
    saveCryptoSession({
      spaceId: 'space-up',
      authKey: KEY,
      messageKey: KEY,
      fileMasterKey: KEY,
      instanceId: 'inst',
    });
  });

  it('encrypts a file message payload that decrypts back with the metadata', () => {
    const payload = encryptMessagePayload(KEY, 'space-up', {
      type: 'file',
      file: {
        attachmentId: 'att-1',
        filename: 'video.mp4',
        mime: 'video/mp4',
        size: 2_500_000_000,
        sha256: 'c'.repeat(64),
        chunkSize: 8 * 1024 * 1024,
        noncePrefix: bytesToBase64url(new Uint8Array(16).fill(2)),
        chunkCount: 299,
      },
    });
    const outcome = decryptEncryptedMessage(KEY, 'space-up', {
      id: 'm1',
      payload,
      createdAt: '2026-01-01T00:00:00.000Z',
      attachment: null,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.message.attachment?.filename).toBe('video.mp4');
      expect(outcome.message.attachment?.chunkCount).toBe(299);
    }
  });

  it('uploadsApi.complete sends the opaque payload', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'm-created', payload: 'FH1.xyz', createdAt: 'x', attachment: null }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    await uploadsApi.complete('up-1', 'FH1.payload');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/uploads/up-1/complete');
    expect(JSON.parse(String(init?.body))).toEqual({ payload: 'FH1.payload' });
    vi.unstubAllGlobals();
  });

  it('uploadsApi.chunk streams the ciphertext with an abort signal', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    await uploadsApi.chunk('up-1', 3, new Uint8Array([1, 2, 3]), controller.signal);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/v1/uploads/up-1/chunks/3');
    expect(init?.method).toBe('PUT');
    expect(init?.signal).toBe(controller.signal);
    vi.unstubAllGlobals();
  });
});
