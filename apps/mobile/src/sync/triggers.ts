import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { logEvent } from '@/core/db';

import { registerBackgroundSync } from './background';
import { syncOnce, type SyncSummary } from './engine';

/** Automatic triggers are throttled so a flapping connection can't hammer the server. */
const MIN_GAP_MS = 10_000;
let lastAttempt = 0;

/** The "Sync now" button: always runs (unless a sync is already in progress). */
export function syncNow(): Promise<SyncSummary> {
  lastAttempt = Date.now();
  return syncOnce();
}

function auto(reason: string) {
  if (Date.now() - lastAttempt < MIN_GAP_MS) return;
  lastAttempt = Date.now();
  void syncOnce().then((s) => {
    if (s.error) void logEvent('sync', 'warn', `${reason}: ${s.error}`);
  });
}

/**
 * Starts every automatic sync trigger: connectivity coming back, the app returning to the foreground,
 * and the 15-minute background task. Returns a function that stops the foreground listeners.
 */
export function startSyncTriggers() {
  let wasOnline = true;
  const unsubscribeNet = NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    if (online && !wasOnline) auto('network back');
    wasOnline = online;
  });
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') auto('foreground');
  });

  registerBackgroundSync().catch((e) => logEvent('sync', 'warn', `background task: ${e instanceof Error ? e.message : String(e)}`));
  auto('start');

  return () => {
    unsubscribeNet();
    appState.remove();
  };
}
