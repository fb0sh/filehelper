import { Message } from '../../../api';
import { formatMessageTime } from '../../../lib/dates';
import { formatBytes } from '../../../lib/bytes';
import { Play, Pause } from 'lucide-react';
import { useState, useRef } from 'react';
import styles from './AudioMessage.module.scss';

interface Props {
  message: Message;
}

export function AudioMessage({ message }: Props) {
  const att = message.attachment;
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  if (!att) return null;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  return (
    <div className={styles.bubble}>
      <button className={styles.playBtn} onClick={togglePlay}>
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className={styles.info}>
        <div className={styles.filename}>{att.filename}</div>
        <div className={styles.size}>{formatBytes(att.size)}</div>
      </div>
      <div className={styles.meta}>
        <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
        <span className={styles.check}>✓</span>
      </div>
      <audio ref={audioRef} src={att.contentUrl} onEnded={() => setPlaying(false)} />
    </div>
  );
}