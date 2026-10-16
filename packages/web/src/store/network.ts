import { create } from 'zustand';

interface NetworkState {
  online: boolean;
  /** Number of mutations waiting in the Dexie outbox. */
  queued: number;
  syncing: boolean;
  lastSync: number | null;
  setOnline: (online: boolean) => void;
  setQueued: (n: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSync: (ts: number) => void;
}

export const useNetwork = create<NetworkState>((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  queued: 0,
  syncing: false,
  lastSync: null,
  setOnline: (online) => set({ online }),
  setQueued: (queued) => set({ queued }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSync: (lastSync) => set({ lastSync })
}));
