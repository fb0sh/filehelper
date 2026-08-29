import { create } from 'zustand';
import type { DecryptedMessage } from '../lib/crypto/messages';
import { cancelHistorySearch } from '../lib/searchHistory';
import { useSelectionStore } from './selection';

interface JumpRequest {
  message: DecryptedMessage;
  nonce: number;
}

interface SearchState {
  open: boolean;
  query: string;
  /** Identity of the result currently being viewed. The index can shift
   * as backfill or realtime messages change the result list, so the UI
   * tracks the id, not a position. */
  activeResultId: string | null;
  jumpRequest: JumpRequest | null;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setActiveResultId: (id: string | null) => void;
  requestJump: (message: DecryptedMessage) => void;
  clearJump: () => void;
  /** Full cleanup: close, clear the query, forget the active result. */
  closeSearch: () => void;
}

let jumpNonce = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  query: '',
  activeResultId: null,
  jumpRequest: null,
  setOpen: (open) => {
    if (open) {
      // The two modes never stack: opening search exits selection mode.
      useSelectionStore.getState().exit();
      set({ open: true });
    } else {
      // Any close path cancels the history backfill (cursor preserved for
      // the next search) and wipes the query + active result so no stale
      // highlight survives.
      cancelHistorySearch();
      set({ open: false, query: '', activeResultId: null, jumpRequest: null });
    }
  },
  setQuery: (query) => set({ query }),
  setActiveResultId: (id) => set({ activeResultId: id }),
  requestJump: (message) =>
    set({ jumpRequest: { message, nonce: ++jumpNonce } }),
  clearJump: () => set({ jumpRequest: null }),
  closeSearch: () => get().setOpen(false),
}));
