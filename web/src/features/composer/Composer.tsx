import { useState, useRef, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '../../api';
import { useUploadStore } from '../../stores/upload';
import { Smile, Paperclip, Send, Mic, Image, File } from 'lucide-react';
import styles from './Composer.module.scss';

export function Composer() {
  const [text, setText] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const addTasks = useUploadStore((s) => s.addTasks);

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
    const files: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addTasks(files);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      addTasks(Array.from(files));
    }
    e.target.value = '';
    setPopoverOpen(false);
  };

  return (
    <div className={styles.composer}>
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

        {/* Paperclip button with popover */}
        <div className={styles.attachWrapper}>
          <button
            className={styles.iconBtn}
            onClick={() => setPopoverOpen(!popoverOpen)}
            aria-label="Attach"
          >
            <Paperclip size={22} />
          </button>
          {popoverOpen && (
            <>
              <div className={styles.popoverOverlay} onClick={() => setPopoverOpen(false)} />
              <div className={styles.popover}>
                <button
                  className={styles.popoverItem}
                  onClick={() => {
                    imageInputRef.current?.click();
                  }}
                >
                  <Image size={20} />
                  <span>Photo or Video</span>
                </button>
                <button
                  className={styles.popoverItem}
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                >
                  <File size={20} />
                  <span>File</span>
                </button>
              </div>
            </>
          )}
        </div>

        <input
          ref={imageInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
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
  );
}