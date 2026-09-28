import type { Slot } from '@hive/shared';
import type { SharedFact } from '@hive/shared';

import { scanEntities } from './entities';

export type Verdict = {
  action: 'send' | 'block';
  fact: SharedFact;
  reason?: string;
};

export interface LeakOptions {
  /** The fact's slot, if known — a gate_code value is allowed to be a bare 3-6 digit number. */
  slot?: Slot;
}

const block = (fact: SharedFact, reason: string): Verdict => ({ action: 'block', fact, reason });

/**
 * A rider note's text *is* the fact (there's no separate private corpus to cross-check it against, unlike
 * Hive's old chat/SMS-vs-tip similarity gates), so the only check that still applies is scanning for
 * anything that identifies a person: amounts, phone numbers, VPAs, emails, account numbers, and names
 * from contacts. A gate code is deliberately exempted from the numeric/reference patterns.
 */
export async function leakCheck(fact: SharedFact, opts: LeakOptions = {}): Promise<Verdict> {
  const allowNumeric = opts.slot === 'gate_code';
  const keyHit = await scanEntities(fact.key, { allowNumeric });
  if (keyHit) return block(fact, `key contains ${keyHit.type}`);
  const hit = await scanEntities(fact.text, { allowNumeric });
  if (hit) return block(fact, `contains ${hit.type}`);
  return { action: 'send', fact };
}
