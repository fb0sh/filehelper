// Image magic-header checks. The client never trusts the MIME type from
// the encrypted metadata: only files whose first bytes match a known safe
// raster format may be previewed. SVG (and anything else) is always a
// plain file card.

export type SafeImageKind = 'jpeg' | 'png' | 'gif' | 'webp' | null;

/** Inspect the first bytes of a decrypted image. Returns the detected
 * kind, or null when the bytes are not a safe raster image. */
export function detectImageKind(bytes: Uint8Array): SafeImageKind {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return 'png';
  // GIF: GIF87a / GIF89a
  const gif = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (gif === 'GIF' && (bytes[3] === 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61)
    return 'gif';
  // WebP: RIFF .... WEBP
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  return null;
}

const MIME_BY_KIND: Record<NonNullable<SafeImageKind>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Does the decrypted MIME from metadata claim a safe raster type? */
export function isAllowedImageMime(mime: string): boolean {
  return (
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    mime === 'image/gif'
  );
}

export function mimeForKind(kind: NonNullable<SafeImageKind>): string {
  return MIME_BY_KIND[kind];
}
