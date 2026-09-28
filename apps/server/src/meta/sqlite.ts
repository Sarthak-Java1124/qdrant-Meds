import Database from 'better-sqlite3';

import type { DeviceRow, EventRow, Meta, OutcomeRow, OverviewStats } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS daily (device_id TEXT NOT NULL, date TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (device_id, date));
CREATE TABLE IF NOT EXISTS heartbeats (device_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, stats_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, stop_id TEXT NOT NULL, place_id TEXT NOT NULL, device_id TEXT NOT NULL,
  result TEXT NOT NULL, door_seconds INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_outcomes_at ON outcomes(at);
CREATE INDEX IF NOT EXISTS idx_outcomes_stop ON outcomes(stop_id);
`;

const MAX_EVENTS = 20_000;

export class SqliteMeta implements Meta {
  private db: Database.Database;
  private eventInserts = 0;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  private bump(name: string): number {
    const row = this.db
      .prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value')
      .get(name) as { value: number };
    return row.value;
  }

  createDevice(id: string, tokenHash: string, now: number) {
    this.db.prepare('INSERT INTO devices (id, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?)').run(id, tokenHash, now, now);
  }
  deviceByTokenHash(tokenHash: string) {
    return (this.db.prepare('SELECT id, created_at, last_seen FROM devices WHERE token_hash = ?').get(tokenHash) as DeviceRow | undefined) ?? null;
  }
  touchDevice(id: string, now: number) {
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now, id);
  }
  deleteDevice(id: string) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM daily WHERE device_id = ?').run(id);
      this.db.prepare('DELETE FROM heartbeats WHERE device_id = ?').run(id);
    });
    tx();
  }
  deviceCreatedAt(id: string) {
    return (this.db.prepare('SELECT created_at FROM devices WHERE id = ?').get(id) as { created_at: number } | undefined)?.created_at ?? null;
  }
  listDevices() {
    const rows = this.db
      .prepare('SELECT d.id, d.created_at, d.last_seen, h.stats_json, h.ts AS heartbeat_ts FROM devices d LEFT JOIN heartbeats h ON h.device_id = d.id ORDER BY d.last_seen DESC')
      .all() as (DeviceRow & { stats_json: string | null; heartbeat_ts: number | null })[];
    return rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      last_seen: r.last_seen,
      heartbeat: r.stats_json ? (JSON.parse(r.stats_json) as unknown) : null,
      heartbeat_ts: r.heartbeat_ts,
    }));
  }
  countDevices() {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n;
  }
  activeDevices(sinceTs: number) {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE last_seen >= ?').get(sinceTs) as { n: number }).n;
  }

  nextVersion() {
    return this.bump('version');
  }
  currentVersion() {
    return (this.db.prepare("SELECT value FROM counters WHERE name = 'version'").get() as { value: number } | undefined)?.value ?? 0;
  }
  nextContributionId() {
    return this.bump('contribution');
  }

  dailyCount(deviceId: string, date: string) {
    return (this.db.prepare('SELECT count FROM daily WHERE device_id = ? AND date = ?').get(deviceId, date) as { count: number } | undefined)?.count ?? 0;
  }
  incrDaily(deviceId: string, date: string) {
    const row = this.db
      .prepare('INSERT INTO daily (device_id, date, count) VALUES (?, ?, 1) ON CONFLICT(device_id, date) DO UPDATE SET count = count + 1 RETURNING count')
      .get(deviceId, date) as { count: number };
    return row.count;
  }

  addEvent(ts: number, type: string, data: unknown) {
    const res = this.db.prepare('INSERT INTO events (ts, type, data) VALUES (?, ?, ?)').run(ts, type, JSON.stringify(data));
    if (++this.eventInserts % 1000 === 0) {
      this.db.prepare('DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?').run(MAX_EVENTS);
    }
    return Number(res.lastInsertRowid);
  }
  recentEvents(limit: number) {
    const rows = this.db.prepare('SELECT id, ts, type, data FROM events ORDER BY id DESC LIMIT ?').all(limit) as { id: number; ts: number; type: string; data: string }[];
    return rows.map((r): EventRow => ({ id: r.id, ts: r.ts, type: r.type, data: JSON.parse(r.data) as unknown }));
  }
  eventCounts(sinceTs: number) {
    const rows = this.db.prepare('SELECT type, COUNT(*) AS n FROM events WHERE ts >= ? GROUP BY type').all(sinceTs) as { type: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.type, r.n]));
  }
  eventSum(type: string, field: string, sinceTs: number) {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(json_extract(data, ?)), 0) AS s FROM events WHERE type = ? AND ts >= ?')
      .get(`$.${field}`, type, sinceTs) as { s: number };
    return row.s;
  }

  putHeartbeat(deviceId: string, ts: number, stats: unknown) {
    this.db
      .prepare('INSERT INTO heartbeats (device_id, ts, stats_json) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET ts = excluded.ts, stats_json = excluded.stats_json')
      .run(deviceId, ts, JSON.stringify(stats));
  }

  addOutcome(row: OutcomeRow) {
    this.db
      .prepare('INSERT INTO outcomes (stop_id, place_id, device_id, result, door_seconds, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.stop_id, row.place_id, row.device_id, row.result, row.door_seconds, row.at);
  }

  /**
   * stopsToday = distinct stops with an outcome since `sinceTs`. firstAttemptSuccessPct = of those stops, the
   * share whose EARLIEST outcome was 'delivered' (a later delivered-after-failed retry doesn't count as first-attempt).
   * avgDoorSeconds = mean door_seconds across every outcome since `sinceTs` (not just first attempts).
   */
  overviewStats(sinceTs: number): OverviewStats {
    const rows = this.db.prepare('SELECT stop_id, result, door_seconds, at FROM outcomes WHERE at >= ?').all(sinceTs) as {
      stop_id: string;
      result: string;
      door_seconds: number;
      at: number;
    }[];
    const firstByStop = new Map<string, { result: string; at: number }>();
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
    this.db.transaction(() => {
      for (const table of ['devices', 'daily', 'heartbeats', 'events', 'outcomes']) this.db.prepare(`DELETE FROM ${table}`).run();
    })();
  }
}
