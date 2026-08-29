import { createPortal } from 'react-dom';
import styles from './LargeDownloadModal.module.scss';

interface Props {
  filename: string;
  onClose: () => void;
}

// Telegram-style modal for the Web Platform limitation: this browser
// cannot stream a large encrypted file to disk over plain HTTP, and the
// Blob fallback is capped. We never degrade to ciphertext downloads.
export function LargeDownloadModal({ filename, onClose }: Props) {
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="alertdialog">
        <div className={styles.title}>Large download not supported in this browser</div>
        <div className={styles.message}>
          <p>
            This browser can't stream a large encrypted file directly to
            disk over this HTTP connection.
          </p>
          <p className={styles.file}>
            <strong>{filename}</strong>
          </p>
          <p>
            For large encrypted downloads, open FileHelper through HTTPS
            in a compatible Chromium browser.
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.closeBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
