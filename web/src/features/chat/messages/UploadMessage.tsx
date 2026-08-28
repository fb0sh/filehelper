import { UploadTask } from '../../../stores/upload';
import { formatBytes, formatSpeed } from '../../../lib/bytes';
import { getFileIconLabel, getFileIconColor } from '../../../lib/mime';
import { X, RefreshCw } from 'lucide-react';
import styles from './UploadMessage.module.scss';

interface Props {
  task: UploadTask;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

export function UploadMessage({ task, onCancel, onRetry }: Props) {
  const label = getFileIconLabel(task.file.name);
  const color = getFileIconColor(label);
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';
  const isCompleted = task.status === 'completed';
  const isUploading = task.status === 'uploading';

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (task.progress / 100) * circumference;

  return (
    <div className={`${styles.bubble} ${isFailed ? styles.failed : ''} ${isCancelled ? styles.cancelled : ''} ${isCompleted ? styles.completed : ''}`}>
      <div className={styles.icon} style={{ background: color }}>
        {isUploading ? (
          <svg width="44" height="44" viewBox="0 0 44 44" className={styles.progressRing}>
            <circle cx="22" cy="22" r={radius} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
            <circle
              cx="22" cy="22" r={radius}
              fill="none" stroke="white" strokeWidth="2.5"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 22 22)"
              className={styles.progressFill}
            />
            <text x="22" y="26" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">
              {task.progress}%
            </text>
          </svg>
        ) : (
          <span className={styles.iconLabel}>{label}</span>
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.filename}>{task.file.name}</div>
        {isUploading && (
          <div className={styles.details}>
            <span>{formatBytes(task.loaded)} / {formatBytes(task.total)}</span>
            {task.speed > 0 && <span className={styles.speed}>{formatSpeed(task.speed)}</span>}
          </div>
        )}
        {isFailed && <div className={styles.error}>{task.error || 'Upload failed'}</div>}
        {isCompleted && <div className={styles.status}>Uploaded</div>}
        {isCancelled && <div className={styles.status}>Cancelled</div>}
      </div>
      <div className={styles.actions}>
        {isUploading && (
          <button className={styles.cancelBtn} onClick={() => onCancel(task.id)} aria-label="Cancel">
            <X size={16} />
          </button>
        )}
        {isFailed && (
          <button className={styles.retryBtn} onClick={() => onRetry(task.id)} aria-label="Retry">
            <RefreshCw size={16} />
          </button>
        )}
      </div>
    </div>
  );
}