import { KeyboardEvent, useRef } from 'react';
import { MAX_CAPTION_LEN } from '../../lib/crypto/constants';
import styles from './CaptionInput.module.scss';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}

/** Telegram-style caption input: pill surface, auto-grow, Enter sends. */
export function CaptionInput({ value, onChange, onSend }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleInput = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className={styles.inputWrap}>
      <textarea
        ref={ref}
        className={styles.input}
        placeholder="Add a caption…"
        aria-label="Add a caption"
        value={value}
        rows={1}
        maxLength={MAX_CAPTION_LEN}
        onChange={(e) => onChange(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        autoFocus
      />
    </div>
  );
}
