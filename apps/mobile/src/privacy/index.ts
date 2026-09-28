import { logEvent } from '@/core/db';
import { registerSplitter } from '@/core/ingest';

import { splitRiderNote } from './splitter';

let started = false;

const guarded = (label: string, fn: () => Promise<unknown>) =>
  fn().then(
    () => undefined,
    (e) => logEvent('splitter', 'error', `${label}: ${e instanceof Error ? e.message : String(e)}`),
  );

/** Wires the Splitter into the ingestion pipeline. Call once at app start. */
export function initPrivacy() {
  if (started) return;
  started = true;
  registerSplitter({
    onItem: (item) => (item.source === 'rider_note' ? guarded('rider_note', () => splitRiderNote(item.id)) : undefined),
  });
}

/** Detaches the Splitter again (used by test screens so test actions never queue facts afterwards). */
export function shutdownPrivacy() {
  registerSplitter({});
  started = false;
}

export { leakCheck, type Verdict } from './leakCheck';
export { blockedLog, enqueueOutcome, pendingCount, subscribePrivacyEvents, type PrivacyEvent } from './outbox';
export { submitFact } from './submit';
