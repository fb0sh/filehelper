// Crypto Web Worker: keeps Scrypt (and all other crypto work) off the
// React main thread. Simple request/response protocol with request ids
// and Transferable ArrayBuffers — no Comlink, no worker pool.
//
//   postMessage({ id, type, data }, [transferables])
//   onmessage  => ({ id, ok: true, ...result } | { id, ok: false, error })

/// <reference lib="webworker" />
import {
  createHasher,
  decryptChunk,
  deriveDomainKeys,
  deriveFileKey,
  encryptChunkWithPrefix,
  encryptMessage,
  decryptMessage,
  hasherFinal,
  hasherUpdate,
  scryptRootKey,
} from '../lib/crypto/core';
import { bytesToBase64url } from '../lib/crypto/encoding';

interface Request {
  id: number;
  type: string;
  [key: string]: unknown;
}

const hashers = new Map<string, ReturnType<typeof createHasher>>();

function reply(
  id: number,
  payload: Record<string, unknown>,
  transfer?: Transferable[]
) {
  (self as unknown as Worker).postMessage({ id, ok: true, ...payload }, transfer ?? []);
}

function fail(id: number, error: unknown) {
  (self as unknown as Worker).postMessage({
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, type } = event.data;
  const d = event.data;
  try {
    switch (type) {
      case 'kdf': {
        const rootKey = await scryptRootKey(String(d.code), String(d.instanceId));
        reply(id, { rootKey: rootKey.buffer as ArrayBuffer }, [rootKey.buffer as ArrayBuffer]);
        break;
      }
      case 'derive': {
        const root = new Uint8Array(d.rootKey as ArrayBuffer);
        const keys = deriveDomainKeys(root);
        reply(id, { keys });
        break;
      }
      case 'encryptMessage': {
        const envelope = encryptMessage(
          String(d.messageKey),
          String(d.spaceId),
          d.message as unknown
        );
        reply(id, { envelope });
        break;
      }
      case 'decryptMessage': {
        const result = decryptMessage(
          String(d.messageKey),
          String(d.spaceId),
          String(d.envelope)
        );
        if (result.ok) reply(id, { message: result.value });
        else fail(id, result.error);
        break;
      }
      case 'deriveFileKey': {
        const fileKey = deriveFileKey(String(d.fileMasterKey), String(d.attachmentId));
        reply(id, { fileKey: bytesToBase64url(fileKey) });
        break;
      }
      case 'encryptChunk': {
        const data = new Uint8Array(d.data as ArrayBuffer);
        const ct = encryptChunkWithPrefix(
          String(d.fileKey),
          String(d.spaceId),
          String(d.attachmentId),
          Number(d.chunkIndex),
          String(d.noncePrefix),
          data
        );
        reply(id, { ciphertext: ct.buffer as ArrayBuffer }, [ct.buffer as ArrayBuffer]);
        break;
      }
      case 'decryptChunk': {
        const data = new Uint8Array(d.data as ArrayBuffer);
        const result = decryptChunk(
          String(d.fileKey),
          String(d.spaceId),
          String(d.attachmentId),
          Number(d.chunkIndex),
          String(d.noncePrefix),
          data
        );
        if (result.ok && result.value) {
          reply(id, { plaintext: result.value.buffer as ArrayBuffer }, [
            result.value.buffer as ArrayBuffer,
          ]);
        } else {
          fail(id, result.error);
        }
        break;
      }
      case 'hashInit': {
        hashers.set(String(d.attachmentId), createHasher());
        reply(id, {});
        break;
      }
      case 'hashUpdate': {
        const hasher = hashers.get(String(d.attachmentId));
        if (!hasher) throw new Error('hash not initialized');
        hasherUpdate(hasher, new Uint8Array(d.data as ArrayBuffer));
        reply(id, {});
        break;
      }
      case 'hashFinal': {
        const hasher = hashers.get(String(d.attachmentId));
        if (!hasher) throw new Error('hash not initialized');
        hashers.delete(String(d.attachmentId));
        reply(id, { sha256: hasherFinal(hasher) });
        break;
      }
      default:
        fail(id, `unknown op: ${type}`);
    }
  } catch (e) {
    fail(id, e);
  }
};
