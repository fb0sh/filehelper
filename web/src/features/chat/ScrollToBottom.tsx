import { ChevronDown } from 'lucide-react';
import styles from './ScrollToBottom.module.scss';

interface Props {
  visible: boolean;
  newMessageCount: number;
  onClick: () => void;
}

export function ScrollToBottom({ visible, newMessageCount, onClick }: Props) {
  if (!visible) return null;

  const label =
    newMessageCount > 0
      ? `Scroll to bottom, ${newMessageCount} new messages`
      : 'Scroll to bottom';

  return (
    <button className={styles.btn} onClick={onClick} aria-label={label}>
      <ChevronDown size={22} />
      {newMessageCount > 0 && (
        <span className={styles.badge}>
          {newMessageCount > 99 ? '99+' : newMessageCount}
        </span>
      )}
    </button>
  );
}