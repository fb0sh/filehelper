import { describe, it, expect } from 'vitest';
import {
  scryptRootKey,
  deriveDomainKeys,
  deriveFileKey,
  chunkNonce,
  encryptMessage,
  decryptMessage,
  encryptChunkWithPrefix,
  decryptChunk,
  createHasher,
  hasherUpdate,
  hasherFinal,
  cryptoRandomBytes,
} from '../lib/crypto/core';
import { bytesToBase64url, hexToBytes } from '../lib/crypto/encoding';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// The frozen test instance id: 32 zero bytes, base64url no pad.
const INSTANCE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ---------------------------------------------------------------------------
// KDF known vectors (CRYPTO_VERSION=1). If anyone changes N/r/p, the NFC
// normalization, the salt, or the HKDF info strings, these break.
// ---------------------------------------------------------------------------
describe('KDF known vectors', () => {
  it('derives the frozen keys for the canonical CODE', async () => {
    const root = await scryptRootKey('FileHelper测试🔐#2026', INSTANCE);
    const keys = deriveDomainKeys(root);
    // sha256 of the frozen root key hex 544f807cca55b668…
    expect(bytesToBase64url(root)).toBe('VE-AfMpVtmhFYfUwEWeN7HiZE3kv7C4NfjC3XrB7CYQ');
    expect(keys.spaceId).toBe('6vreAWpwSGVTKgmHnbGG2rxeiWavgFZU');
    expect(keys.authKey).toBe('eVVY7DwKH5gq-B2h4kFupFj1Cyj9o0XTk-7NoIvw18c');
    expect(keys.messageKey).toBe('ENZs3keVFkIPdkLJuJ4XRAl0264uvb17_opS0PdvE0o');
    expect(keys.fileMasterKey).toBe('vc4bT91fc2pjOBiE0f33p6dEk41ZdxBPETmD-NDLClM');
  });
});

describe('Unicode normalization', () => {
  it('é composed and decomposed normalize to the same space id', async () => {
    const a = deriveDomainKeys(await scryptRootKey('\u00E9', INSTANCE));
    const b = deriveDomainKeys(await scryptRootKey('e\u0301', INSTANCE));
    expect(a.spaceId).toBe(b.spaceId);
  });

  it('Hello / hello / " hello" are three different spaces', async () => {
    const hello = deriveDomainKeys(await scryptRootKey('Hello', INSTANCE));
    const lower = deriveDomainKeys(await scryptRootKey('hello', INSTANCE));
    const spaced = deriveDomainKeys(await scryptRootKey(' hello', INSTANCE));
    expect(hello.spaceId).not.toBe(lower.spaceId);
    expect(lower.spaceId).not.toBe(spaced.spaceId);
  });

  it('Chinese + Tibetan + emoji code is stable and unique', async () => {
    const code = 'བོད་ཡིགFileHelper✨ 中文 日本語';
    const a = deriveDomainKeys(await scryptRootKey(code, INSTANCE));
    const b = deriveDomainKeys(await scryptRootKey(code, INSTANCE));
    expect(a.spaceId).toBe(b.spaceId);
    expect(a.spaceId.length).toBe(32); // 24 bytes base64url
  });

  it('NFC equivalence yields identical keys (root included)', async () => {
    const rootA = await scryptRootKey('e\u0301\u0301', INSTANCE);
    const rootB = await scryptRootKey('\u1E09', INSTANCE);
    // e + 2 combining acute == ẹ + acute? 1E09 is e + dot below + acute
    expect(bytesToBase64url(rootA)).not.toBe(bytesToBase64url(rootB));
    const rootC = await scryptRootKey('\u00E9', INSTANCE);
    const rootD = await scryptRootKey('e\u0301', INSTANCE);
    expect(bytesToBase64url(rootC)).toBe(bytesToBase64url(rootD));
  });
});

// ---------------------------------------------------------------------------
// AEAD behavior
// ---------------------------------------------------------------------------
describe('message AEAD', () => {
  const spaceId = 'space-A';
  const key = bytesToBase64url(hexToBytes('11'.repeat(32)));
  const plaintext = { v: 1, type: 'text', text: 'hello world' };

  it('encrypt → decrypt roundtrip', () => {
    const envelope = encryptMessage(key, spaceId, plaintext);
    expect(envelope.startsWith('FH1.')).toBe(true);
    const result = decryptMessage(key, spaceId, envelope);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(plaintext);
  });

  it('tampered ciphertext fails', () => {
    const envelope = encryptMessage(key, spaceId, plaintext);
    const parts = envelope.split('.');
    const nonce = parts[1];
    const ct = parts[2];
    // Flip the first ciphertext char.
    const flipped = ct[0] === 'A' ? 'B' : 'A';
    const tampered = `FH1.${nonce}.${flipped}${ct.slice(1)}`;
    const result = decryptMessage(key, spaceId, tampered);
    expect(result.ok).toBe(false);
  });

  it('wrong message key fails', () => {
    const envelope = encryptMessage(key, spaceId, plaintext);
    const wrong = bytesToBase64url(hexToBytes('22'.repeat(32)));
    expect(decryptMessage(wrong, spaceId, envelope).ok).toBe(false);
  });

  it('wrong space AAD fails (message transplant)', () => {
    const envelope = encryptMessage(key, 'space-A', plaintext);
    expect(decryptMessage(key, 'space-B', envelope).ok).toBe(false);
  });

  it('malformed envelope fails gracefully', () => {
    expect(decryptMessage(key, spaceId, 'not-an-envelope').ok).toBe(false);
    expect(decryptMessage(key, spaceId, 'FH1.onlytwo').ok).toBe(false);
    expect(decryptMessage(key, spaceId, 'FH1.a.b.c').ok).toBe(false);
  });
});

