// Pure crypto primitives on top of @noble — the only place that imports
// noble. Used by the Web Worker (production) and by Vitest (tests) via
// the same code path, so vectors stay identical in both.

import { scryptAsync } from '@noble/hashes/scrypt.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  CRYPTO_VERSION,
  FILE_NONCE_LEN,
  FILE_NONCE_PREFIX_LEN,
  INFO_AUTH,
  INFO_FILE_KEY,
  INFO_FILES,
  INFO_MESSAGES,
  INFO_SPACE_ID,
  KEY_LEN,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_SALT_PREFIX,
  SPACE_ID_BYTES,
} from './constants';
import {
  bytesToBase64url,
  bytesToHex as hexEncode,
  base64urlToBytes,
  hexToBytes,
  uint64Be,
  utf8Decode,
  utf8Encode,
} from './encoding';

export interface DerivedKeys {
  spaceId: string;
  authKey: string; // base64url
  messageKey: string; // base64url
  fileMasterKey: string; // base64url
}

/** Scrypt(password = NFC(code), salt = "filehelper/v1/scrypt:" + instanceId). */
export async function scryptRootKey(
  code: string,
  instanceId: string
): Promise<Uint8Array> {
  const normalized = code.normalize('NFC');
  const salt = utf8Encode(SCRYPT_SALT_PREFIX + instanceId);
  return scryptAsync(utf8Encode(normalized), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: KEY_LEN,
  });
}

/** HKDF-SHA256 domain separation from the root key. */
export function deriveDomainKeys(rootKey: Uint8Array): DerivedKeys {
  const spaceKey = hkdf(sha256, rootKey, undefined, utf8Encode(INFO_SPACE_ID), KEY_LEN);
  const authKey = hkdf(sha256, rootKey, undefined, utf8Encode(INFO_AUTH), KEY_LEN);
  const messageKey = hkdf(sha256, rootKey, undefined, utf8Encode(INFO_MESSAGES), KEY_LEN);
  const fileMasterKey = hkdf(sha256, rootKey, undefined, utf8Encode(INFO_FILES), KEY_LEN);

  return {
    spaceId: bytesToBase64url(spaceKey.slice(0, SPACE_ID_BYTES)),
    authKey: bytesToBase64url(authKey),
    messageKey: bytesToBase64url(messageKey),
    fileMasterKey: bytesToBase64url(fileMasterKey),
  };
}

/** Per-attachment file key: HKDF(fileMasterKey, salt=attachmentId). */
export function deriveFileKey(
  fileMasterKeyB64u: string,
  attachmentId: string
): Uint8Array {
  const ikm = base64urlToBytes(fileMasterKeyB64u);
  return hkdf(sha256, ikm, utf8Encode(attachmentId), utf8Encode(INFO_FILE_KEY), KEY_LEN);
}

/** 24-byte chunk nonce = 16-byte prefix || uint64_be(chunkIndex). */
export function chunkNonce(noncePrefixB64u: string, chunkIndex: number): Uint8Array {
  const prefix = base64urlToBytes(noncePrefixB64u);
  if (prefix.length !== FILE_NONCE_PREFIX_LEN) {
    throw new Error('invalid nonce prefix length');
  }
  const nonce = new Uint8Array(FILE_NONCE_LEN);
  nonce.set(prefix);
  nonce.set(uint64Be(chunkIndex), FILE_NONCE_PREFIX_LEN);
  return nonce;
}

// ---------------------------------------------------------------------------
// Message encryption
// ---------------------------------------------------------------------------

export function encryptMessage(
  messageKeyB64u: string,
  spaceId: string,
  plaintext: unknown
): string {
  const key = base64urlToBytes(messageKeyB64u);
  const nonce = cryptoRandomBytes(24);
  const aad = utf8Encode(`filehelper:v1:message:${spaceId}`);
  const aead = xchacha20poly1305(key, nonce, aad);
  const ct = aead.encrypt(utf8Encode(JSON.stringify(plaintext)));
  return `FH1.${bytesToBase64url(nonce)}.${bytesToBase64url(ct)}`;
}

export interface DecryptResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/** Decrypt an FH1 envelope. Never throws — returns {ok:false} on any
 * parse/AEAD error so one corrupt record cannot crash the UI. */
export function decryptMessage(
  messageKeyB64u: string,
  spaceId: string,
  envelope: string
): DecryptResult<unknown> {
  try {
    if (!envelope.startsWith('FH1.')) {
      return { ok: false, error: 'bad envelope prefix' };
    }
    const parts = envelope.slice(4).split('.');
    if (parts.length !== 2) return { ok: false, error: 'bad envelope shape' };
    const [nonceB64u, ctB64u] = parts;
    const nonce = base64urlToBytes(nonceB64u);
    if (nonce.length !== 24) return { ok: false, error: 'bad nonce' };
    const key = base64urlToBytes(messageKeyB64u);
    const aead = xchacha20poly1305(key, nonce, utf8Encode(`filehelper:v1:message:${spaceId}`));
    const pt = aead.decrypt(base64urlToBytes(ctB64u));
    return { ok: true, value: JSON.parse(utf8Decode(pt)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'decrypt failed' };
  }
}

// ---------------------------------------------------------------------------
// File chunk encryption
// ---------------------------------------------------------------------------

export function encryptChunkWithPrefix(
  fileKeyB64u: string,
  spaceId: string,
  attachmentId: string,
  chunkIndex: number,
  noncePrefixB64u: string,
  plaintext: Uint8Array
): Uint8Array {
  const key = base64urlToBytes(fileKeyB64u);
  const aad = utf8Encode(`filehelper:v1:file:${spaceId}:${attachmentId}:${chunkIndex}`);
  const aead = xchacha20poly1305(key, chunkNonce(noncePrefixB64u, chunkIndex), aad);
  return aead.encrypt(plaintext);
}

export function decryptChunk(
  fileKeyB64u: string,
  spaceId: string,
  attachmentId: string,
  chunkIndex: number,
  noncePrefixB64u: string,
  ciphertext: Uint8Array
): DecryptResult<Uint8Array> {
  try {
    const key = base64urlToBytes(fileKeyB64u);
    const aad = utf8Encode(`filehelper:v1:file:${spaceId}:${attachmentId}:${chunkIndex}`);
    const aead = xchacha20poly1305(key, chunkNonce(noncePrefixB64u, chunkIndex), aad);
    return { ok: true, value: aead.decrypt(ciphertext) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'decrypt failed' };
  }
}

// ---------------------------------------------------------------------------
// Incremental SHA-256 (plaintext integrity, chunk by chunk)
// ---------------------------------------------------------------------------

export function createHasher() {
  return sha256.create();
}

export function hasherUpdate(hasher: ReturnType<typeof createHasher>, data: Uint8Array) {
  hasher.update(data);
}

export function hasherFinal(hasher: ReturnType<typeof createHasher>): string {
  return bytesToHex(hasher.digest());
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** CSPRNG only. Throws (never degrades) when the API is unavailable. */
export function cryptoRandomBytes(len: number): Uint8Array {
  if (typeof globalThis === 'undefined' || typeof globalThis.crypto === 'undefined') {
    throw new Error('Unsupported browser: secure random API is unavailable');
  }
  const out = new Uint8Array(len);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export { bytesToHex, hexToBytes, hexEncode, CRYPTO_VERSION };
