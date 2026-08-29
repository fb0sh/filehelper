import { describe, it, expect, beforeEach } from 'vitest';
import { detectImageKind, isAllowedImageMime } from '../lib/imageMagic';
import { imagePreviewCache } from '../lib/imagePreviewCache';
import { canPreviewImage } from '../lib/imagePreview';
import { IMAGE_PREVIEW_MAX_BYTES } from '../lib/crypto/constants';
import type { DecryptedAttachment } from '../lib/crypto/messages';

const att = (over: Partial<DecryptedAttachment> = {}): DecryptedAttachment => ({
  id: 'a1',
  filename: 'x.png',
  mime: 'image/png',
  size: 100,
  sha256: 'a'.repeat(64),
  chunkSize: 8 * 1024 * 1024,
  chunkCount: 1,
  noncePrefix: 'A'.repeat(22),
  downloadUrl: '/api/v1/files/a1/download',
  ...over,
});

describe('magic header detection', () => {
  it('detects safe raster formats', () => {
    expect(detectImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(detectImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('png');
    expect(detectImageKind(new TextEncoder().encode('GIF89a123456'))).toBe('gif');
    expect(detectImageKind(new TextEncoder().encode('RIFFxxxxWEBP'))).toBe('webp');
  });

  it('rejects SVG, HTML and unknown bytes', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect(detectImageKind(new TextEncoder().encode(svg))).toBeNull();
    const html = '<html><body>evil</body></html>';
    expect(detectImageKind(new TextEncoder().encode(html))).toBeNull();
    expect(detectImageKind(new TextEncoder().encode('PK\x03\x04zip...'))).toBeNull();
    expect(detectImageKind(new Uint8Array(8))).toBeNull();
  });

  it('short buffers are rejected', () => {
    expect(detectImageKind(new Uint8Array(4))).toBeNull();
  });
});

describe('preview gating', () => {
  it('only safe raster MIME types are previewable', () => {
    expect(canPreviewImage(att({ mime: 'image/png' }))).toBe(true);
    expect(canPreviewImage(att({ mime: 'image/jpeg' }))).toBe(true);
    expect(canPreviewImage(att({ mime: 'image/webp' }))).toBe(true);
    expect(canPreviewImage(att({ mime: 'image/gif' }))).toBe(true);
    expect(canPreviewImage(att({ mime: 'image/svg+xml' }))).toBe(false);
    expect(canPreviewImage(att({ mime: 'application/pdf' }))).toBe(false);
  });

  it('oversized images are never previewed', () => {
    expect(
      canPreviewImage(att({ mime: 'image/png', size: IMAGE_PREVIEW_MAX_BYTES + 1 }))
    ).toBe(false);
    expect(canPreviewImage(att({ mime: 'image/png', size: IMAGE_PREVIEW_MAX_BYTES }))).toBe(true);
  });

  it('isAllowedImageMime excludes svg', () => {
    expect(isAllowedImageMime('image/png')).toBe(true);
    expect(isAllowedImageMime('image/svg+xml')).toBe(false);
    expect(isAllowedImageMime('image/x-icon')).toBe(false);
  });
});

describe('image preview LRU cache', () => {
  beforeEach(() => imagePreviewCache.clear());

  it('stores, serves and revokes URLs', () => {
    const { URL } = globalThis;
    const urls: string[] = [];
    const realCreate = URL.createObjectURL as unknown as (o: object) => string;
    const realRevoke = URL.revokeObjectURL as unknown as (u: string) => void;
    // jsdom lacks createObjectURL; stub it.
    (URL as unknown as { createObjectURL: (o: object) => string }).createObjectURL = () => {
      const u = `blob:test-${urls.length}`;
      urls.push(u);
      return u;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
      urls.push(`revoked:${u}`);
    };

    const url = URL.createObjectURL(new Blob());
    imagePreviewCache.set('a1', url, 10);
    expect(imagePreviewCache.get('a1')).toBe(url);
    expect(imagePreviewCache.byteCount()).toBe(10);

    // Delete revokes.
    imagePreviewCache.delete('a1');
    expect(imagePreviewCache.get('a1')).toBeUndefined();
    expect(urls.some((u) => u.startsWith('revoked:'))).toBe(true);

    (URL as unknown as { createObjectURL: (o: object) => string }).createObjectURL = realCreate;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = realRevoke;
  });

  it('evicts least-recently-used entries over the budget', () => {
    const stub = (id: string) => {
      imagePreviewCache.set(id, `blob:${id}`, 60 * 1024 * 1024);
    };
    stub('a'); // 60 MiB
    stub('b'); // 120 MiB
    // Adding c (180 MiB) exceeds 128 MiB → evicts least recently used (a).
    stub('c');
    expect(imagePreviewCache.get('a')).toBeUndefined();
    expect(imagePreviewCache.get('b')).toBeDefined();
    expect(imagePreviewCache.get('c')).toBeDefined();
  });

  it('clear revokes everything', () => {
    const stub = (id: string) => imagePreviewCache.set(id, `blob:${id}`, 10);
    stub('x');
    stub('y');
    imagePreviewCache.clear();
    expect(imagePreviewCache.size()).toBe(0);
    expect(imagePreviewCache.byteCount()).toBe(0);
  });
});
