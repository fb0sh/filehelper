import { create } from 'zustand';
import { Message } from '../api';

interface JumpRequest {
  message: Message;
  nonce: number;
}

interface SearchState {
  open: boolean;
  query: string;
  jumpRequest: JumpRequest | null;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  requestJump: (message: Message) => void;
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