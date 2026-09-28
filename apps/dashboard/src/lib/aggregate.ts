import type { ServerEvent } from './types';

const MIN = 60_000;

/** Contributions per minute for the last `minutes` minutes, oldest first (for the sparkline). */
export function perMinute(events: ServerEvent[], now: number, minutes = 30): { ts: number; count: number }[] {
  const start = Math.floor(now / MIN) * MIN - (minutes - 1) * MIN;
  const buckets = Array.from({ length: minutes }, (_, i) => ({ ts: start + i * MIN, count: 0 }));
  for (const e of events) {
    if (e.type !== 'contribution' || e.ts < start || e.ts > now) continue;
    buckets[Math.min(minutes - 1, Math.floor((e.ts - start) / MIN))].count++;
  }
  return buckets;
}

/** Newest first, de-duplicated by id, capped. Used for both the initial load and live SSE messages. */
export function mergeEvents(current: ServerEvent[], incoming: ServerEvent[], cap = 500): ServerEvent[] {
  const byId = new Map<number, ServerEvent>();
  for (const e of [...current, ...incoming]) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, cap);
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v === undefined || v === null ? fallback : String(v));

/** One line per event for the live activity log. */
export function describeEvent(e: ServerEvent): { label: string; detail: string; tone: Tone } {
  const d = e.data;
  switch (e.type) {
    case 'contribution':
      return { label: 'Contribution', detail: `place fact · ${str(d.key)} · zone ${str(d.group)} · device ${str(d.device)}`, tone: 'neutral' };
    case 'rejected':
      return { label: 'Rejected', detail: `${str(d.reason, 'unknown')} · device ${str(d.device)}`, tone: 'bad' };
    case 'published':
      return { label: d.updated ? 'Updated' : 'Published', detail: `${str(d.key)} → ${str(d.value)} · ${str(d.status, 'unverified')} · v${str(d.version)}`, tone: d.status === 'verified' ? 'good' : 'neutral' };
    case 'unpublished':
      return { label: 'Unpublished', detail: `${str(d.key)} · v${str(d.version)} (tombstone sent to phones)`, tone: 'warn' };
    case 'outcome':
      return { label: str(d.result) === 'delivered' ? 'Delivered' : 'Failed', detail: `stop ${str(d.stop_id)} · place ${str(d.place_id)} · device ${str(d.device)}${d.door_seconds ? ` · ${str(d.door_seconds)}s at the door` : ''}`, tone: str(d.result) === 'delivered' ? 'good' : 'bad' };
    case 'conflict_resolved':
      return { label: 'Conflict resolved', detail: `place ${str(d.place_id)} · ${str(d.slot)} · ${str(d.from)} → ${str(d.to)}`, tone: 'good' };
    case 'device_registered':
      return { label: 'Device joined', detail: `device ${str(d.device)}`, tone: 'neutral' };
    case 'device_synced':
      return { label: 'Device synced', detail: `device ${str(d.device)}`, tone: 'neutral' };
    case 'device_deleted':
      return { label: 'Device deleted', detail: `device ${str(d.device)} · ${str(d.removed, '0')} contributions removed`, tone: 'warn' };
    default:
      return { label: e.type, detail: JSON.stringify(d), tone: 'neutral' };
  }
}

export interface DeletionEffect {
  ts: number;
  device: string;
  removed: number;
  /** Published facts that fell below K because of this deletion and were tombstoned. */
  unpublished: number;
}

/**
 * What each device deletion did: the server unpublishes affected facts right after removing a device's data,
 * so 'unpublished' events within a few seconds of a 'device_deleted' are its effect.
 */
export function deletionEffects(events: ServerEvent[], windowMs = 5000): DeletionEffect[] {
  const asc = [...events].sort((a, b) => a.id - b.id);
  const out: DeletionEffect[] = [];
  for (const del of asc.filter((e) => e.type === 'device_deleted')) {
    const unpublished = asc.filter((e) => e.type === 'unpublished' && e.id > del.id && e.ts - del.ts <= windowMs).length;
    out.push({ ts: del.ts, device: str(del.data.device), removed: Number(del.data.removed ?? 0), unpublished });
  }
  return out.reverse();
}

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export const progressPct = (have: number, need: number) => Math.max(0, Math.min(100, Math.round((have / Math.max(1, need)) * 100)));

/** Event types grouped for the activity filter chips. */
export const EVENT_GROUPS: Record<string, string[]> = {
  All: [],
  Contributions: ['contribution'],
  Rejections: ['rejected'],
  Published: ['published', 'unpublished'],
  Outcomes: ['outcome', 'conflict_resolved'],
  Devices: ['device_registered', 'device_synced', 'device_deleted'],
};
