import { useEffect, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ContextMenu.module.scss';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = () => onClose();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Left-click anywhere and Escape close the menu. (Right-clicking
    // another bubble closes this menu via the context-menu bus in
    // MessageBubble — the bus approach avoids native event-order
    // subtleties and keeps at most one menu open at a time.)
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > vw - 8) adjustedX = vw - rect.width - 8;
      if (rect.bottom > vh - 8) adjustedY = vh - rect.height - 8;
      if (adjustedX < 8) adjustedX = 8;
      if (adjustedY < 8) adjustedY = 8;

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  // Portal to <body>: the message list creates its own stacking context,
  // which would otherwise bury the fixed menu under the composer.
  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`${styles.item} ${item.danger ? styles.danger : ''}`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}