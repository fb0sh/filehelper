import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ciphertextChunks,
  decryptAttachmentTo,
  decryptAttachmentToBlob,
  downloadViaBlob,
  downloadAttachment,
  saveViaPicker,
} from '../lib/fileTransfer';
import { bytesToBase64url, hexToBytes } from '../lib/crypto/encoding';
import { deriveFileKey, encryptChunkWithPrefix, cryptoRandomBytes } from '../lib/crypto/core';
import { saveCryptoSession } from '../lib/crypto/session';
import { FILE_CHUNK_SIZE } from '../lib/crypto/constants';
import type { DecryptedAttachment } from '../lib/crypto/messages';

const SPACE = 'space-dl';
const ATTACHMENT_ID = 'att-dl-1';
const MASTER = bytesToBase64url(hexToBytes('44'.repeat(32)));
const FILE_KEY = bytesToBase64url(deriveFileKey(MASTER, ATTACHMENT_ID));
const PREFIX = bytesToBase64url(cryptoRandomBytes(16));

function makeAttachment(plaintext: Uint8Array, sha256: string): DecryptedAttachment {
  return {
    id: ATTACHMENT_ID,
    filename: 'big-file.bin',
    mime: 'application/octet-stream',
    size: plaintext.length,
    sha256,
    chunkSize: FILE_CHUNK_SIZE,
    chunkCount: Math.max(1, Math.ceil(plaintext.length / FILE_CHUNK_SIZE)),
    noncePrefix: PREFIX,
    downloadUrl: `/api/v1/files/${ATTACHMENT_ID}/download`,
  };
}

function ciphertextFor(plaintext: Uint8Array): Uint8Array {
  // Split into 8 MiB plaintext chunks exactly like the uploader.
  const parts: Uint8Array[] = [];
  for (let off = 0; off < plaintext.length; off += FILE_CHUNK_SIZE) {
    const idx = off / FILE_CHUNK_SIZE;
    const chunk = plaintext.slice(off, off + FILE_CHUNK_SIZE);
    parts.push(encryptChunkWithPrefix(FILE_KEY, SPACE, ATTACHMENT_ID, idx, PREFIX, chunk));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function stubFetch(body: Uint8Array, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Deliver in small pieces to exercise chunk reassembly.
      const step = 33333;
      for (let i = 0; i < body.length; i += step) {
        controller.enqueue(body.slice(i, i + step));
      }
      controller.close();
    },
  });
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(stream, { status }) as Response);
}

class FakeWritable {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;
  async write(data: Uint8Array) {
    this.chunks.push(data.slice());
  }
  async close() {
    this.closed = true;
  }
  async abort() {
    this.aborted = true;
  }
}

