// Crypto format constants. CRYPTO_VERSION=1 parameters are frozen:
// changing N/r/p, the HKDF info strings, or the envelope format would
// derive different keys and break every existing space. The vector test
// (crypto.test.ts) locks these values forever.

export const CRYPTO_VERSION = 1;

// Client-side KDF (Scrypt) parameters — frozen.
export const SCRYPT_N = 2 ** 16;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEY_LEN = 32; // 32 bytes = 256 bits

// Salt domain: instanceId binds every key to one server install, so the
// same CODE on a different instance yields a different space.
export const SCRYPT_SALT_PREFIX = 'filehelper/v1/scrypt:';

// HKDF domain-separation info strings — frozen.
export const INFO_SPACE_ID = 'filehelper/v1/space-id';
export const INFO_AUTH = 'filehelper/v1/auth';
export const INFO_MESSAGES = 'filehelper/v1/messages';
export const INFO_FILES = 'filehelper/v1/files';
export const INFO_FILE_KEY = 'filehelper/v1/file';

// spaceId = base64url(first 24 bytes of space_key).
export const SPACE_ID_BYTES = 24;

// Message envelope: "FH1.<nonceB64u>.<ciphertextB64u>".
export const ENVELOPE_PREFIX = 'FH1.';
export const MESSAGE_NONCE_LEN = 24; // XChaCha20 nonce

// Message AAD: filehelper:v1:message:<spaceId>
export function messageAad(spaceId: string): string {
  return `filehelper:v1:message:${spaceId}`;
}

// File chunk constants.
export const FILE_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB plaintext
export const AEAD_TAG = 16; // Poly1305 tag
export const FILE_NONCE_PREFIX_LEN = 16; // random per-file prefix
export const FILE_NONCE_LEN = 24; // prefix || uint64_be(chunkIndex)

// Chunk AAD: filehelper:v1:file:<spaceId>:<attachmentId>:<chunkIndex>
export function fileChunkAad(
  spaceId: string,
  attachmentId: string,
  chunkIndex: number
): string {
  return `filehelper:v1:file:${spaceId}:${attachmentId}:${chunkIndex}`;
}

// Limits.
export const MAX_MESSAGE_TEXT = 64 * 1024; // 64 KiB plaintext text
export const MAX_CAPTION_LEN = 4096; // attachment caption (Telegram uses 1024; be generous)
export const MAX_FILENAME_LEN = 255;
export const IMAGE_PREVIEW_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
export const BLOB_DOWNLOAD_MAX_BYTES = 128 * 1024 * 1024; // 128 MiB

// Image preview cache budget (~128 MiB, LRU).
export const IMAGE_CACHE_MAX_BYTES = 128 * 1024 * 1024;
