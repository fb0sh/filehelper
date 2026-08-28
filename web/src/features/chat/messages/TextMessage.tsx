import { Message } from '../../../api';
import { formatMessageTime } from '../../../lib/dates';
import styles from './TextMessage.module.scss';

interface Props {
  message: Message;
}

export function TextMessage({ message }: Props) {
  return (
    <div className={styles.bubble}>
      <div className={styles.text}>{message.text}</div>
      <div className={styles.meta}>
        <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
        <span className={styles.check}>✓</span>
      </div>
    </div>
  );
}