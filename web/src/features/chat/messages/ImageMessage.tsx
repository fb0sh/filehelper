import { Message } from '../../../api';
import { formatMessageTime } from '../../../lib/dates';
import { useState } from 'react';
import { MediaViewer } from '../../viewer/MediaViewer';
import styles from './ImageMessage.module.scss';

interface Props {
  message: Message;
}

export function ImageMessage({ message }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const att = message.attachment;
  if (!att) return null;

  return (
    <>
      <div className={styles.bubble} onClick={() => setViewerOpen(true)}>
        <div className={styles.imageWrapper}>
          <img
            src={att.contentUrl}
            alt={att.filename}
            className={styles.image}
            loading="lazy"
          />
          <div className={styles.overlay}>
            <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
            <span className={styles.check}>✓</span>
          </div>
        </div>
      </div>
      {viewerOpen && (
        <MediaViewer
          url={att.contentUrl}
          filename={att.filename}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}