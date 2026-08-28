import { useState, useRef, useCallback, KeyboardEvent, ChangeEvent, DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi, uploadFile } from '../../api';
import { useUploadStore } from '../../stores/upload';
import { Smile, Paperclip, Send, Mic } from 'lucide-react';
import styles from './Composer.module.scss';

export function Composer() {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { addTask, updateTask } = useUploadStore();

  const sendMutation = useMutation({
    mutationFn: (text: string) => messagesApi.create(text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMutation.mutate(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, sendMutation]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadFiles([file]);
        break;
      }
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadFiles = (files: File[]) => {
    for (const file of files) {
      const taskId = `tmp:${crypto.randomUUID()}`;
      addTask({
        id: taskId,
        file,
        status: 'uploading',
        progress: 0,
        loaded: 0,
        total: file.size,
        speed: 0,
      });

      let lastLoaded = 0;
      let lastTime = Date.now();

      uploadFile({
        file,
        onProgress: (loaded, total) => {
          const now = Date.now();
          const dt = (now - lastTime) / 1000;
          const speed = dt > 0 ? (loaded - lastLoaded) / dt : 0;
          lastLoaded = loaded;
          lastTime = now;
          updateTask(taskId, {
            loaded,
            total,
            progress: total > 0 ? (loaded / total) * 100 : 0,
            speed,
          });
        },
      })
        .then((message) => {
          updateTask(taskId, { status: 'completed', messageId: message.id });
          queryClient.invalidateQueries({ queryKey: ['messages'] });
        })
        .catch((err) => {
          updateTask(taskId, { status: 'failed', error: err.message });
        });
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files) uploadFiles(Array.from(files));
  };

  return (
    <>
      {dragOver && (
        <div
          className={styles.dropOverlay}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className={styles.dropContent}>
            <div className={styles.dropIcon}>
              <Paperclip size={32} />
            </div>
            <div className={styles.dropText}>Drop files here</div>
          </div>
        </div>
      )}
      <div className={styles.composer} onDragOver={handleDragOver}>
        <div className={styles.inner}>
          <button className={styles.iconBtn} aria-label="Emoji">
            <Smile size={22} />
          </button>
          <div className={styles.inputWrapper}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Message"
              rows={1}
            />
          </div>
          <button className={styles.iconBtn} onClick={() => fileInputRef.current?.click()} aria-label="Attach">
            <Paperclip size={22} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {text.trim() ? (
            <button className={styles.sendBtn} onClick={handleSend} aria-label="Send">
              <Send size={20} />
            </button>
          ) : (
            <button className={styles.iconBtn} aria-label="Record">
              <Mic size={22} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}