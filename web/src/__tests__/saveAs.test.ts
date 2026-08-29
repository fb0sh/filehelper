import { describe, it, expect, vi, afterEach } from 'vitest';
import { supportsSaveAs, saveFileAs } from '../lib/saveAs';

function installPicker(writable?: WritableStream) {
  const picker = vi.fn(async () => ({
    createWritable: vi.fn(async () => writable ?? new WritableStream()),
  }));
  (window as any).showSaveFilePicker = picker;
  return picker;
}

function installStreamingFetch(data: Uint8Array) {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const pipeTo = vi.spyOn(stream, 'pipeTo');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body: stream })));
  return { pipeTo };
}

function collectWritable(): { writes: Uint8Array[]; writable: WritableStream } {
  const writes: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(chunk);
    },
  });
  return { writes, writable };
}

describe('saveFileAs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).showSaveFilePicker;
  });

  it('detects picker support', () => {
    expect(supportsSaveAs()).toBe(false);
    installPicker();
    expect(supportsSaveAs()).toBe(true);
  });

  it('calls showSaveFilePicker with the attachment filename and streams', async () => {
    const { writable } = collectWritable();
    const picker = installPicker(writable);
    installStreamingFetch(new Uint8Array([1, 2, 3]));

    await saveFileAs('/api/v1/files/x/download', 'project.zip');

    expect(picker).toHaveBeenCalledWith({ suggestedName: 'project.zip' });
  });

  it('streams the body into the writable instead of buffering the whole file', async () => {
    const { writes, writable } = collectWritable();
    installPicker(writable);
    const { pipeTo } = installStreamingFetch(new Uint8Array([9, 9]));

    await saveFileAs('/x', 'a.bin');

    expect(pipeTo).toHaveBeenCalled();
    // The bytes flowed through the pipe (constant memory, no buffering).
    expect(writes.length).toBeGreaterThan(0);
  });

  it('sends the auth cookie (same-origin credentials)', async () => {
    const { writable } = collectWritable();
    installPicker(writable);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, body: stream }));
    vi.stubGlobal('fetch', fetchMock);

    await saveFileAs('/api/v1/files/a/download', 'a.txt');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/a/download', { credentials: 'same-origin' });
  });

  it('aborts the writable on error', async () => {
    const abort = vi.fn(async () => {});
    const writable = new WritableStream({ write() {}, abort } as any);
    installPicker(writable);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, body: null })));

    await expect(saveFileAs('/x', 'a.bin')).rejects.toThrow();
    expect(abort).toHaveBeenCalled();
  });
});