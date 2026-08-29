import { useState, MouseEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Message, messagesApi, messageKeys } from '../../../api';
import { TextMessage } from './TextMessage';
import { FileMessage } from './FileMessage';
import { ImageMessage } from './ImageMessage';
import { VideoMessage } from './VideoMessage';
import { AudioMessage } from './AudioMessage';
import { ContextMenu } from '../../../components/menu/ContextMenu';
import { triggerDownload } from '../../../lib/download';
import { saveFileAs, supportsSaveAs } from '../../../lib/saveAs';
import { Download, Save, Trash2, Copy } from 'lucide-react';
import styles from './MessageBubble.module.scss';

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => messagesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.infinite });
      queryClient.invalidateQueries({ queryKey: messageKeys.latest });
    },
  });

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

  const handleDownload = () => {
    const att = message.attachment;
    if (!att) return;
    triggerDownload(att.downloadUrl);
  };

  // Only offered when the browser really supports the native picker.
  const canSaveAs = message.attachment !== null && supportsSaveAs();

  const handleSaveAs = () => {
    const att = message.attachment;
    if (!att || !supportsSaveAs()) return;
    // Picker must be invoked synchronously inside the click gesture.
    saveFileAs(att.downloadUrl, att.filename).catch(() => {
      // user cancelled the picker or the stream failed — nothing to show
    });
  };

  const handleDelete = () => {
    if (window.confirm('Delete this message?')) {
      deleteMutation.mutate(message.id);
    }
  };

  const menuItems = [];
  if (message.text) {
    menuItems.push({ label: 'Copy', icon: <Copy size={16} />, onClick: handleCopy });
  } else if (message.attachment) {
    menuItems.push({ label: 'Copy filename', icon: <Copy size={16} />, onClick: handleCopy });
  }
  if (message.attachment) {
    menuItems.push({ label: 'Download', icon: <Download size={16} />, onClick: handleDownload });
    if (canSaveAs) {
      menuItems.push({ label: 'Save as…', icon: <Save size={16} />, onClick: handleSaveAs });
    }
  }
  menuItems.push({ label: 'Delete', icon: <Trash2 size={16} />, danger: true, onClick: handleDelete });

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