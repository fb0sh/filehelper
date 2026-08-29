// Typed client for the crypto worker. Lazily creates the worker on first
// use; every call returns a promise resolved by request id. When the
// environment has no Web Worker (tests, exotic browsers), it falls back
// to the same pure functions on the main thread — identical results.
// Messages and chunk buffers are transferred to avoid copies.

import type { DerivedKeys } from './core';
import * as core from './core';
import { bytesToBase64url } from './encoding';

type WorkerLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void;
  terminate(): void;
};

let worker: WorkerLike | null = null;
let syncMode = false;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const syncHashers = new Map<string, ReturnType<typeof core.createHasher>>();

function getWorker(): WorkerLike | null {
  if (worker) return worker;
  if (syncMode) return null;
  try {
    if (typeof Worker === 'undefined') {
      syncMode = true;
      return null;
    }
    const w = new Worker(new URL('../../workers/crypto.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.addEventListener('message', (e: MessageEvent) => {
      const { id, ok, error } = e.data as { id: number; ok: boolean; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(e.data);
      else p.reject(new Error(error ?? 'crypto worker error'));
    });
    w.addEventListener('error', (e) => {
      for (const [, p] of pending) p.reject(new Error(e.message || 'crypto worker crashed'));
      pending.clear();
    });
    worker = w;
    return w;
  } catch {
    syncMode = true;
    return null;
  }
}

function call(type: string, data: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no worker'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...data }, transfer);
  });
}

export interface CryptoClient {
  kdf(code: string, instanceId: string): Promise<Uint8Array>;
  derive(rootKey: Uint8Array): Promise<DerivedKeys>;
  encryptMessage(messageKey: string, spaceId: string, message: unknown): Promise<string>;
  decryptMessage(
    messageKey: string,
    spaceId: string,
    envelope: string
  ): Promise<{ ok: boolean; message?: unknown; error?: string }>;
  deriveFileKey(fileMasterKey: string, attachmentId: string): Promise<string>;
  encryptChunk(
    fileKey: string,
    spaceId: string,
    attachmentId: string,
    chunkIndex: number,
    noncePrefix: string,
    plaintext: Uint8Array
  ): Promise<Uint8Array>;
  decryptChunk(
    fileKey: string,
    spaceId: string,
    attachmentId: string,
    chunkIndex: number,
    noncePrefix: string,
    ciphertext: Uint8Array
  ): Promise<{ ok: boolean; plaintext?: Uint8Array; error?: string }>;
  hashInit(attachmentId: string): Promise<void>;
  hashUpdate(attachmentId: string, data: Uint8Array): Promise<void>;
  hashFinal(attachmentId: string): Promise<string>;
  /** Unlock helper: full CODE → derived keys. */
  unlock(code: string, instanceId: string): Promise<DerivedKeys>;
}

async function syncCall(fn: () => unknown): Promise<any> {
  // Force the fallback path in workerless environments.
  return fn();
}

export const cryptoClient: CryptoClient = {
  async kdf(code, instanceId) {
    if (getWorker()) {
      const r = await call('kdf', { code, instanceId });
      return new Uint8Array(r.rootKey as ArrayBuffer);
    }
    return syncCall(() => core.scryptRootKey(code, instanceId));
  },
  async derive(rootKey) {
    if (getWorker()) {
      const root = rootKey.slice();
      const r = await call('derive', { rootKey: root.buffer }, [root.buffer as ArrayBuffer]);
      return r.keys as DerivedKeys;
    }
    return syncCall(() => core.deriveDomainKeys(rootKey));
  },
  async encryptMessage(messageKey, spaceId, message) {
    if (getWorker()) {
      const r = await call('encryptMessage', { messageKey, spaceId, message });
      return r.envelope as string;
    }
    return syncCall(() => core.encryptMessage(messageKey, spaceId, message));
  },
  async decryptMessage(messageKey, spaceId, envelope) {
    try {
      if (getWorker()) {
        const r = await call('decryptMessage', { messageKey, spaceId, envelope });
        return { ok: true, message: r.message };
      }
      const r = core.decryptMessage(messageKey, spaceId, envelope);
      return r.ok ? { ok: true, message: r.value } : { ok: false, error: r.error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'decrypt failed' };
    }
  },
  async deriveFileKey(fileMasterKey, attachmentId) {
    if (getWorker()) {
      const r = await call('deriveFileKey', { fileMasterKey, attachmentId });
      return r.fileKey as string;
    }
    return syncCall(() => bytesToBase64url(core.deriveFileKey(fileMasterKey, attachmentId)));
  },
  async encryptChunk(fileKey, spaceId, attachmentId, chunkIndex, noncePrefix, plaintext) {
    if (getWorker()) {
      const buf = plaintext.slice().buffer as ArrayBuffer;
      const r = await call(
        'encryptChunk',
        { fileKey, spaceId, attachmentId, chunkIndex, noncePrefix, data: buf },
        [buf]
      );
      return new Uint8Array(r.ciphertext as ArrayBuffer);
    }
    return syncCall(() =>
      core.encryptChunkWithPrefix(
        fileKey,
        spaceId,
        attachmentId,
        chunkIndex,
        noncePrefix,
        plaintext
      )
    );
  },
  async decryptChunk(fileKey, spaceId, attachmentId, chunkIndex, noncePrefix, ciphertext) {
    try {
      if (getWorker()) {
        const buf = ciphertext.slice().buffer as ArrayBuffer;
        const r = await call(
          'decryptChunk',
          { fileKey, spaceId, attachmentId, chunkIndex, noncePrefix, data: buf },
          [buf]
        );
        return { ok: true, plaintext: new Uint8Array(r.plaintext as ArrayBuffer) };
      }
      const r = core.decryptChunk(
        fileKey,
        spaceId,
        attachmentId,
        chunkIndex,
        noncePrefix,
        ciphertext
      );
      return r.ok ? { ok: true, plaintext: r.value } : { ok: false, error: r.error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'decrypt failed' };
    }
  },
  async hashInit(attachmentId) {
    if (getWorker()) {
      await call('hashInit', { attachmentId });
      return;
    }
    syncHashers.set(attachmentId, core.createHasher());
  },
  async hashUpdate(attachmentId, data) {
    if (getWorker()) {
      const buf = data.slice().buffer as ArrayBuffer;
      await call('hashUpdate', { attachmentId, data: buf }, [buf]);
      return;
    }
    const h = syncHashers.get(attachmentId);
    if (!h) throw new Error('hash not initialized');
    core.hasherUpdate(h, data);
  },
  async hashFinal(attachmentId) {
    if (getWorker()) {
      const r = await call('hashFinal', { attachmentId });
      return r.sha256 as string;
    }
    const h = syncHashers.get(attachmentId);
    if (!h) throw new Error('hash not initialized');
    syncHashers.delete(attachmentId);
    return core.hasherFinal(h);
  },
  async unlock(code, instanceId) {
    const rootKey = await this.kdf(code, instanceId);
    return this.derive(rootKey);
  },
};

/** Terminate the worker (used on Lock so no keys linger in memory). */
export function terminateCryptoWorker() {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error('crypto worker terminated'));
  pending.clear();
  syncHashers.clear();
}
