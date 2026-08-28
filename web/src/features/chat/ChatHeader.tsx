import { useRealtimeStore } from '../../stores/realtime';
import styles from './ChatHeader.module.scss';

export function ChatHeader() {
  const { status } = useRealtimeStore();
  const subtitle = status === 'disconnected' ? 'Connecting...' : 'file transfer assistant';

  return (
    <div className={styles.header}>
      <div className={styles.avatar}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      </div>
      <div className={styles.info}>
        <div className={styles.name}>FileHelper</div>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
    </div>
  );
}