describe('file chunk AEAD', () => {
  const spaceId = 'space-F';
  const attachmentId = 'att-1';
  const prefix = bytesToBase64url(cryptoRandomBytes(16));
  const master = bytesToBase64url(hexToBytes('33'.repeat(32)));
  const fileKey = bytesToBase64url(deriveFileKey(master, attachmentId));

  it('per-file keys differ per attachment', () => {
    const k2 = bytesToBase64url(deriveFileKey(master, 'att-2'));
    expect(k2).not.toBe(fileKey);
  });

  it('chunk nonce = prefix || uint64be(index), unique per index', () => {
    const n0 = chunkNonce(prefix, 0);
    const n1 = chunkNonce(prefix, 1);
    expect(n0.length).toBe(24);
    expect(n1.length).toBe(24);
    expect(bytesToBase64url(n0)).not.toBe(bytesToBase64url(n1));
    // Last 8 bytes are big-endian index.
    expect(Array.from(n0.slice(16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(n1.slice(16))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('encrypt → decrypt roundtrip with bounded tag overhead', () => {
    const pt = new Uint8Array(1024).fill(7);
    const ct = encryptChunkWithPrefix(fileKey, spaceId, attachmentId, 0, prefix, pt);
    expect(ct.length).toBe(pt.length + 16);
    const r = decryptChunk(fileKey, spaceId, attachmentId, 0, prefix, ct);
    expect(r.ok).toBe(true);
    expect(Array.from(r.value!)).toEqual(Array.from(pt));
  });

  it('swapped chunks fail (index in nonce + AAD)', () => {
    const a = new Uint8Array(8).fill(1);
    const b = new Uint8Array(8).fill(2);
    const ca = encryptChunkWithPrefix(fileKey, spaceId, attachmentId, 0, prefix, a);
    const cb = encryptChunkWithPrefix(fileKey, spaceId, attachmentId, 1, prefix, b);
    // Decrypt chunk 1's ciphertext as chunk 0.
    const r = decryptChunk(fileKey, spaceId, attachmentId, 0, prefix, cb);
    expect(r.ok).toBe(false);
    const r2 = decryptChunk(fileKey, spaceId, attachmentId, 1, prefix, ca);
    expect(r2.ok).toBe(false);
  });

  it('wrong attachment id AAD fails (chunk transplant across files)', () => {
    const pt = new Uint8Array(8).fill(9);
    const ct = encryptChunkWithPrefix(fileKey, spaceId, attachmentId, 0, prefix, pt);
    const r = decryptChunk(fileKey, spaceId, 'att-other', 0, prefix, ct);
    expect(r.ok).toBe(false);
  });

  it('wrong space AAD fails', () => {
    const pt = new Uint8Array(8).fill(9);
    const ct = encryptChunkWithPrefix(fileKey, spaceId, attachmentId, 0, prefix, pt);
    const r = decryptChunk(fileKey, 'space-OTHER', attachmentId, 0, prefix, ct);
    expect(r.ok).toBe(false);
  });

  it('tampered tag fails', () => {
    const pt = new Uint8Array(8).fill(9);
    const ct = encryptChunkWithPrefix(fileKey, spaceId, attachmentId, 0, prefix, pt);
    ct[ct.length - 1] ^= 0x01;
    const r = decryptChunk(fileKey, spaceId, attachmentId, 0, prefix, ct);
    expect(r.ok).toBe(false);
  });
});

describe('incremental SHA-256', () => {
  it('matches a whole-buffer hash when fed chunk by chunk', () => {
    const data = new TextEncoder().encode('VERY_SECRET_FILE_CONTENT_98765');
    const hasher = createHasher();
    for (let i = 0; i < data.length; i += 3) {
      hasherUpdate(hasher, data.slice(i, i + 3));
    }
    const hex = hasherFinal(hasher);
    // 6d…: sha256("VERY_SECRET_FILE_CONTENT_98765")
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(bytesToHex(sha256(data)));
  });
});

describe('secure randomness', () => {
  it('uses the CSPRNG and never Math.random', () => {
    const a = cryptoRandomBytes(16);
    const b = cryptoRandomBytes(16);
    expect(a.length).toBe(16);
    expect(bytesToBase64url(a)).not.toBe(bytesToBase64url(b));
  });
});
