import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from '../composer/Composer';
import { Message } from '../../api';
import { useRef } from 'react';
import styles from './Chat.module.scss';

export function Chat() {
  const messageListRef = useRef<{ jumpToMessage: (msg: Message) => void }>(null);

  return (
    <div className={styles.chat}>
      <ChatHeader onJumpToMessage={(msg) => messageListRef.current?.jumpToMessage(msg)} />
      <MessageList ref={messageListRef} />
      <Composer />
    </div>
  );
}