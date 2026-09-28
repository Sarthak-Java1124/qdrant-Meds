import { create } from 'zustand';

interface AppState {
  /** Core, privacy and sources are initialised. */
  ready: boolean;
  onboarded: boolean;
  set(patch: Partial<Omit<AppState, 'set'>>): void;
}

export const useApp = create<AppState>((set) => ({
  ready: false,
  onboarded: false,
  set: (patch) => set(patch),
}));
