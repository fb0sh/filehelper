import { useState, MouseEvent } from 'react';
import { Message } from '../../../api';
import { TextMessage } from './TextMessage';
import { FileMessage } from './FileMessage';
import { ImageMessage } from './ImageMessage';
import { VideoMessage } from './VideoMessage';
import { AudioMessage } from './AudioMessage';
import { ContextMenu } from '../../../components/menu/ContextMenu';
import styles from './MessageBubble.module.scss';

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCopy = async () => {
    if (message.text) {
      await navigator.clipboard.writeText(message.text);
    } else if (message.attachment?.filename) {
      await navigator.clipboard.writeText(message.attachment.filename);
    }
  };

  const handleSaveAs = () => {
    const att = message.attachment;
    if (!att) return;
    const a = document.createElement('a');
    a.href = att.downloadUrl;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const menuItems = [];
  if (message.text) {
    menuItems.push({ label: 'Copy', onClick: handleCopy });
  }
  if (message.attachment) {
    menuItems.push({ label: 'Copy filename', onClick: handleCopy });
    menuItems.push({ label: 'Save as', onClick: handleSaveAs });
  }

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
    <>
      <div
        className={styles.wrapper}
        style={{ animation: 'messageAppear 0.2s ease-out' }}
        onContextMenu={handleContextMenu}
      >
        {renderContent()}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}