describe('encrypted download pipeline', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCryptoSession({
      spaceId: SPACE,
      authKey: bytesToBase64url(new Uint8Array(32).fill(1)),
      messageKey: bytesToBase64url(new Uint8Array(32).fill(2)),
      fileMasterKey: MASTER,
      instanceId: 'inst',
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('decrypts a multi-chunk file with correct plaintext + hash (constant chunks)', async () => {
    const plaintext = new Uint8Array(FILE_CHUNK_SIZE * 2 + 12345);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 31) % 256;
    const sha256 = await sha256Hex(plaintext);
    const att = makeAttachment(plaintext, sha256);

    stubFetch(ciphertextFor(plaintext));
    const writable = new FakeWritable();
    await decryptAttachmentTo(att, writable);

    const joined = new Uint8Array(writable.chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of writable.chunks) {
      joined.set(c, o);
      o += c.length;
    }
    expect(joined.length).toBe(plaintext.length);
    expect(Array.from(joined)).toEqual(Array.from(plaintext));
    // Decrypted in multiple bounded writes, never one giant buffer.
    expect(writable.chunks.length).toBeGreaterThan(1);
  });

  it('fails on hash mismatch (aborts the stream)', async () => {
    const plaintext = new Uint8Array(100).fill(5);
    const wrongHash = '0'.repeat(64);
    stubFetch(ciphertextFor(plaintext));
    const writable = new FakeWritable();
    await expect(decryptAttachmentTo(makeAttachment(plaintext, wrongHash), writable)).rejects.toThrow(
      /Integrity/
    );
    expect(writable.aborted).toBe(true);
  });

  it('fails on tampered ciphertext', async () => {
    const plaintext = new Uint8Array(100).fill(5);
    const sha256 = await sha256Hex(plaintext);
    const ct = ciphertextFor(plaintext);
    ct[ct.length - 2] ^= 0x01;
    stubFetch(ct);
    const writable = new FakeWritable();
    await expect(decryptAttachmentTo(makeAttachment(plaintext, sha256), writable)).rejects.toThrow(
      /decrypt/
    );
  });

  it('fails on HTTP error', async () => {
    const plaintext = new Uint8Array(4).fill(1);
    stubFetch(new Uint8Array(0), 404);
    const writable = new FakeWritable();
    await expect(
      decryptAttachmentTo(makeAttachment(plaintext, 'a'.repeat(64)), writable)
    ).rejects.toThrow(/Download failed/);
  });

  it('blob fallback is bounded and returns the plaintext blob', async () => {
    const plaintext = new TextEncoder().encode('hello fallback');
    const sha256 = await sha256Hex(plaintext);
    stubFetch(ciphertextFor(plaintext));
    const blob = await decryptAttachmentToBlob(makeAttachment(plaintext, sha256));
    // jsdom Blob has no .text(); read via FileReader.
    const text = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsText(blob);
    });
    expect(text).toBe('hello fallback');
  });

  it('downloadViaBlob refuses oversized files', async () => {
    const att = makeAttachment(new Uint8Array(1), 'a'.repeat(64));
    att.size = 200 * 1024 * 1024; // > 128 MiB cap
    const outcome = await downloadViaBlob(att);
    expect(outcome.kind).toBe('unsupported-large');
  });

  it('saveViaPicker: "Save as…" streams decrypted bytes to the user-chosen file', async () => {
    const plaintext = new TextEncoder().encode('save-as via native picker');
    const sha256 = await sha256Hex(plaintext);
    const att = makeAttachment(plaintext, sha256);
    stubFetch(ciphertextFor(plaintext));

    const writable = new FakeWritable();
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => writable });
    const w = window as unknown as { showSaveFilePicker?: unknown };
    w.showSaveFilePicker = picker;

    const outcome = await saveViaPicker(att);
    expect(outcome.kind).toBe('ok');
    // The OS folder/file picker is opened with the attachment filename.
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'big-file.bin' });
    expect(writable.closed).toBe(true);
    const joined = new Uint8Array(writable.chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of writable.chunks) {
      joined.set(c, o);
      o += c.length;
    }
    expect(Array.from(joined)).toEqual(Array.from(plaintext));
  });

  it('saveViaPicker: cancelling the OS dialog is not an error', async () => {
    const plaintext = new TextEncoder().encode('x');
    const sha256 = await sha256Hex(plaintext);
    const w = window as unknown as { showSaveFilePicker?: unknown };
    w.showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const outcome = await saveViaPicker(makeAttachment(plaintext, sha256));
    expect(outcome.kind).toBe('cancelled');
  });

  it('downloadAttachment routes: picker when available, blob download otherwise', async () => {
    const plaintext = new TextEncoder().encode('route test');
    const sha256 = await sha256Hex(plaintext);
    const att = makeAttachment(plaintext, sha256);
    const ciphertext = ciphertextFor(plaintext);

    // One fetch spy; swap the resolved response per path.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const respFor = (body: Uint8Array) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(body);
            c.close();
          },
        }),
        { status: 200 }
      ) as Response;

    // Path A — picker present (secure context, e.g. localhost/HTTPS).
    fetchSpy.mockResolvedValue(respFor(ciphertext));
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => new FakeWritable() });
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = picker;
    await downloadAttachment(att, { saveAs: true });
    expect(picker).toHaveBeenCalled();

    // Path B — no picker (LAN HTTP / other browsers): falls back to the
    // standard download flow instead of failing.
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    fetchSpy.mockResolvedValue(respFor(ciphertext));
    // jsdom has no URL.createObjectURL — install it like a real browser.
    const createUrl = vi.fn().mockReturnValue('blob:mock');
    (URL as { createObjectURL?: unknown }).createObjectURL = createUrl as never;
    (URL as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn() as never;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const outcome = await downloadAttachment(att, { saveAs: true });
    expect(outcome.kind).toBe('ok');
    expect(clickSpy).toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalled();
  });
});

describe('ciphertextChunks reassembly', () => {
  it('yields exactly sized chunks plus a final partial', async () => {
    const body = new Uint8Array(70);
    for (let i = 0; i < 70; i++) body[i] = i;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(body.slice(0, 20));
        c.enqueue(body.slice(20, 55));
        c.enqueue(body.slice(55));
        c.close();
      },
    });
    const out: Uint8Array[] = [];
    for await (const chunk of ciphertextChunks(stream, 32)) out.push(chunk);
    expect(out.map((c) => c.length)).toEqual([32, 32, 6]);
    const joined = new Uint8Array(70);
    let o = 0;
    for (const c of out) {
      joined.set(c, o);
      o += c.length;
    }
    expect(Array.from(joined)).toEqual(Array.from(body));
  });
});

async function sha256Hex(data: Uint8Array): Promise<string> {
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const { bytesToHex } = await import('@noble/hashes/utils.js');
  return bytesToHex(sha256(data));
}
