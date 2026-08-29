import { create } from 'zustand';

// Telegram-style message selection mode. A Set<string> keeps toggles O(1);
// the UI derives checked state from `selectedIds.has(id)`.
interface SelectionState {
  active: boolean;
  selectedIds: Set<string>;
  enter: (id?: string) => void;
  toggle: (id: string) => void;
  exit: () => void;
  clear: () => void;
  count: () => number;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  active: false,
  selectedIds: new Set<string>(),
  enter: (id) =>
    set((s) => ({
      active: true,
      selectedIds: id ? new Set([id]) : new Set(s.selectedIds),
    })),
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  exit: () => set({ active: false, selectedIds: new Set() }),
  clear: () => set({ selectedIds: new Set() }),
  count: () => get().selectedIds.size,
}));
