import {
  FileSystemFileHandleLike,
  FileSystemWritableFileStreamLike,
} from '../types/file-system-access';

// The native "Save as" picker is only available in supporting browsers
// (Chromium, secure contexts). FileHelper often runs over plain
// http://192.168.x.x, so this must be detected at runtime — never show a
// fake Save-as that falls back to a plain download.
export function supportsSaveAs(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  );
}

// Streams a file into a user-chosen location with constant memory.
// `showSaveFilePicker` must be called synchronously inside the user's
// click gesture (before any await), so the picker is invoked first.
export async function saveFileAs(url: string, suggestedName: string): Promise<void> {
  const w = window as unknown as {
    showSaveFilePicker: (opts: { suggestedName: string }) => Promise<FileSystemFileHandleLike>;
  };
  const handle = await w.showSaveFilePicker({ suggestedName });
  const writable: FileSystemWritableFileStreamLike = await handle.createWritable();

  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    if (response.body) {
      // Streaming pipe: constant memory, never buffers the whole file.
      // FileSystemWritableFileStream extends WritableStream, so pipeTo
      // works and closes the file when the body ends.
      await response.body.pipeTo(writable as unknown as WritableStream<Uint8Array>);
    }
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // already aborted/closed
    }
    throw err;
  }
}
