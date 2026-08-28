import { describe, it, expect, beforeEach } from 'vitest';
import { useUploadStore } from '../stores/upload';

describe('useUploadStore', () => {
  beforeEach(() => {
    useUploadStore.setState({ tasks: [] });
  });

  it('adds tasks from files', () => {
    const file = new File([''], 'test.txt');
    useUploadStore.getState().addTasks([file]);
    expect(useUploadStore.getState().tasks).toHaveLength(1);
    expect(useUploadStore.getState().tasks[0].file.name).toBe('test.txt');
    expect(useUploadStore.getState().tasks[0].status).toBe('queued');
  });

  it('adds multiple files at once', () => {
    const files = [
      new File([''], 'a.txt'),
      new File([''], 'b.txt'),
      new File([''], 'c.txt'),
    ];
    useUploadStore.getState().addTasks(files);
    expect(useUploadStore.getState().tasks).toHaveLength(3);
    expect(useUploadStore.getState().tasks.every((t) => t.status === 'queued')).toBe(true);
  });

  it('updates a task', () => {
    useUploadStore.getState().addTasks([new File(['x'], 'test.txt')]);
    const id = useUploadStore.getState().tasks[0].id;
    useUploadStore.getState().updateTask(id, { progress: 50, loaded: 50, status: 'uploading' });
    const task = useUploadStore.getState().tasks[0];
    expect(task.progress).toBe(50);
    expect(task.loaded).toBe(50);
    expect(task.status).toBe('uploading');
  });

  it('removes a task', () => {
    useUploadStore.getState().addTasks([new File([''], 'test.txt')]);
    const id = useUploadStore.getState().tasks[0].id;
    useUploadStore.getState().removeTask(id);
    expect(useUploadStore.getState().tasks).toHaveLength(0);
  });

  it('cancels a task', () => {
    useUploadStore.getState().addTasks([new File([''], 'test.txt')]);
    const id = useUploadStore.getState().tasks[0].id;
    useUploadStore.getState().updateTask(id, { status: 'uploading' });
    useUploadStore.getState().cancelTask(id);
    expect(useUploadStore.getState().tasks[0].status).toBe('cancelled');
  });

  it('retries a failed task', () => {
    useUploadStore.getState().addTasks([new File([''], 'test.txt')]);
    const id = useUploadStore.getState().tasks[0].id;
    useUploadStore.getState().updateTask(id, { status: 'failed', error: 'Network error' });
    useUploadStore.getState().retryTask(id);
    const task = useUploadStore.getState().tasks[0];
    expect(task.status).toBe('queued');
    expect(task.error).toBeUndefined();
  });

  it('counts active and uploading tasks', () => {
    useUploadStore.getState().addTasks([
      new File([''], 'a.txt'),
      new File([''], 'b.txt'),
    ]);
    const [id1, id2] = useUploadStore.getState().tasks.map((t) => t.id);
    useUploadStore.getState().updateTask(id1, { status: 'uploading' });
    expect(useUploadStore.getState().getActiveCount()).toBe(2);
    expect(useUploadStore.getState().getUploadingCount()).toBe(1);
  });

  it('cancels all active tasks', () => {
    useUploadStore.getState().addTasks([
      new File([''], 'a.txt'),
      new File([''], 'b.txt'),
    ]);
    const [id1, id2] = useUploadStore.getState().tasks.map((t) => t.id);
    useUploadStore.getState().updateTask(id1, { status: 'uploading' });
    useUploadStore.getState().cancelAll();
    expect(useUploadStore.getState().tasks.every((t) => t.status === 'cancelled')).toBe(true);
  });
});