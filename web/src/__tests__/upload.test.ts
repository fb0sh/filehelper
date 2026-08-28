import { describe, it, expect, beforeEach } from 'vitest';
import { useUploadStore } from '../stores/upload';

describe('useUploadStore', () => {
  beforeEach(() => {
    useUploadStore.setState({ tasks: [] });
  });

  it('adds a task', () => {
    const task = {
      id: 'test-1',
      file: new File([''], 'test.txt'),
      status: 'uploading' as const,
      progress: 0,
      loaded: 0,
      total: 100,
      speed: 0,
    };
    useUploadStore.getState().addTask(task);
    expect(useUploadStore.getState().tasks).toHaveLength(1);
    expect(useUploadStore.getState().tasks[0].id).toBe('test-1');
  });

  it('updates a task', () => {
    useUploadStore.getState().addTask({
      id: 'test-1',
      file: new File([''], 'test.txt'),
      status: 'uploading' as const,
      progress: 0,
      loaded: 0,
      total: 100,
      speed: 0,
    });
    useUploadStore.getState().updateTask('test-1', { progress: 50, loaded: 50 });
    const task = useUploadStore.getState().tasks[0];
    expect(task.progress).toBe(50);
    expect(task.loaded).toBe(50);
  });

  it('removes a task', () => {
    useUploadStore.getState().addTask({
      id: 'test-1',
      file: new File([''], 'test.txt'),
      status: 'uploading' as const,
      progress: 0,
      loaded: 0,
      total: 100,
      speed: 0,
    });
    useUploadStore.getState().removeTask('test-1');
    expect(useUploadStore.getState().tasks).toHaveLength(0);
  });

  it('counts active tasks', () => {
    useUploadStore.getState().addTask({
      id: 't1',
      file: new File([''], 'a.txt'),
      status: 'uploading' as const,
      progress: 0, loaded: 0, total: 100, speed: 0,
    });
    useUploadStore.getState().addTask({
      id: 't2',
      file: new File([''], 'b.txt'),
      status: 'completed' as const,
      progress: 100, loaded: 100, total: 100, speed: 0,
    });
    expect(useUploadStore.getState().getActiveCount()).toBe(1);
  });
});