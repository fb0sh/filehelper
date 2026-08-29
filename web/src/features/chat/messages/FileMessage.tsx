import { Message } from '../../../api';
import { formatMessageTime } from '../../../lib/dates';
import { formatBytes } from '../../../lib/bytes';
import { getFileIconLabel, getFileIconColor } from '../../../lib/mime';
import { Download } from 'lucide-react';
import { triggerDownload } from '../../../lib/download';
import styles from './FileMessage.module.scss';

interface Props {
  message: Message;
}

export function FileMessage({ message }: Props) {
  const att = message.attachment;
  if (!att) return null;

  const label = getFileIconLabel(att.filename);
  const color = getFileIconColor(label);

  const handleDownload = () => {
    triggerDownload(att.downloadUrl);
  };

  return (
    <div className={styles.bubble} onClick={handleDownload}>
      <div className={styles.icon} style={{ background: color }}>
        <span className={styles.iconLabel}>{label}</span>
      </div>
      <div className={styles.info}>
        <div className={styles.filename}>{att.filename}</div>
        <div className={styles.size}>{formatBytes(att.size)}</div>
      </div>
      <div className={styles.actions}>
        <button className={styles.downloadBtn} onClick={(e) => { e.stopPropagation(); handleDownload(); }} aria-label="Download">
          <Download size={18} />
        </button>
        <div className={styles.meta}>
          <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
          <span className={styles.check}>✓</span>
        </div>
      </div>
    </div>
  );
}