// Lazy image preview: fetch ciphertext → decrypt → magic-check → Blob
// URL, cached in the in-memory LRU. Only safe raster formats preview;
// SVG and anything with a mismatched magic stays a file card.

import { authedFetch } from '../api/client';
import { IMAGE_PREVIEW_MAX_BYTES } from './crypto/constants';
import { loadCryptoSession } from './crypto/session';
import { cryptoClient } from './crypto/workerClient';
import type { DecryptedAttachment } from './crypto/messages';
import { ciphertextChunks } from './fileTransfer';
import { detectImageKind, isAllowedImageMime, mimeForKind } from './imageMagic';
import { imagePreviewCache } from './imagePreviewCache';

export type PreviewStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'error'; reason: string }
  | { state: 'invalid' }; // decrypted but not a safe raster image

/** Distinguishable failure: the bytes decrypted fine but are not a safe
 * raster image → show a plain file card, not "unable to decrypt". */
export class ImageNotPreviewableError extends Error {
  constructor() {
    super('Not a supported image');
    this.name = 'ImageNotPreviewableError';
  }
}

/** Can this attachment ever be previewed? (MIME allow-list + size cap.)
 * The magic header check happens after decryption. */
export function canPreviewImage(att: DecryptedAttachment): boolean {
  return isAllowedImageMime(att.mime) && att.size <= IMAGE_PREVIEW_MAX_BYTES;
}

export const previewStatuses = new Map<string, PreviewStatus>();

function setStatus(attachmentId: string, status: PreviewStatus) {
  previewStatuses.set(attachmentId, status);
}

/** Decrypt + validate + cache the preview. Returns the blob URL. */
export async function loadImagePreview(
  att: DecryptedAttachment
): Promise<string> {
  const cached = imagePreviewCache.get(att.id);
  if (cached) {
    setStatus(att.id, { state: 'ready', url: cached });
    return cached;
  }

  setStatus(att.id, { state: 'loading' });
  const session = loadCryptoSession();
  if (!session) throw new Error('No crypto session');

  const res = await authedFetch(att.downloadUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  if (!res.body) throw new Error('No response body');

  // Preview files are bounded (≤ 64 MiB), so collecting the decrypted
  // plaintext into one Blob is safe.
  const parts: Uint8Array[] = [];
  let total = 0;
  let magicChecked = false;
  const fileKey = await cryptoClient.deriveFileKey(session.fileMasterKey, att.id);
  await cryptoClient.hashInit(att.id);

  // Read ciphertext directly, decrypt chunk by chunk, validate magic on
  // the first chunk, hash everything for integrity.
  const chunkBytes = att.chunkSize + 16;
  let index = 0;
  for await (const ct of ciphertextChunks(res.body, chunkBytes)) {
    const r = await cryptoClient.decryptChunk(
      fileKey,
      session.spaceId,
      att.id,
      index,
      att.noncePrefix,
      ct
    );
    if (!r.ok || !r.plaintext) throw new Error(`Unable to decrypt this file: ${r.error}`);

    if (!magicChecked) {
      const kind = detectImageKind(r.plaintext);
      if (!kind) throw new ImageNotPreviewableError();
      magicChecked = true;
    }
    parts.push(r.plaintext.slice());
    total += r.plaintext.length;
    await cryptoClient.hashUpdate(att.id, r.plaintext);
    index += 1;
  }

  const sha = await cryptoClient.hashFinal(att.id);
  if (sha !== att.sha256) throw new Error('Integrity check failed');

  // Detect the real format (never trust metadata MIME).
  const kind = detectImageKind(parts[0]);
  if (!kind) throw new ImageNotPreviewableError();
  const blob = new Blob(parts, { type: mimeForKind(kind) });
  const url = URL.createObjectURL(blob);
  imagePreviewCache.set(att.id, url, total);
  setStatus(att.id, { state: 'ready', url });
  return url;
}
