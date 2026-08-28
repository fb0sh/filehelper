import { ChevronDown } from 'lucide-react';
import styles from './ScrollToBottom.module.scss';

interface Props {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottom({ visible, onClick }: Props) {
  if (!visible) return null;

  return (
    <button className={styles.btn} onClick={onClick} aria-label="Scroll to bottom">
      <ChevronDown size={22} />
    </button>
  );
}