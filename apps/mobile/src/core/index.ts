import { getDb } from './db';
import { requeueUnembedded } from './embedQueue';
import { getShard, registerBackgroundOptimize } from './shards';

let started: Promise<void> | null = null;

/** After "Delete everything" the database and shards are gone; this lets the next initCore() open fresh ones. */
export function resetCoreState() {
  started = null;
}

/** Call once at app start: opens SQLite and both shards, and re-queues anything left un-embedded. */
export function initCore() {
  started ??= (async () => {
    await getDb();
    getShard('private');
    getShard('crowd');
    registerBackgroundOptimize();
    await requeueUnembedded();
  })().catch((e) => {
    started = null;
    throw e;
  });
  return started;
}
