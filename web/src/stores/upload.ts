import { create } from 'zustand';

export interface UploadTask {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  loaded: number;
  total: number;
  speed: number;
  error?: string;
  xhr?: XMLHttpRequest;
  messageId?: string;
}

interface UploadState {
  tasks: UploadTask[];
  maxConcurrent: number;
  addTasks: (files: File[]) => void;
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
  maxConcurrent: 3,

  addTasks: (files) => {
    const newTasks: UploadTask[] = files.map((file) => ({
      id: `tmp:${crypto.randomUUID()}`,
      file,
      status: 'queued' as const,
      progress: 0,
      loaded: 0,
      total: file.size,
      speed: 0,
    }));
    set((s) => ({ tasks: [...s.tasks, ...newTasks] }));
    // Trigger processing
    setTimeout(() => get().processQueue(), 0);
  },

  updateTask: (id, update) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...update } : t)),
    })),

  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  cancelTask: (id) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (task?.xhr) {
      task.xhr.abort();
    }
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status: 'cancelled' as const } : t
      ),
    }));
    // Process next queued task
    setTimeout(() => get().processQueue(), 0);
  },

  retryTask: (id) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, status: 'queued' as const, progress: 0, loaded: 0, speed: 0, error: undefined }
          : t
      ),
    }));
    setTimeout(() => get().processQueue(), 0);
  },

  cancelAll: () => {
    const state = get();
    state.tasks.forEach((t) => {
      if (t.xhr) t.xhr.abort();
    });
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.status === 'uploading' || t.status === 'queued'
          ? { ...t, status: 'cancelled' as const }
          : t
      ),
    }));
  },

  getActiveCount: () =>
    get().tasks.filter((t) => t.status === 'uploading' || t.status === 'queued').length,

  getUploadingCount: () =>
    get().tasks.filter((t) => t.status === 'uploading').length,

  // Internal: process the upload queue
  processQueue: () => {
    // This is set from outside by the upload manager hook
    const processFn = (useUploadStore as any).__processFn;
    if (processFn) processFn();
  },
}));

// Set the process function
export function setUploadProcessFn(fn: () => void) {
  (useUploadStore as any).__processFn = fn;
}