// Single-context-menu guarantee: at most one message context menu is open
// at a time. MessageBubble registers its close callback while its menu is
// open; opening a new menu first closes any existing one. This is
// deterministic (no reliance on native event order, which differs between
// browsers and test environments).
type CloseHandler = () => void;
let activeClose: CloseHandler | null = null;

export function registerMenuClose(close: CloseHandler): () => void {
  activeClose = close;
  return () => {
    if (activeClose === close) activeClose = null;
  };
}

export function closeOpenMenu(): void {
  activeClose?.();
}
