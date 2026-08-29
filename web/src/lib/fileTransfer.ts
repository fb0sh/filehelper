// Encrypted file download + decryption with constant memory.

import { authedFetch } from '../api/client';
import { BLOB_DOWNLOAD_MAX_BYTES } from './crypto/constants';
import { loadCryptoSession } from './crypto/session';
import { cryptoClient } from './crypto/workerClient';
import type { DecryptedAttachment } from './crypto/messages';

export interface WritableLike {
  write(data: Uint8Array): Promise<void> | void;
  close(): Promise<void> | void;
  abort(reason?: unknown): Promise<void> | void;
}

/** Split a response body into fixed-size ciphertext chunks (chunkSize +
 * 16-byte tag), streaming — never buffers more than one chunk. */
export async function* ciphertextChunks(
  body: ReadableStream<Uint8Array>,
  chunkSize: number
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer);
        merged.set(value, buffer.length);
        buffer = merged;
        while (buffer.length >= chunkSize) {
          yield buffer.slice(0, chunkSize);
          buffer = buffer.slice(chunkSize);
        }
      }
    }
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

export interface DecryptStreamOptions {
  onProgress?: (decryptedBytes: number, total: number) => void;
  signal?: AbortSignal;
}

/** Decrypt a full attachment, writing plaintext chunks to `writable`
 * (FileSystemWritableFileStream or a WritableStream). Verifies the
 * plaintext SHA-256; aborts the stream on any failure. Constant memory. */
export async function decryptAttachmentTo(
  attachment: DecryptedAttachment,
  writable: WritableLike,
  opts: DecryptStreamOptions = {}
): Promise<void> {
  const session = loadCryptoSession();
  if (!session) throw new Error('No crypto session');
  const { spaceId, fileMasterKey } = session;

  const res = await authedFetch(attachment.downloadUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  if (!res.body) throw new Error('No response body');

  const fileKey = await cryptoClient.deriveFileKey(fileMasterKey, attachment.id);
  await cryptoClient.hashInit(attachment.id);

  let index = 0;
  let decryptedBytes = 0;
  const chunkBytes = attachment.chunkSize + 16;

  for await (const ct of ciphertextChunks(res.body, chunkBytes)) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const r = await cryptoClient.decryptChunk(
      fileKey,
      spaceId,
      attachment.id,
      index,
      attachment.noncePrefix,
      ct
    );
    if (!r.ok || !r.plaintext) throw new Error(`Unable to decrypt this file: ${r.error}`);
    await writable.write(r.plaintext);
    await cryptoClient.hashUpdate(attachment.id, r.plaintext);
    decryptedBytes += r.plaintext.length;
    index += 1;
    opts.onProgress?.(decryptedBytes, attachment.size);
  }

  const sha = await cryptoClient.hashFinal(attachment.id);
  if (sha !== attachment.sha256) {
    await writable.abort(new Error('Integrity check failed'));
    throw new Error('Integrity check failed');
  }
}

/** Collect the decrypted plaintext into a Blob. Only call for files
 * bounded by BLOB_DOWNLOAD_MAX_BYTES (checked by the caller). */
export async function decryptAttachmentToBlob(
  attachment: DecryptedAttachment
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  await decryptAttachmentTo(
    attachment,
    {
      write: (data) => {
        chunks.push(data.slice());
      },
      close: () => {},
      abort: () => {},
    },
    { onProgress: () => undefined }
  );
  return new Blob(chunks, { type: 'application/octet-stream' });
}

export type DownloadOutcome =
  | { kind: 'ok' }
  | { kind: 'cancelled' }
  | { kind: 'unsupported-large'; size: number }
  | { kind: 'failed'; error: string };

/** Path A: stream to a user-chosen location via showSaveFilePicker.
 * Must be invoked inside the click gesture. */
export async function saveViaPicker(
  attachment: DecryptedAttachment,
  onProgress?: DecryptStreamOptions['onProgress']
): Promise<DownloadOutcome> {
  const w = window as unknown as {
    showSaveFilePicker: (opts: { suggestedName: string }) => Promise<{
      createWritable: () => Promise<WritableLike>;
    }>;
  };
  let handle;
  try {
    handle = await w.showSaveFilePicker({ suggestedName: attachment.filename });
  } catch {
    return { kind: 'cancelled' };
  }
  const writable = await handle.createWritable();
  try {
    await decryptAttachmentTo(attachment, writable, { onProgress });
    await writable.close();
    return { kind: 'ok' };
  } catch (err) {
    try {
      await writable.abort(err instanceof Error ? err : new Error(String(err)));
    } catch {
      // already closed
    }
    return { kind: 'failed', error: err instanceof Error ? err.message : 'Save failed' };
  }
}

/** Path B: Blob fallback when the picker is unavailable. */
export async function downloadViaBlob(
  attachment: DecryptedAttachment
): Promise<DownloadOutcome> {
  if (attachment.size > BLOB_DOWNLOAD_MAX_BYTES) {
    return { kind: 'unsupported-large', size: attachment.size };
  }
  try {
    const blob = await decryptAttachmentToBlob(attachment);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { kind: 'ok' };
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err.message : 'Download failed' };
  }
}

/** Unified entry point used by the Download / Save as… menu items. */
export async function downloadAttachment(
  attachment: DecryptedAttachment,
  opts: { saveAs: boolean; onProgress?: DecryptStreamOptions['onProgress'] }
): Promise<DownloadOutcome> {
  const picker =
    typeof window !== 'undefined' &&
    typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  if (opts.saveAs && picker) {
    return saveViaPicker(attachment, opts.onProgress);
  }
  return downloadViaBlob(attachment);
}
