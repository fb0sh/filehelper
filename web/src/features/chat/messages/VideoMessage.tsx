import { Message } from '../../../api';
import { formatMessageTime } from '../../../lib/dates';
import styles from './VideoMessage.module.scss';

interface Props {
  message: Message;
}

export function VideoMessage({ message }: Props) {
  const att = message.attachment;
  if (!att) return null;

  return (
    <div className={styles.bubble}>
      <div className={styles.videoWrapper}>
        <video
          src={att.contentUrl}
          className={styles.video}
          controls
          preload="metadata"
        />
        <div className={styles.overlay}>
          <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
          <span className={styles.check}>✓</span>
        </div>
      </div>
    </div>
  );
}