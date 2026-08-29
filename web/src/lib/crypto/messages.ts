// Decrypted message model + encrypted→decrypted conversion with strict
// schema validation. One corrupt/forged record must never crash the app:
// every conversion returns a discriminated result.

import {
  CRYPTO_VERSION,
  FILE_CHUNK_SIZE,
  MAX_FILENAME_LEN,
  MAX_MESSAGE_TEXT,
  MESSAGE_NONCE_LEN,
} from './constants';
import { decryptMessage as coreDecrypt, encryptMessage as coreEncrypt } from './core';

export interface DecryptedAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  chunkSize: number;
  chunkCount: number;
  noncePrefix: string; // base64url, 16 bytes
  downloadUrl: string;
}

export interface DecryptedMessage {
  id: string;
  type: 'text' | 'file';
  text?: string;
  createdAt: string; // ISO
  attachment?: DecryptedAttachment;
  /** true when the ciphertext failed to decrypt/validate. */
  undecryptable?: boolean;
}

export function encryptMessagePayload(
  messageKeyB64u: string,
  spaceId: string,
  message: { type: 'text'; text: string } | { type: 'file'; file: FilePlaintext }
): string {
  if (message.type === 'text') {
    return coreEncrypt(messageKeyB64u, spaceId, {
      v: CRYPTO_VERSION,
      type: 'text',
      text: message.text,
    });
  }
  return coreEncrypt(messageKeyB64u, spaceId, {
    v: CRYPTO_VERSION,
    type: 'file',
    attachmentId: message.file.attachmentId,
    filename: message.file.filename,
    mime: message.file.mime,
    size: message.file.size,
    sha256: message.file.sha256,
    chunkSize: message.file.chunkSize,
    noncePrefix: message.file.noncePrefix,
    chunkCount: message.file.chunkCount,
  });
}

export interface FilePlaintext {
  attachmentId: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  chunkSize: number;
  noncePrefix: string;
  chunkCount: number;
}

export type DecryptOutcome =
  | { ok: true; message: DecryptedMessage }
  | { ok: false; reason: string };

/** Decrypt + validate one encrypted message record. */
export function decryptEncryptedMessage(
  messageKeyB64u: string,
  spaceId: string,
  record: {
    id: string;
    payload: string;
    createdAt: string;
    attachment?: { id: string; ciphertextSize: number; downloadUrl: string } | null;
  }
): DecryptOutcome {
  const result = coreDecrypt(messageKeyB64u, spaceId, record.payload);
  if (!result.ok) {
    return { ok: false, reason: result.error ?? 'decrypt failed' };
  }
  const v = validateMessageSchema(result.value);
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }
  const base: DecryptedMessage = {
    id: record.id,
    type: v.value.type,
    createdAt: record.createdAt,
  };
  if (v.value.type === 'text') {
    base.text = v.value.text;
  } else {
    base.attachment = {
      id: v.value.attachmentId,
      filename: v.value.filename,
      mime: v.value.mime,
      size: v.value.size,
      sha256: v.value.sha256,
      chunkSize: v.value.chunkSize,
      chunkCount: v.value.chunkCount,
      noncePrefix: v.value.noncePrefix,
      downloadUrl: record.attachment?.downloadUrl ?? '',
    };
  }
  return { ok: true, message: base };
}

type ValidatedMessage =
  | { type: 'text'; text: string }
  | {
      type: 'file';
      attachmentId: string;
      filename: string;
      mime: string;
      size: number;
      sha256: string;
      chunkSize: number;
      noncePrefix: string;
      chunkCount: number;
    };

/** Strict schema check of the decrypted plaintext (spec: malicious
 * ciphertext must not crash the UI). */
export function validateMessageSchema(value: unknown): { ok: true; value: ValidatedMessage } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'not an object' };
  const v = value as Record<string, unknown>;
  if (v.v !== CRYPTO_VERSION) return { ok: false, reason: 'unsupported crypto version' };

  if (v.type === 'text') {
    if (typeof v.text !== 'string') return { ok: false, reason: 'text: not a string' };
    if (v.text.length > MAX_MESSAGE_TEXT) return { ok: false, reason: 'text: too long' };
    return { ok: true, value: { type: 'text', text: v.text } };
  }

  if (v.type === 'file') {
    if (typeof v.attachmentId !== 'string' || v.attachmentId.length > 64)
      return { ok: false, reason: 'attachmentId invalid' };
    if (typeof v.filename !== 'string' || v.filename.length === 0 || v.filename.length > MAX_FILENAME_LEN)
      return { ok: false, reason: 'filename invalid' };
    if (typeof v.mime !== 'string' || v.mime.length > 128) return { ok: false, reason: 'mime invalid' };
    if (typeof v.size !== 'number' || !Number.isSafeInteger(v.size) || v.size < 0)
      return { ok: false, reason: 'size invalid' };
    if (typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256))
      return { ok: false, reason: 'sha256 invalid' };
    if (typeof v.chunkSize !== 'number' || !Number.isInteger(v.chunkSize) || v.chunkSize <= 0 || v.chunkSize > FILE_CHUNK_SIZE)
      return { ok: false, reason: 'chunkSize invalid' };
    if (typeof v.noncePrefix !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(v.noncePrefix))
      return { ok: false, reason: 'noncePrefix invalid' };
    const chunkCount = Number(v.chunkCount);
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) return { ok: false, reason: 'chunkCount invalid' };
    return {
      ok: true,
      value: {
        type: 'file',
        attachmentId: v.attachmentId,
        filename: v.filename,
        mime: v.mime,
        size: v.size,
        sha256: v.sha256,
        chunkSize: v.chunkSize,
        noncePrefix: v.noncePrefix,
        chunkCount,
      },
    };
  }

  return { ok: false, reason: 'unknown message type' };
}

export { MESSAGE_NONCE_LEN };
