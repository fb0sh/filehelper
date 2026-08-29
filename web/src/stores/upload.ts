import { create } from 'zustand';
import { randomUUID } from '../lib/randomId';

export interface UploadTask {
  id: string;
  file: File;
  status: 'queued' | 'encrypting' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  loaded: number;
  total: number;
  speed: number;
  error?: string;
  uploadId?: string;
  attachmentId?: string;
  abortController?: AbortController;
  messageId?: string;
  /** Optional attachment caption, sent with the file message. */
  caption?: string;
}

interface UploadState {
  tasks: UploadTask[];
  maxConcurrent: number;
  /** Files waiting in the pre-send dialog (AttachmentComposerModal). */
  pending: File[] | null;
  addTasks: (files: File[], caption?: string) => void;
  setPending: (files: File[] | null) => void;
  updateTask: (id: string, update: Partial<UploadTask>) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  cancelAll: () => void;
  getActiveCount: () => number;
  getUploadingCount: () => number;
  processQueue: () => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  tasks: [],
  maxConcurrent: 2,
  pending: null,

  addTasks: (files, caption) => {
    const newTasks: UploadTask[] = files.map((file) => ({
      id: `tmp:${randomUUID()}`,
      file,
      status: 'queued' as const,
      progress: 0,
      loaded: 0,
      total: file.size,
      speed: 0,
      caption,
    }));
    set((s) => ({ tasks: [...s.tasks, ...newTasks] }));
    setTimeout(() => get().processQueue(), 0);
  },

  setPending: (files) => set({ pending: files }),

  updateTask: (id, update) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...update } : t)),
    })),

  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  cancelTask: (id) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    task?.abortController?.abort();
    // Best-effort server-side abort.
    if (task?.uploadId) {
      fetch(`/api/v1/uploads/${task.uploadId}`, { method: 'DELETE' }).catch(() => {});
    }
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status: 'cancelled' as const } : t
      ),
    }));
    setTimeout(() => get().processQueue(), 0);
  },

  retryTask: (id) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'queued' as const,
              progress: 0,
              loaded: 0,
              speed: 0,
              error: undefined,
              uploadId: undefined,
              attachmentId: undefined,
              abortController: undefined,
            }
          : t
      ),
    }));
    setTimeout(() => get().processQueue(), 0);
  },

  cancelAll: () => {
    const state = get();
    state.tasks.forEach((t) => {
      t.abortController?.abort();
      if (t.uploadId) {
        fetch(`/api/v1/uploads/${t.uploadId}`, { method: 'DELETE' }).catch(() => {});
      }
    });
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.status === 'uploading' || t.status === 'queued' || t.status === 'encrypting'
          ? { ...t, status: 'cancelled' as const }
          : t
      ),
    }));
  },

  getActiveCount: () =>
    get().tasks.filter((t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'encrypting').length,

  getUploadingCount: () =>
    get().tasks.filter((t) => t.status === 'uploading').length,

  processQueue: () => {
    const processFn = (useUploadStore as unknown as { __processFn?: () => void }).__processFn;
    if (processFn) processFn();
  },
}));

export function setUploadProcessFn(fn: () => void) {
  (useUploadStore as unknown as { __processFn?: () => void }).__processFn = fn;
}
