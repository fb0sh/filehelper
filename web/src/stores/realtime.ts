import { create } from 'zustand';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface RealtimeState {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

// Start as 'connecting' — the WebSocket dials as soon as the layout mounts.
export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'connecting',
  setStatus: (status) => set({ status }),
}));