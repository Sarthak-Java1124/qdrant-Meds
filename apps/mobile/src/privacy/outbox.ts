import { fnv1a, type FactKind, type Outcome, type SharedFact } from '@hive/shared';

import { getDb } from '@/core/db';

const DAY = 86_400_000;
const DEDUPE_DAYS = 30;

/** Two salted 32-bit FNV hashes, so accidental collisions between different facts are negligible. */
export function hashFact(f: SharedFact) {
  const s = JSON.stringify([f.kind, f.group, f.key, f.value, f.text]);
  return fnv1a(s).toString(16).padStart(8, '0') + fnv1a(`hive:${s}`).toString(16).padStart(8, '0');
}

export async function recentlyShared(f: SharedFact, now = Date.now()) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT 1 AS x FROM shared_hashes WHERE hash = ? AND ts > ?', [
    hashFact(f),
    now - DEDUPE_DAYS * DAY,
  ]);
  return !!row;
}

export async function rememberShared(...facts: SharedFact[]) {
  const db = await getDb();
  for (const f of facts) {
    await db.runAsync('INSERT OR REPLACE INTO shared_hashes (hash, ts) VALUES (?, ?)', [hashFact(f), Date.now()]);
  }
}

/** Called when the server rejects a fact, so the user can submit it again later. */
export async function forgetShared(f: SharedFact) {
  const db = await getDb();
  await db.runAsync('DELETE FROM shared_hashes WHERE hash = ?', [hashFact(f)]);
}

/** Puts a fact that has passed the Leak Check on the upload queue. */
export async function enqueueFact(f: SharedFact) {
  const db = await getDb();
  const res = await db.runAsync(
    "INSERT INTO outbox (fact, status, attempts, next_at, created_at, type) VALUES (?, 'pending', 0, 0, ?, 'fact')",
    [JSON.stringify(f), Date.now()],
  );
  return res.lastInsertRowId;
}

/** Puts a delivery outcome on the upload queue. Outcomes carry no PII, so they skip the Leak Check entirely. */
export async function enqueueOutcome(o: Outcome) {
  const db = await getDb();
  const res = await db.runAsync(
    "INSERT INTO outbox (fact, status, attempts, next_at, created_at, type) VALUES (?, 'pending', 0, 0, ?, 'outcome')",
    [JSON.stringify(o), Date.now()],
  );
  return res.lastInsertRowId;
}

export async function pendingCount() {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'"))?.n ?? 0;
}

export interface BlockedEntry {
  id: number;
  ts: number;
  kind: FactKind;
  action: 'block';
  reason: string;
  text: string;
  matched_item_id: number | null;
  receipted: number;
}

export async function recordVerdict(entry: { kind: FactKind; action: 'block'; reason: string; text: string }) {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO blocked_log (ts, kind, action, reason, text) VALUES (?, ?, ?, ?, ?)',
    [Date.now(), entry.kind, entry.action, entry.reason, entry.text],
  );
}

/** The Privacy screen's blocked-items log, newest first. */
export async function blockedLog(limit = 100) {
  const db = await getDb();
  return db.getAllAsync<BlockedEntry>('SELECT * FROM blocked_log ORDER BY id DESC LIMIT ?', [limit]);
}

/** Verdicts not yet written into a receipt. Phase 8 puts these (without the text) into the next receipt. */
export async function unreceiptedVerdicts() {
  const db = await getDb();
  return db.getAllAsync<BlockedEntry>('SELECT * FROM blocked_log WHERE receipted = 0 ORDER BY id');
}

export async function markReceipted(ids: number[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE blocked_log SET receipted = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

// --- events for the UI (toasts) ---

export interface PrivacyEvent {
  type: 'queued' | 'blocked';
  kind: FactKind;
  reason?: string;
}

const listeners = new Set<(e: PrivacyEvent) => void>();

export function subscribePrivacyEvents(fn: (e: PrivacyEvent) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const emitPrivacyEvent = (e: PrivacyEvent) => listeners.forEach((fn) => fn(e));
