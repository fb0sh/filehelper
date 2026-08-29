import { useEffect } from 'react';
import { ChatHeader } from './ChatHeader';
import { MessageList, MessageListHandle } from './MessageList';
import { Composer } from '../composer/Composer';
import { useSearchStore } from '../../stores/search';
import { useRef } from 'react';
import styles from './Chat.module.scss';

export function Chat() {
  const listRef = useRef<MessageListHandle>(null);
  const jumpRequest = useSearchStore((s) => s.jumpRequest);
  const clearJump = useSearchStore((s) => s.clearJump);

  // Search result clicked → jump to the message in the list.
  useEffect(() => {
    if (jumpRequest) {
      listRef.current?.jumpToMessage(jumpRequest.message);
      clearJump();
    }
  }, [jumpRequest, clearJump]);

  return (
    <div className={styles.chat}>
      <ChatHeader />
      <MessageList ref={listRef} />
      <Composer />
    </div>
  );
}