import type { Slot } from '@hive/shared';

import type { StopRow } from '@/core/db';
import { getDb } from '@/core/db';
import { placeFacts } from '@/core/crowd';
import { zoneGroup, getZone } from '@/core/groups';
import type { CrowdPayload } from '@/core/shards';

const DAY = 86_400_000;

export interface BriefLine {
  id: number | string;
  slot: Slot;
  text: string;
  status: CrowdPayload['status'];
  confirmations: number;
}

/**
 * Scores a place fact by how much to trust it right now: confidence, decayed by how long it's been since
 * its last confirmed delivery (or since it was first observed, if it's never had one), weighted down a bit
 * for facts nobody has confirmed yet. No vector search needed here — the brief is a structured filter over
 * the crowd shard by place_id and status (README_NEW.md's own §5.2 calls this out).
 */
function score(p: CrowdPayload, now: number): number {
  const recency = Math.exp(-(now - (p.last_success_at || p.observed_at)) / (14 * DAY));
  return p.confidence * recency * (p.status === 'verified' ? 1 : 0.6);
}

/** Up to 4 lines for the arrival brief: the best fact per slot, ranked by trust. */
export async function buildBrief(stop: Pick<StopRow, 'place_id'>): Promise<BriefLine[]> {
  const zone = await getZone();
  if (!zone) return [];
  const now = Date.now();
  const items = placeFacts(stop.place_id, zoneGroup(zone));

  const bestBySlot = new Map<string, { id: number | string; payload: CrowdPayload; s: number }>();
  for (const { id, payload } of items) {
    const slot = payload.key.slice(payload.key.lastIndexOf(':') + 1);
    const s = score(payload, now);
    const cur = bestBySlot.get(slot);
    if (!cur || s > cur.s) bestBySlot.set(slot, { id, payload, s });
  }

  return [...bestBySlot.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(({ id, payload }) => ({
      id,
      slot: payload.key.slice(payload.key.lastIndexOf(':') + 1) as Slot,
      text: payload.text,
      status: payload.status,
      confirmations: payload.confirmations,
    }));
}

/** Records which knowledge-point ids were shown, so an outcome later knows what to credit or debit. */
export async function saveBriefShown(stopId: string, lines: BriefLine[]) {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO briefs (stop_id, fact_ids, shown_at) VALUES (?, ?, ?)',
    [stopId, JSON.stringify(lines.map((l) => l.id)), Date.now()],
  );
}
