import type { Source } from '@hive/shared';
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'hive.db';
const SCHEMA_VERSION = 4;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, ext_id TEXT UNIQUE,
  text TEXT, ts INTEGER, meta TEXT, embedded INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_items_source_ts ON items(source, ts);
CREATE INDEX IF NOT EXISTS idx_items_embedded ON items(embedded);

-- One rider's route for the day, seeded from assets/demo/route.json (or a future real routing source).
CREATE TABLE IF NOT EXISTS stops (
  id TEXT PRIMARY KEY, place_id TEXT, label TEXT, lat REAL, lon REAL, seq INTEGER,
  status TEXT DEFAULT 'pending', arrived_at INTEGER, done_at INTEGER, result TEXT);
CREATE INDEX IF NOT EXISTS idx_stops_seq ON stops(seq);

-- Which knowledge-point ids were shown in each stop's arrival brief, so an outcome can credit/debit them.
CREATE TABLE IF NOT EXISTS briefs (stop_id TEXT PRIMARY KEY, fact_ids TEXT, shown_at INTEGER);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT, status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0, next_at INTEGER DEFAULT 0, created_at INTEGER,
  type TEXT DEFAULT 'fact'); -- 'fact' | 'outcome'
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, next_at);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, sent TEXT, blocked TEXT, prev_hash TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS sync_state (grp TEXT PRIMARY KEY, last_version INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, source TEXT, level TEXT, msg TEXT);

-- Leak Check verdicts that were blocked or rewritten. 'text' is local-only and never goes into receipts.
CREATE TABLE IF NOT EXISTS blocked_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, action TEXT, reason TEXT,
  text TEXT, matched_item_id INTEGER, receipted INTEGER DEFAULT 0);
-- hashes of facts already queued, so the same fact is not sent twice within 30 days
CREATE TABLE IF NOT EXISTS shared_hashes (hash TEXT PRIMARY KEY, ts INTEGER);
`;

/** Runs once per already-installed database that predates a column added straight into SCHEMA above. */
async function applyGuardedMigrations(db: SQLite.SQLiteDatabase) {
  try {
    await db.execAsync("ALTER TABLE outbox ADD COLUMN type TEXT DEFAULT 'fact'");
  } catch {
    // column already exists
  }
}

export interface StopRow {
  id: string;
  place_id: string;
  label: string;
  lat: number;
  lon: number;
  seq: number;
  status: 'pending' | 'arrived' | 'done';
  arrived_at: number | null;
  done_at: number | null;
  result: 'delivered' | 'failed' | null;
}

export interface BriefRow {
  stop_id: string;
  fact_ids: string;
  shown_at: number;
}

export interface ItemRow {
  id: number;
  source: Source;
  ext_id: string;
  text: string;
  ts: number;
  meta: string | null;
  embedded: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open() {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(SCHEMA);
  await applyGuardedMigrations(db);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

/** Opens (and migrates) the database once; every caller shares the same handle. */
export function getDb() {
  dbPromise ??= open().catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

export async function getSetting(key: string, fallback: string): Promise<string>;
export async function getSetting(key: string, fallback?: undefined): Promise<string | undefined>;
export async function getSetting(key: string, fallback?: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ v: string }>('SELECT v FROM settings WHERE k = ?', [key]);
  return row?.v ?? fallback;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.runAsync('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [
    key,
    value,
  ]);
}

export async function logEvent(source: string, level: 'info' | 'warn' | 'error', msg: string) {
  try {
    const db = await getDb();
    await db.runAsync('INSERT INTO logs (ts, source, level, msg) VALUES (?, ?, ?, ?)', [
      Date.now(),
      source,
      level,
      msg.slice(0, 500),
    ]);
  } catch {
    // logging must never throw
  }
}

export function parseMeta(meta: string | null): Record<string, unknown> {
  if (!meta) return {};
  try {
    return JSON.parse(meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Closes and deletes the database file. Used by "Delete everything" and the smoke-test reset. */
export async function deleteDatabase() {
  if (dbPromise) {
    try {
      await (await dbPromise).closeAsync();
    } catch {
      // already closed
    }
    dbPromise = null;
  }
  await SQLite.deleteDatabaseAsync(DB_NAME);
}
