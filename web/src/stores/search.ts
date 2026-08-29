import { create } from 'zustand';
import type { DecryptedMessage } from '../lib/crypto/messages';

interface JumpRequest {
  message: DecryptedMessage;
  nonce: number;
}

interface SearchState {
  open: boolean;
  query: string;
  jumpRequest: JumpRequest | null;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  requestJump: (message: DecryptedMessage) => void;
  clearJump: () => void;
}

let jumpNonce = 0;

export const useSearchStore = create<SearchState>((set) => ({
  open: false,
  query: '',
  jumpRequest: null,
  setOpen: (open) => set({ open }),
  setQuery: (query) => set({ query }),
  requestJump: (message) =>
    set({ jumpRequest: { message, nonce: ++jumpNonce } }),
  clearJump: () => set({ jumpRequest: null }),
}));
