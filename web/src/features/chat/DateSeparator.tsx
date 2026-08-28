import styles from './DateSeparator.module.scss';

interface Props {
  date: string;
}

export function DateSeparator({ date }: Props) {
  return (
    <div className={styles.separator}>
      <span className={styles.pill}>{date}</span>
    </div>
  );
}