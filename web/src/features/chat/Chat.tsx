import { useEffect } from 'react';
import { ChatHeader } from './ChatHeader';
import { MessageList, MessageListHandle } from './MessageList';
import { Composer } from '../composer/Composer';
import { SelectionPlate } from '../selection/SelectionPlate';
import { useSearchStore } from '../../stores/search';
import { useSelectionStore } from '../../stores/selection';
import { useRef } from 'react';
import styles from './Chat.module.scss';

export function Chat() {
  const listRef = useRef<MessageListHandle>(null);
  const jumpRequest = useSearchStore((s) => s.jumpRequest);
  const clearJump = useSearchStore((s) => s.clearJump);
  const setSearchOpen = useSearchStore((s) => s.setOpen);
  const selectionActive = useSelectionStore((s) => s.active);
  const exitSelection = useSelectionStore((s) => s.exit);

  // Search result clicked → jump to the message in the list.
  useEffect(() => {
    if (jumpRequest) {
      listRef.current?.jumpToMessage(jumpRequest.message);
      clearJump();
    }
  }, [jumpRequest, clearJump]);

  // Entering selection closes the topbar search; the two modes never stack.
  useEffect(() => {
    if (selectionActive) setSearchOpen(false);
  }, [selectionActive, setSearchOpen]);

  // Escape: cancel selection first; mobile Back: selection → sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectionActive) {
        e.preventDefault();
        exitSelection();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectionActive, exitSelection]);

  return (
    <div className={styles.chat} data-tg="chat">
      <ChatHeader />
      <MessageList ref={listRef} />
      {selectionActive ? <SelectionPlate /> : <Composer />}
    </div>
  );
}
