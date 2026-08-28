import { create } from 'zustand';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface RealtimeState {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'disconnected',
  setStatus: (status) => set({ status }),
}));