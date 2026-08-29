import { useEffect, useRef } from 'react';
import { useUploadStore } from '../stores/upload';
import { uploadFile, messageKeys } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { setUploadProcessFn } from '../stores/upload';

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
      updateTask(task.id, { status: 'uploading' });

      let lastLoaded = 0;
      let lastTime = Date.now();
      const speedHistory: number[] = [];

      uploadFile({
        file: task.file,
        onProgress: (loaded, total) => {
          const now = Date.now();
          const dt = (now - lastTime) / 1000;
          if (dt > 0.5) {
            const instantSpeed = (loaded - lastLoaded) / dt;
            speedHistory.push(instantSpeed);
            if (speedHistory.length > 5) speedHistory.shift();
            const avgSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
            lastLoaded = loaded;
            lastTime = now;
            updateTask(task.id, {
              loaded,
              total,
              progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
              speed: avgSpeed,
            });
          }
        },
      })
        .then((message) => {
          useUploadStore.getState().updateTask(task.id, {
            status: 'completed',
            progress: 100,
            messageId: message.id,
          });
          queryClient.invalidateQueries({ queryKey: messageKeys.infinite });
      queryClient.invalidateQueries({ queryKey: messageKeys.latest });
        })
        .catch((err) => {
          useUploadStore.getState().updateTask(task.id, {
            status: 'failed',
            error: err.message || 'Upload failed',
          });
        })
        .finally(() => {
          // Process next batch
          processingRef.current = false;
          const state = useUploadStore.getState();
          if (state.tasks.some((t) => t.status === 'queued')) {
            setTimeout(() => processNext(), 100);
          }
        });
    }
  };
}