import { useState, MouseEvent, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../../api';
import { TextMessage } from './TextMessage';
import { FileMessage } from './FileMessage';
import { ImageMessage } from './ImageMessage';
import { ContextMenu } from '../../../components/menu/ContextMenu';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { LargeDownloadModal } from '../../../components/LargeDownloadModal';
import { downloadAttachment } from '../../../lib/fileTransfer';
import { supportsSaveAs } from '../../../lib/saveAs';
import { imagePreviewCache } from '../../../lib/imagePreviewCache';
import { decryptedCache } from '../../../lib/decryptedCache';
import { useSelectionStore } from '../../../stores/selection';
import {
  Check,
  Copy,
  Download,
  Save,
  Square,
  Trash2,
} from 'lucide-react';
import type { DecryptedMessage } from '../../../lib/crypto/messages';
import styles from './MessageBubble.module.scss';

interface Props {
  message: DecryptedMessage;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** Search term highlight for the message content, when search is open. */
  searchQuery?: string;
  /** This message is the active search result (persistent emphasis). */
  searchActive?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  selectedText?: string;
}

export function MessageBubble({ message, selectionMode, selected, onToggleSelect, searchQuery, searchActive }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [largeDownload, setLargeDownload] = useState<{ filename: string } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const enterSelection = useSelectionStore((s) => s.enter);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => messagesApi.delete(id),
    onSuccess: (_, id) => {
      decryptedCache.delete(id);
      imagePreviewCache.delete(id);
      queryClient.invalidateQueries({ queryKey: messageKeys.infinite });
      queryClient.invalidateQueries({ queryKey: messageKeys.latest });
    },
  });

  // Snapshot the browser text selection the moment the menu opens; by
  // the time the user clicks Copy the selection may be gone.
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (selectionMode) {
      // In selection mode the click gesture toggles selection instead.
      onToggleSelect();
      return;
    }
    const sel = window.getSelection();
    let selectedText: string | undefined;
    if (sel && !sel.isCollapsed) {
      const text = sel.toString();
      const wrapper = wrapperRef.current;
      const anchorInside =
        wrapper && sel.anchorNode
          ? wrapper.contains(sel.anchorNode as Node)
          : false;
      if (text.length > 0 && anchorInside) {
        selectedText = text;
      }
    }
    setMenu({ x: e.clientX, y: e.clientY, selectedText });
  };

  const handleClick = () => {
    if (selectionMode) {
      onToggleSelect();
      return;
    }
    // Default click behavior lives in the child components.
  };

  const handleCopy = async () => {
    const target =
      menu?.selectedText ??
      message.text ??
      message.attachment?.filename ??
      '';
    if (target) await navigator.clipboard.writeText(target);
  };

  const handleDownload = () => {
    const att = message.attachment;
    if (!att) return;
    downloadAttachment(att, { saveAs: false }).then((outcome) => {
      if (outcome.kind === 'unsupported-large') {
        setLargeDownload({ filename: att.filename });
      }
    });
  };

  const canSaveAs = message.attachment !== null && supportsSaveAs();

  const handleSaveAs = () => {
    const att = message.attachment;
    if (!att || !supportsSaveAs()) return;
    downloadAttachment(att, { saveAs: true }).then((outcome) => {
      if (outcome.kind === 'unsupported-large') {
        setLargeDownload({ filename: att.filename });
      }
    });
  };

  const handleDelete = () => {
    setConfirmDelete(true);
  };

  const confirmDeleteNow = () => {
    deleteMutation.mutate(message.id);
    setConfirmDelete(false);
  };

  const isImage = message.attachment?.mime.startsWith('image/') ?? false;
  const menuItems = [];
  if (message.text) {
    menuItems.push({
      label: menu?.selectedText ? 'Copy selected text' : 'Copy',
      icon: <Copy size={16} />,
      onClick: () => handleCopy(),
    });
  } else if (message.attachment && !isImage) {
    menuItems.push({
      label: 'Copy filename',
      icon: <Copy size={16} />,
      onClick: () => handleCopy(),
    });
  }
  if (message.attachment) {
    menuItems.push({
      label: 'Download',
      icon: <Download size={16} />,
      onClick: handleDownload,
    });
    if (canSaveAs) {
      menuItems.push({
        label: 'Save as…',
        icon: <Save size={16} />,
        onClick: handleSaveAs,
      });
    }
  }
  if (!selectionMode) {
    menuItems.push({
      label: 'Select',
      icon: <Square size={16} />,
      onClick: () => enterSelection(message.id),
    });
  }
  menuItems.push({
    label: 'Delete',
    icon: <Trash2 size={16} />,
    danger: true,
    onClick: handleDelete,
  });

  const renderContent = () => {
    if (message.undecryptable) {
      return (
        <div className={styles.undecryptable}>
          Unable to decrypt this message
        </div>
      );
    }
    switch (message.type) {
      case 'text':
        return <TextMessage message={message} searchQuery={searchQuery} />;
      case 'file':
        if (isImage) {
          return <ImageMessage message={message} onDownload={handleDownload} searchQuery={searchQuery} />;
        }
        return <FileMessage message={message} onDownload={handleDownload} searchQuery={searchQuery} />;
      default:
        return (
          <div className={styles.undecryptable}>Unable to decrypt this message</div>
        );
    }
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className={`${styles.wrapper} ${selectionMode ? styles.selectable : ''} ${selected ? styles.selected : ''} ${searchActive ? styles.searchActive : ''}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        data-message-wrapper=""
      >
        {selectionMode && (
          <button
            className={`${styles.checkbox} ${selected ? styles.checked : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            aria-label={selected ? 'Deselect message' : 'Select message'}
            aria-pressed={selected}
          >
            {selected && <Check size={14} />}
          </button>
        )}
        {!selectionMode && <span className={styles.checkboxSlot} aria-hidden="true" />}
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

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this message?"
          message="This will permanently delete the selected message and file."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDeleteNow}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {largeDownload && (
        <LargeDownloadModal
          filename={largeDownload.filename}
          onClose={() => setLargeDownload(null)}
        />
      )}
    </>
  );
}
