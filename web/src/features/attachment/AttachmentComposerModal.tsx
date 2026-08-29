import { useEffect, useMemo, useState } from 'react';
import { useUploadStore } from '../../stores/upload';
import { CaptionInput } from './CaptionInput';
import { AttachmentPreviewCard } from './AttachmentPreviewCard';
import { X } from 'lucide-react';
import styles from './AttachmentComposerModal.module.scss';

/**
 * Telegram-style pre-send dialog shown after the user picks files
 * (attach button, drag & drop, or paste). Lets them attach a caption and
 * confirm; sending hands the files + caption to the upload store.
 */
export function AttachmentComposerModal() {
  const pending = useUploadStore((s) => s.pending);
  const addTasks = useUploadStore((s) => s.addTasks);
  const setPending = useUploadStore((s) => s.setPending);
  const [caption, setCaption] = useState('');

  const files = pending ?? [];
  // Local object URLs for instant image previews (revoked on close).
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending]
  );
  useEffect(() => {
    return () => previews.forEach((u) => u && URL.revokeObjectURL(u));
  }, [previews]);

  // Esc closes; the caption input also sends on Enter.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPending(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, setPending]);

  if (!pending || pending.length === 0) return null;

  const singleImage = files.length === 1 && files[0].type.startsWith('image/');
  const title = singleImage ? 'Send Photo' : 'Send File';

  const handleSend = () => {
    addTasks(files, caption.trim() || undefined);
    setPending(null);
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPending(null);
      }}
      role="presentation"
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button
            className={styles.closeBtn}
            onClick={() => setPending(null)}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.body}>
          {singleImage ? (
            <div className={styles.previewWrap}>
              <img src={previews[0]!} alt={files[0].name} className={styles.preview} />
              <span className={styles.previewName}>{files[0].name}</span>
            </div>
          ) : (
            <div className={styles.cards}>
              {files.map((f, i) => (
                <AttachmentPreviewCard key={f.name + i} file={f} preview={previews[i]} />
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <CaptionInput value={caption} onChange={setCaption} onSend={handleSend} />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            aria-label="Send file"
            title="Send"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
