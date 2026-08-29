// Encrypted chunked upload pipeline. For each file:
//   init upload → derive file key → encrypt chunks (worker) → PUT chunk
//   → incremental plaintext SHA-256 → complete with encrypted message.
// Memory is bounded per chunk (8 MiB) — never the whole file.

import { useEffect, useRef } from 'react';
import { useUploadStore } from '../stores/upload';
import { messageKeys, uploadsApi } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { setUploadProcessFn } from '../stores/upload';
import { FILE_CHUNK_SIZE } from '../lib/crypto/constants';
import { loadCryptoSession } from '../lib/crypto/session';
import { cryptoClient } from '../lib/crypto/workerClient';
import { cryptoRandomBytes } from '../lib/crypto/core';
import { bytesToBase64url } from '../lib/crypto/encoding';
import { encryptMessagePayload } from '../lib/crypto/messages';

export function useUploadManager() {
  const queryClient = useQueryClient();
  const processingRef = useRef(false);

  useEffect(() => {
    setUploadProcessFn(() => {
      if (processingRef.current) return;
      processNext();
    });

    return () => setUploadProcessFn(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processNext = async () => {
    const state = useUploadStore.getState();
    const uploading = state.getUploadingCount();
    const available = state.maxConcurrent - uploading;
    if (available <= 0) return;

    const queued = state.tasks.filter((t) => t.status === 'queued');
    const batch = queued.slice(0, available);
    if (batch.length === 0) return;

    processingRef.current = true;

    for (const task of batch) {
      const { updateTask } = useUploadStore.getState();
      updateTask(task.id, { status: 'encrypting' });
      void uploadOne(task.id)
        .then((messageId) => {
          useUploadStore.getState().updateTask(task.id, {
            status: 'completed',
            progress: 100,
            messageId,
          });
          queryClient.invalidateQueries({ queryKey: messageKeys.infinite });
          queryClient.invalidateQueries({ queryKey: messageKeys.latest });
        })
        .catch((err) => {
          const stateNow = useUploadStore.getState();
          const t = stateNow.tasks.find((x) => x.id === task.id);
          // Cancelled tasks already carry their final status.
          if (t?.status === 'cancelled') return;
          useUploadStore.getState().updateTask(task.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Upload failed',
          });
          // Best-effort server-side cleanup.
          if (t?.uploadId) {
            fetch(`/api/v1/uploads/${t.uploadId}`, { method: 'DELETE' }).catch(() => {});
          }
        })
        .finally(() => {
          processingRef.current = false;
          const st = useUploadStore.getState();
          if (st.tasks.some((x) => x.status === 'queued')) {
            setTimeout(() => st.processQueue(), 100);
          }
        });
    }
  };
}

async function uploadOne(taskId: string): Promise<string> {
  const task = useUploadStore.getState().tasks.find((t) => t.id === taskId);
  if (!task) throw new Error('task gone');
  const { file } = task;
  const session = loadCryptoSession();
  if (!session) throw new Error('No crypto session');

  const updateTask = useUploadStore.getState().updateTask;
  const abortController = new AbortController();
  updateTask(taskId, { abortController, status: 'uploading' });

  // 1. init
  const init = await uploadsApi.init();
  updateTask(taskId, { uploadId: init.uploadId, attachmentId: init.attachmentId });

  // 2. per-file key + nonce prefix
  const fileKey = await cryptoClient.deriveFileKey(session.fileMasterKey, init.attachmentId);
  const noncePrefix = bytesToBase64url(cryptoRandomBytes(16));
  await cryptoClient.hashInit(init.attachmentId);

  // 3. sequential encrypted chunks
  let plaintextBytes = 0;
  const total = file.size;
  let index = 0;
  for (let offset = 0; offset < total; offset += FILE_CHUNK_SIZE) {
    const chunk = file.slice(offset, Math.min(offset + FILE_CHUNK_SIZE, total));
    const plaintext = new Uint8Array(await chunk.arrayBuffer());
    const ciphertext = await cryptoClient.encryptChunk(
      fileKey,
      session.spaceId,
      init.attachmentId,
      index,
      noncePrefix,
      plaintext
    );

    // Hash the plaintext before upload so the worker's memory stays
    // bounded and the hash covers the exact bytes being sent.
    await cryptoClient.hashUpdate(init.attachmentId, plaintext);

    const chunkStart = Date.now();
    await uploadsApi.chunk(init.uploadId, index, ciphertext, abortController.signal);
    plaintextBytes += plaintext.length;
    const progress = Math.min(99, Math.round((offset + plaintext.length) / total * 100));
    const dt = Math.max(1, Date.now() - chunkStart) / 1000;
    updateTask(taskId, {
      loaded: plaintextBytes,
      total,
      progress,
      speed: dt > 0 ? plaintext.length / dt : 0,
    });
    index += 1;
  }

  // 4. integrity + complete
  const sha256 = await cryptoClient.hashFinal(init.attachmentId);
  const payload = encryptMessagePayload(session.messageKey, session.spaceId, {
    type: 'file',
    file: {
      attachmentId: init.attachmentId,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: total,
      sha256,
      chunkSize: FILE_CHUNK_SIZE,
      noncePrefix,
      chunkCount: index,
      caption: task.caption?.trim() || undefined,
    },
  });

  const created = await uploadsApi.complete(init.uploadId, payload);
  return created.id;
}
