import { create } from 'zustand';

import type { SyncStatus } from './statusLabel';

export interface PullSummary {
  points: number;
  tombstones: number;
}

interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  pendingCount: number;
  lastPulled: PullSummary | null;
  lastError: string | null;
  set(patch: Partial<Omit<SyncState, 'set'>>): void;
}

/** Drives the header status pill. Updated only by the sync engine. */
export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncAt: null,
  pendingCount: 0,
  lastPulled: null,
  lastError: null,
  set: (patch) => set(patch),
}));

export const syncState = () => useSyncStore.getState();
export const setSyncState = (patch: Partial<Omit<SyncState, 'set'>>) => useSyncStore.getState().set(patch);
