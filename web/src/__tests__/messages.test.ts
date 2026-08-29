import { describe, it, expect } from 'vitest';
import {
  encryptMessagePayload,
  decryptEncryptedMessage,
  validateMessageSchema,
} from '../lib/crypto/messages';
import { encryptMessage } from '../lib/crypto/core';
import { bytesToBase64url, hexToBytes } from '../lib/crypto/encoding';

const KEY = bytesToBase64url(hexToBytes('aa'.repeat(32)));
const SPACE = 'space-msg';

function record(payload: string, id = 'm1') {
  return { id, payload, createdAt: '2026-01-01T00:00:00.000Z', attachment: null };
}

describe('message encryption roundtrip', () => {
  it('text message', () => {
    const envelope = encryptMessagePayload(KEY, SPACE, { type: 'text', text: 'hello' });
    const outcome = decryptEncryptedMessage(KEY, SPACE, record(envelope));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.message.type).toBe('text');
      expect(outcome.message.text).toBe('hello');
      expect(outcome.message.id).toBe('m1');
    }
  });

  it('file message with metadata', () => {
    const envelope = encryptMessagePayload(KEY, SPACE, {
      type: 'file',
      file: {
        attachmentId: 'att-1',
        filename: 'report.pdf',
        mime: 'application/pdf',
        size: 123456,
        sha256: 'a'.repeat(64),
        chunkSize: 8 * 1024 * 1024,
        noncePrefix: bytesToBase64url(new Uint8Array(16).fill(3)),
        chunkCount: 1,
      },
    });
    const outcome = decryptEncryptedMessage(KEY, SPACE, record(envelope));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.message.type).toBe('file');
      expect(outcome.message.attachment?.filename).toBe('report.pdf');
      expect(outcome.message.attachment?.size).toBe(123456);
      expect(outcome.message.attachment?.chunkCount).toBe(1);
    }
  });

  it('server record attachment is carried into the decrypted model', () => {
    const envelope = encryptMessagePayload(KEY, SPACE, {
      type: 'file',
      file: {
        attachmentId: 'att-9',
        filename: 'x.bin',
        mime: 'application/octet-stream',
        size: 10,
        sha256: 'b'.repeat(64),
        chunkSize: 8 * 1024 * 1024,
        noncePrefix: bytesToBase64url(new Uint8Array(16).fill(1)),
        chunkCount: 1,
      },
    });
    const outcome = decryptEncryptedMessage(KEY, SPACE, {
      id: 'm9',
      payload: envelope,
      createdAt: '2026-01-01T00:00:00.000Z',
      attachment: { id: 'att-9', ciphertextSize: 26, downloadUrl: '/api/v1/files/att-9/download' },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.message.attachment?.downloadUrl).toBe('/api/v1/files/att-9/download');
    }
  });
});

describe('malicious / corrupt payloads never crash', () => {
  it('wrong key → undecryptable', () => {
    const envelope = encryptMessagePayload(KEY, SPACE, { type: 'text', text: 'hi' });
    const wrong = bytesToBase64url(hexToBytes('bb'.repeat(32)));
    const outcome = decryptEncryptedMessage(wrong, SPACE, record(envelope));
    expect(outcome.ok).toBe(false);
  });

  it('valid AEAD but bad JSON schema is rejected', () => {
    // Hand-craft ciphertexts whose plaintext is valid AEAD but invalid
    // message JSON — the decrypt must NOT throw and must report failure.
    const cases: unknown[] = [
      { v: 2, type: 'text', text: 'unsupported version' },
      { v: 1, type: 'text', text: 42 },
      { v: 1, type: 'unknown-type' },
      { v: 1, type: 'text', text: 'x'.repeat(70 * 1024) },
      { v: 1, type: 'file', filename: 'no-attachment-id.pdf', mime: 'application/pdf', size: 1, sha256: 'a'.repeat(64), chunkSize: 1024, noncePrefix: 'nope', chunkCount: 1 },
      { v: 1, type: 'file', attachmentId: 'a', filename: '', mime: 'x', size: 0, sha256: 'bad-hash', chunkSize: 0, noncePrefix: 'x', chunkCount: 0 },
      { v: 1, type: 'file', attachmentId: 'a'.repeat(100), filename: 'f', mime: 'x', size: 1, sha256: 'a'.repeat(64), chunkSize: 1024, noncePrefix: '!!!!not-base64url!!!!', chunkCount: 1 },
      null,
      'just a string',
      42,
      [],
    ];
    for (const bad of cases) {
      // Core encrypt can wrap ANY JSON (including non-objects); the
      // validator must reject everything invalid without throwing.
      const envelope = encryptMessage(KEY, SPACE, bad);
      let outcome;
      expect(() => {
        outcome = decryptEncryptedMessage(KEY, SPACE, record(envelope));
      }).not.toThrow();
      expect(outcome!.ok).toBe(false);
    }
  });

  it('validateMessageSchema rejects edge cases directly', () => {
    expect(validateMessageSchema({ v: 1, type: 'text', text: '' }).ok).toBe(true);
    expect(validateMessageSchema({ v: 1, type: 'text', text: 5 }).ok).toBe(false);
    expect(validateMessageSchema({ v: 9, type: 'text', text: 'x' }).ok).toBe(false);
    expect(validateMessageSchema({ v: 1, type: 'file', attachmentId: 'x', filename: 'f', mime: 'm', size: 0, sha256: 'a'.repeat(64), chunkSize: 1024, noncePrefix: 'A'.repeat(22), chunkCount: 2 }).ok).toBe(true);
    expect(validateMessageSchema({ v: 1, type: 'file', attachmentId: 'x', filename: 'f', mime: 'm', size: 0, sha256: 'not-hex', chunkSize: 1024, noncePrefix: 'A'.repeat(22), chunkCount: 1 }).ok).toBe(false);
    expect(validateMessageSchema({ v: 1, type: 'file', attachmentId: 'x', filename: 'f', mime: 'm', size: 0, sha256: 'a'.repeat(64), chunkSize: 99999999, noncePrefix: 'A'.repeat(22), chunkCount: 1 }).ok).toBe(false);
  });
});
