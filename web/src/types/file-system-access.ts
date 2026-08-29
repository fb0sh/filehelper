// Minimal declarations for the File System Access API, which is not part
// of older TypeScript DOM libs and is only present in some browsers.
// Runtime capability is detected via `typeof window.showSaveFilePicker`.

export interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

export interface FileSystemWritableFileStreamLike {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
