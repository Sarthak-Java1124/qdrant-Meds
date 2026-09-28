import type { DeviceRow, EventRow, Meta, OutcomeRow, OverviewStats } from './types';

export class MemoryMeta implements Meta {
  private devices = new Map<string, DeviceRow & { tokenHash: string }>();
  private counters = { version: 0, contribution: 0 };
  private daily = new Map<string, number>();
  private events: EventRow[] = [];
  private nextEventId = 1;
  private heartbeats = new Map<string, { ts: number; stats: unknown }>();
  private outcomes: OutcomeRow[] = [];

  createDevice(id: string, tokenHash: string, now: number) {
    this.devices.set(id, { id, tokenHash, created_at: now, last_seen: now });
  }
  deviceByTokenHash(tokenHash: string) {
    for (const d of this.devices.values()) if (d.tokenHash === tokenHash) return { id: d.id, created_at: d.created_at, last_seen: d.last_seen };
    return null;
  }
  touchDevice(id: string, now: number) {
    const d = this.devices.get(id);
    if (d) d.last_seen = now;
  }
  deleteDevice(id: string) {
    this.devices.delete(id);
    this.heartbeats.delete(id);
    for (const k of [...this.daily.keys()]) if (k.startsWith(`${id}|`)) this.daily.delete(k);
  }
  deviceCreatedAt(id: string) {
    return this.devices.get(id)?.created_at ?? null;
  }
  listDevices() {
    return [...this.devices.values()].map((d) => {
      const hb = this.heartbeats.get(d.id);
      return { id: d.id, created_at: d.created_at, last_seen: d.last_seen, heartbeat: hb?.stats ?? null, heartbeat_ts: hb?.ts ?? null };
    });
  }
  countDevices() {
    return this.devices.size;
  }
  activeDevices(sinceTs: number) {
    return [...this.devices.values()].filter((d) => d.last_seen >= sinceTs).length;
  }

  nextVersion() {
    return ++this.counters.version;
  }
  currentVersion() {
    return this.counters.version;
  }
  nextContributionId() {
    return ++this.counters.contribution;
  }

  dailyCount(deviceId: string, date: string) {
    return this.daily.get(`${deviceId}|${date}`) ?? 0;
  }
  incrDaily(deviceId: string, date: string) {
    const k = `${deviceId}|${date}`;
    const n = (this.daily.get(k) ?? 0) + 1;
    this.daily.set(k, n);
    return n;
  }

  addEvent(ts: number, type: string, data: unknown) {
    const id = this.nextEventId++;
    this.events.push({ id, ts, type, data });
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    return id;
  }
  recentEvents(limit: number) {
    return this.events.slice(-limit).reverse();
  }
  eventCounts(sinceTs: number) {
    const out: Record<string, number> = {};
    for (const e of this.events) if (e.ts >= sinceTs) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }
  eventSum(type: string, field: string, sinceTs: number) {
    let s = 0;
    for (const e of this.events) {
      if (e.type === type && e.ts >= sinceTs) s += Number((e.data as Record<string, unknown>)?.[field] ?? 0);
    }
    return s;
  }

  putHeartbeat(deviceId: string, ts: number, stats: unknown) {
    this.heartbeats.set(deviceId, { ts, stats });
  }

  addOutcome(row: OutcomeRow) {
    this.outcomes.push(row);
  }

  /** Same definitions as sqlite.ts's overviewStats. */
  overviewStats(sinceTs: number): OverviewStats {
    const rows = this.outcomes.filter((o) => o.at >= sinceTs);
    const firstByStop = new Map<string, OutcomeRow>();
    for (const r of rows) {
      const cur = firstByStop.get(r.stop_id);
      if (!cur || r.at < cur.at) firstByStop.set(r.stop_id, r);
    }
    const firstAttempts = [...firstByStop.values()];
    const delivered = firstAttempts.filter((f) => f.result === 'delivered').length;
    const avgDoorSeconds = rows.length ? rows.reduce((s, r) => s + r.door_seconds, 0) / rows.length : 0;
    return {
      stopsToday: firstByStop.size,
      firstAttemptSuccessPct: firstAttempts.length ? Math.round((delivered / firstAttempts.length) * 100) : 0,
      avgDoorSeconds: Math.round(avgDoorSeconds),
    };
  }

  reset() {
    this.devices.clear();
    this.daily.clear();
    this.heartbeats.clear();
    this.events = [];
    this.outcomes = [];
  }
}
