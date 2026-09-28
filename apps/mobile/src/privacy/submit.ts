import type { SharedFact } from '@hive/shared';

import { emitPrivacyEvent, enqueueFact, recentlyShared, recordVerdict, rememberShared } from './outbox';
import { leakCheck, type LeakOptions, type Verdict } from './leakCheck';

export type SubmitResult =
  | { status: 'duplicate' }
  | { status: 'queued'; verdict: Verdict }
  | { status: 'blocked'; verdict: Verdict };

/**
 * The only way a fact reaches the outbox: dedupe, Leak Check, then queue.
 * Blocked verdicts are logged for the Privacy screen and emitted for a toast.
 */
export async function submitFact(fact: SharedFact, opts: LeakOptions = {}): Promise<SubmitResult> {
  if (await recentlyShared(fact)) return { status: 'duplicate' };

  const verdict = await leakCheck(fact, opts);

  if (verdict.action === 'block') {
    await recordVerdict({
      kind: fact.kind,
      action: 'block',
      reason: verdict.reason ?? 'blocked',
      text: fact.text,
    });
    emitPrivacyEvent({ type: 'blocked', kind: fact.kind, reason: verdict.reason });
    return { status: 'blocked', verdict };
  }

  await enqueueFact(verdict.fact);
  await rememberShared(fact);
  emitPrivacyEvent({ type: 'queued', kind: fact.kind });
  return { status: 'queued', verdict };
}
