import { Message } from '../../../api';
import { TextMessage } from './TextMessage';
import { FileMessage } from './FileMessage';
import { ImageMessage } from './ImageMessage';
import { VideoMessage } from './VideoMessage';
import { AudioMessage } from './AudioMessage';
import styles from './MessageBubble.module.scss';

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const renderContent = () => {
    switch (message.kind) {
      case 'text':
        return <TextMessage message={message} />;
      case 'image':
        return <ImageMessage message={message} />;
      case 'video':
        return <VideoMessage message={message} />;
      case 'audio':
        return <AudioMessage message={message} />;
      case 'document':
      default:
        return <FileMessage message={message} />;
    }
  };

  return (
    <div className={styles.wrapper} style={{ animation: 'messageAppear 0.2s ease-out' }}>
      {renderContent()}
    </div>
  );
}