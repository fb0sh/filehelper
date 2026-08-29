import { formatBytes } from '../../lib/bytes';
import { getFileIconLabel, getFileIconColor } from '../../lib/mime';
import { Film, Music } from 'lucide-react';
import styles from './AttachmentPreviewCard.module.scss';

interface Props {
  file: File;
  /** Blob URL when the file is a previewable image, else null. */
  preview: string | null;
}

/** File/photo card shown inside the pre-send dialog. */
export function AttachmentPreviewCard({ file, preview }: Props) {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const isAudio = file.type.startsWith('audio/');

  if (isImage && preview) {
    return (
      <div className={styles.imageCard}>
        <img src={preview} alt={file.name} className={styles.image} />
        <div className={styles.imageMeta}>
          <span className={styles.name}>{file.name}</span>
          <span className={styles.size}>{formatBytes(file.size)}</span>
        </div>
      </div>
    );
  }

  const label = isVideo ? 'VIDEO' : isAudio ? 'AUDIO' : getFileIconLabel(file.name);
  const color = isVideo ? '#5c6bc0' : isAudio ? '#26a69a' : getFileIconColor(label);

  return (
    <div className={styles.card}>
      <div className={styles.icon} style={{ background: color }}>
        {isVideo ? <Film size={20} /> : isAudio ? <Music size={20} /> : (
          <span className={styles.iconLabel}>{label}</span>
        )}
      </div>
      <div className={styles.meta}>
        <span className={styles.name}>{file.name}</span>
        <span className={styles.size}>{formatBytes(file.size)}</span>
      </div>
    </div>
  );
}
