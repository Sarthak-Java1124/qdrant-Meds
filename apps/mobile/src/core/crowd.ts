import type { FactKind, FactStatus } from '@hive/shared';
import type { Filter } from 'react-native-qdrant-edge';

import { getDb, logEvent } from './db';
import { subscribedGroups } from './groups';
import { hybridSearch, type FusedHit } from './search';
import { getShard, type CrowdPayload } from './shards';

/** Everything here reads the on-device crowd shard, so it works fully offline. */

export interface CrowdItem {
  id: number | string;
  payload: CrowdPayload;
}

const toId = (id: string): number | string => (/^\d+$/.test(id) ? Number(id) : id);
const eq = (key: string, value: string) => ({ key, match: { value } });

function filterFor(opts: { kind?: FactKind; group?: string; placeId?: string; status?: FactStatus[] } = {}): Filter | undefined {
  const must = [
    ...(opts.kind ? [eq('kind', opts.kind)] : []),
    ...(opts.group ? [eq('group', opts.group)] : []),
    ...(opts.placeId ? [{ key: 'key', match: { prefix: `${opts.placeId}:` } }] : []),
    ...(opts.status ? [{ key: 'status', match: { any: opts.status } }] : []),
  ];
  return must.length ? { must } : undefined;
}

/** Newest knowledge first. */
export function listCrowd(opts: { kind?: FactKind; group?: string; placeId?: string; limit?: number } = {}): CrowdItem[] {
  const page = getShard('crowd').scroll({
    limit: opts.limit ?? 50,
    with_payload: true,
    filter: filterFor(opts),
    order_by: { key: 'version', direction: 'desc' },
  });
  return page.points.map((p) => ({ id: toId(p.id), payload: p.payload as unknown as CrowdPayload }));
}

/** Meaning + exact-token search over crowd knowledge. Offline: the phone embeds the query itself. */
export function searchCrowdText(text: string, opts: { kind?: FactKind; group?: string; limit?: number } = {}): Promise<FusedHit<CrowdPayload>[]> {
  return hybridSearch<CrowdPayload>('crowd', text, filterFor(opts), opts.limit ?? 5);
}

/** Every place fact for one place, whatever its slot, verified or unverified (not superseded). Powers the arrival brief. */
export const placeFacts = (placeId: string, group: string, limit = 50) =>
  listCrowd({ kind: 'place_fact', group, placeId, limit }).filter((c) => c.payload.status !== 'superseded');

export interface CrowdCounts {
  total: number;
  byKind: Record<string, number>;
  byGroup: Record<string, number>;
}

export function crowdCounts(): CrowdCounts {
  const shard = getShard('crowd');
  const facet = (key: string) => {
    try {
      return Object.fromEntries(shard.facet({ key, limit: 200, exact: true }).hits.map((h) => [String(h.value), h.count]));
    } catch {
      return {};
    }
  };
  return { total: shard.info().points_count, byKind: facet('kind'), byGroup: facet('group') };
}

/**
 * Removes crowd points for groups the phone no longer subscribes to (the rider changed zones) and forgets
 * their sync cursor, so switching back to a zone later downloads its pack afresh rather than reusing a stale one.
 */
export async function pruneUnsubscribed(): Promise<{ groups: string[]; points: number }> {
  const shard = getShard('crowd');
  const keep = new Set(await subscribedGroups());
  const stale = Object.keys(crowdCounts().byGroup).filter((g) => !keep.has(g));
  let points = 0;
  const db = await getDb();

  for (const group of stale) {
    let offset: string | undefined;
    do {
      const page = shard.scroll({ limit: 500, with_payload: false, filter: filterFor({ group }), offset });
      const ids = page.points.map((p) => toId(p.id));
      if (ids.length) {
        shard.deletePoints(ids);
        points += ids.length;
      }
      offset = page.next_offset;
    } while (offset);
    await db.runAsync('DELETE FROM sync_state WHERE grp = ?', [group]);
  }
  if (points) shard.flush();
  if (stale.length) await logEvent('crowd', 'info', `pruned ${points} points from ${stale.length} unsubscribed groups`);
  return { groups: stale, points };
}
