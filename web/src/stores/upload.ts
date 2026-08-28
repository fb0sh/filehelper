import { create } from 'zustand';

export interface UploadTask {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  loaded: number;
  total: number;
  speed: number; // bytes per second
  error?: string;
  xhr?: XMLHttpRequest;
  messageId?: string;
}

interface UploadState {
  tasks: UploadTask[];
  addTask: (task: UploadTask) => void;
  updateTask: (id: string, update: Partial<UploadTask>) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  getActiveCount: () => number;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  tasks: [],
  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
  updateTask: (id, update) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...update } : t)),
    })),
  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  cancelTask: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (task?.xhr) {
      task.xhr.abort();
    }
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status: 'cancelled' as const } : t
      ),
    }));
  },
  getActiveCount: () => get().tasks.filter((t) => t.status === 'uploading' || t.status === 'queued').length,
}));