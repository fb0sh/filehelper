import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from '../composer/Composer';
import { useUIStore } from '../../stores/ui';
import styles from './Chat.module.scss';

export function Chat() {
  const { mobileChatOpen } = useUIStore();

  return (
    <div className={styles.chat}>
      <ChatHeader />
      <MessageList />
      <Composer />
    </div>
  );
}