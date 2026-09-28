import { resetCoreState } from '@/core';
import { deleteDatabase } from '@/core/db';
import { drainEmbedQueue } from '@/core/embedQueue';
import { clearNameCaches } from '@/core/names';
import { deleteAllShards } from '@/core/shards';
import { queueDeviceDeletion, unregisterBackgroundSync, isOffline, setSyncState, clearIdentity, getIdentity } from '@/sync';
import { deleteDeviceRemote } from '@/sync/api';

import { useApp } from './store';

export interface DeleteResult {
  /** The server confirmed deletion now; false means it is queued for the next connection. */
  serverDeleted: boolean;
}

/**
 * "Delete everything", in the order that keeps it safe offline:
 * 1. delete this device's contributions on the server (or park the token so it runs on the next connection),
 * 2. close and delete both shards, 3. delete the database, 4. clear the identity, 5. restart onboarding.
 * The local wipe always happens immediately, whatever the network is doing.
 */
export async function deleteEverything(): Promise<DeleteResult> {
  const identity = await getIdentity();
  let serverDeleted = false;

  if (identity) {
    if (await isOffline()) {
      await queueDeviceDeletion();
    } else {
      try {
        await deleteDeviceRemote(identity);
        serverDeleted = true;
      } catch {
        await queueDeviceDeletion();
      }
    }
  }

  await drainEmbedQueue().catch(() => undefined); // nothing may write into the shards while they are deleted
  await unregisterBackgroundSync().catch(() => undefined);
  deleteAllShards();
  await deleteDatabase();
  await clearIdentity();
  await clearNameCaches();
  resetCoreState();
  setSyncState({ status: 'idle', lastSyncAt: null, pendingCount: 0, lastPulled: null, lastError: null });
  useApp.getState().set({ onboarded: false });
  return { serverDeleted };
}
