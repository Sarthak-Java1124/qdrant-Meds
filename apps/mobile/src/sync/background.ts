import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { initCore } from '@/core';

import { syncOnce } from './engine';

export const SYNC_TASK = 'hive-sync';

// Must run at module load (global scope) so the task exists when the OS wakes the app in the background.
// Import this file from the app entry (Phase 13).
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await initCore(); // a background wake-up starts a fresh JS runtime
    await syncOnce();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registers the periodic sync (Android WorkManager, minimum 15 minutes). Returns false when the OS restricts it. */
export async function registerBackgroundSync() {
  if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Restricted) return false;
  if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) {
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
  }
  return true;
}

export async function unregisterBackgroundSync() {
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
}
