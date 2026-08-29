import { API_BASE } from './client';
import { Message } from './messages';

export interface UploadOptions {
  file: File;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export function uploadFile({ file, onProgress, signal }: UploadOptions): Promise<Message> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/uploads`);
    xhr.setRequestHeader('X-FileHelper-Request', '1');
    
    const formData = new FormData();
    formData.append('file', file);
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };
    
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error?.message || 'Upload failed'));
        } catch {
          reject(new Error('Upload failed'));
        }
      }
    };
    
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }
    
    xhr.send(formData);
  });
}