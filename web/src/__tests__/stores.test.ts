import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSelectionStore } from '../stores/selection';
import { useSearchStore } from '../stores/search';
import { useUploadStore } from '../stores/upload';

describe('selection store', () => {
  beforeEach(() => {
    useSelectionStore.setState({ active: false, selectedIds: new Set() });
  });

  it('enter with an id selects exactly that message and activates mode', () => {
    useSelectionStore.getState().enter('a');
    const s = useSelectionStore.getState();
    expect(s.active).toBe(true);
    expect(s.selectedIds.has('a')).toBe(true);
    expect(s.count()).toBe(1);
  });

  it('toggle adds and removes in O(1) via Set', () => {
    const { toggle } = useSelectionStore.getState();
    toggle('a');
    toggle('b');
    toggle('a');
    const s = useSelectionStore.getState();
    expect(s.count()).toBe(1);
    expect(s.selectedIds.has('b')).toBe(true);
  });

  it('exit clears everything', () => {
    const { enter, toggle, exit } = useSelectionStore.getState();
    enter('a');
    toggle('b');
    exit();
    const s = useSelectionStore.getState();
    expect(s.active).toBe(false);
    expect(s.count()).toBe(0);
  });
});

describe('search store', () => {
  it('jump requests carry the decrypted message', () => {
    const msg = { id: 'm1' } as never;
    useSearchStore.getState().requestJump(msg);
    expect(useSearchStore.getState().jumpRequest?.message).toBe(msg);
    useSearchStore.getState().clearJump();
    expect(useSearchStore.getState().jumpRequest).toBeNull();
  });
});

describe('upload store', () => {
  beforeEach(() => {
    useUploadStore.setState({ tasks: [] });
  });

  it('adds tasks queued and computes active counts', () => {
    useUploadStore.getState().addTasks([
      new File(['a'], 'a.txt'),
      new File(['b'], 'b.txt'),
    ]);
    const s = useUploadStore.getState();
    expect(s.tasks.length).toBe(2);
    expect(s.tasks.every((t) => t.status === 'queued')).toBe(true);
    expect(s.getActiveCount()).toBe(2);
  });

  it('cancel marks the task cancelled and aborts its controller', () => {
    useUploadStore.getState().addTasks([new File(['x'], 'x.bin')]);
    const id = useUploadStore.getState().tasks[0].id;
    const abort = { abort: () => {} };
    const abortSpy = vi.spyOn(abort, 'abort');
    useUploadStore.getState().updateTask(id, {
      status: 'uploading',
      abortController: abort as unknown as AbortController,
    });
    useUploadStore.getState().cancelTask(id);
    const t = useUploadStore.getState().tasks[0];
    expect(t.status).toBe('cancelled');
    expect(abortSpy).toHaveBeenCalled();
  });

  it('retry resets progress and upload state', () => {
    useUploadStore.getState().addTasks([new File(['y'], 'y.bin')]);
    const id = useUploadStore.getState().tasks[0].id;
    useUploadStore.getState().updateTask(id, {
      status: 'failed',
      error: 'boom',
      uploadId: 'up-1',
      progress: 40,
    });
    useUploadStore.getState().retryTask(id);
    const t = useUploadStore.getState().tasks[0];
    expect(t.status).toBe('queued');
    expect(t.error).toBeUndefined();
    expect(t.uploadId).toBeUndefined();
    expect(t.progress).toBe(0);
  });
});
