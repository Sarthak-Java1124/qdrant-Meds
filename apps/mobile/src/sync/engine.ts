import {
  ContributionResponseSchema,
  HeartbeatSchema,
  KnowledgeResponseSchema,
  OutcomeSchema,
  backoffMinutes,
  sparseEncode,
} from '@hive/shared';
import * as SecureStore from 'expo-secure-store';

import { pruneUnsubscribed } from '@/core/crowd';
import { getDb, getSetting, logEvent, setSetting } from '@/core/db';
import { subscribedGroups } from '@/core/groups';
import { deleteCrowd, getShard, upsertCrowd, type CrowdPointInput } from '@/core/shards';
import { commitUpload, type OutboxRow } from '@/privacy/receipts';
import { pendingCount } from '@/privacy/outbox';

import { ApiError, NetworkError, api, clearIdentity, deleteDeviceRemote, getIdentity, type Identity } from './api';
import { isOffline } from './network';
import { setSyncState } from './status';

const BATCH = 50;
const MAX_BATCHES_PER_RUN = 10;
const PAGE = 500;
const PENDING_DELETE_KEY = 'hive_pending_delete';

export interface SyncSummary {
  skipped?: 'offline' | 'busy';
  deletedDevice?: boolean;
  pushed: number;
  rejected: number;
  pulled: number;
  tombstones: number;
  /** Crowd points removed because their group is no longer subscribed (the rider changed zones). */
  pruned: number;
  error?: string;
}

const empty = (): SyncSummary => ({ pushed: 0, rejected: 0, pulled: 0, tombstones: 0, pruned: 0 });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let isSyncing = false;

async function refreshPending() {
  setSyncState({ pendingCount: await pendingCount() });
}

// ---------- push ----------

async function backoff(rows: OutboxRow[]) {
  const db = await getDb();
  const now = Date.now();
  for (const r of rows) {
    const attempts = r.attempts + 1;
    await db.runAsync('UPDATE outbox SET attempts = ?, next_at = ? WHERE id = ?', [attempts, now + backoffMinutes(attempts) * 60_000, r.id]);
  }
}

async function nextBatch(type: 'fact' | 'outcome') {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox WHERE status = 'pending' AND type = ? AND next_at <= ? ORDER BY id LIMIT ?",
    [type, Date.now(), BATCH],
  );
}

/** Rider-note facts: same contract as Hive's original contribution push (PII-conscious, receipted). */
async function pushFacts(summary: SyncSummary) {
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await nextBatch('fact');
    if (!batch.length) return;

    let response;
    try {
      response = await api.post('/v1/contributions', { facts: batch.map((b) => JSON.parse(b.fact)) }, ContributionResponseSchema);
    } catch (e) {
      if (e instanceof ApiError && e.permanent) {
        const reason = `http_${e.status}`;
        await commitUpload(batch, [], batch.map((_, idx) => ({ idx, reason })));
        summary.rejected += batch.length;
        await logEvent('sync', 'error', `fact batch refused: ${e.message}`);
        continue;
      }
      await backoff(batch);
      throw e;
    }

    await commitUpload(batch, response.accepted, response.rejected);
    summary.pushed += response.accepted.length;
    summary.rejected += response.rejected.length;
    await refreshPending();
    if (batch.length < BATCH) return;
  }
}

/**
 * Delivery outcomes: structured, non-sensitive (no rider-authored free text), so they skip the receipt
 * ledger — that exists to prove what *content* left the phone, and an outcome carries none.
 */
async function pushOutcomes(summary: SyncSummary) {
  const db = await getDb();
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await nextBatch('outcome');
    if (!batch.length) return;

    try {
      await api.post('/v1/outcomes', { outcomes: batch.map((b) => OutcomeSchema.parse(JSON.parse(b.fact))) });
    } catch (e) {
      if (e instanceof ApiError && e.permanent) {
        await db.runAsync(`UPDATE outbox SET status = ? WHERE id IN (${batch.map(() => '?').join(',')})`, [`rejected:http_${e.status}`, ...batch.map((b) => b.id)]);
        summary.rejected += batch.length;
        await logEvent('sync', 'error', `outcome batch refused: ${e.message}`);
        continue;
      }
      await backoff(batch);
      throw e;
    }

    await db.runAsync(`UPDATE outbox SET status = 'sent' WHERE id IN (${batch.map(() => '?').join(',')})`, batch.map((b) => b.id));
    summary.pushed += batch.length;
    await refreshPending();
    if (batch.length < BATCH) return;
  }
}

async function push(summary: SyncSummary) {
  await pushFacts(summary);
  await pushOutcomes(summary);
}

// ---------- pull ----------

async function lastVersion(group: string) {
  const db = await getDb();
  return (await db.getFirstAsync<{ last_version: number }>('SELECT last_version FROM sync_state WHERE grp = ?', [group]))?.last_version ?? 0;
}

async function setLastVersion(group: string, version: number) {
  const db = await getDb();
  await db.runAsync('INSERT INTO sync_state (grp, last_version) VALUES (?, ?) ON CONFLICT(grp) DO UPDATE SET last_version = excluded.last_version', [group, version]);
}

async function applyKnowledge(res: { points: ReturnType<typeof KnowledgeResponseSchema.parse>['points']; tombstones: (string | number)[] }) {
  const chunk = 200;
  for (let i = 0; i < res.points.length; i += chunk) {
    const slice = res.points.slice(i, i + chunk);
    const points: CrowdPointInput[] = slice.map((p) => ({
      id: p.id,
      dense: p.vector, // computed by the server, so the phone never re-embeds
      sparse: sparseEncode(p.text),
      payload: {
        kind: p.kind,
        group: p.group,
        key: p.key,
        value: p.value,
        text: p.text,
        version: p.version,
        confirmations: p.confirmations,
        lat: p.lat,
        lon: p.lon,
        successes: p.successes,
        failures: p.failures,
        confidence: p.confidence,
        status: p.status,
        superseded_by: p.superseded_by,
        last_success_at: p.last_success_at,
        observed_at: p.observed_at,
      },
    }));
    await upsertCrowd(points);
  }
  deleteCrowd(res.tombstones);
}

/**
 * Downloads every subscribed group's (i.e. the rider's zone) knowledge delta. The cursor is the highest
 * version seen, taken from the server's `next` and from the points themselves, so a page of only
 * tombstones still advances.
 */
async function pull(summary: SyncSummary) {
  for (const group of await subscribedGroups()) {
    let since = await lastVersion(group);
    for (;;) {
      const res = await api.get(`/v1/knowledge?group=${encodeURIComponent(group)}&since=${since}&limit=${PAGE}`, KnowledgeResponseSchema);
      await applyKnowledge(res);
      summary.pulled += res.points.length;
      summary.tombstones += res.tombstones.length;

      const before = since;
      since = Math.max(since, res.next ?? 0, ...res.points.map((p) => p.version));
      if (since > before) await setLastVersion(group, since);

      const full = res.points.length + res.tombstones.length >= PAGE;
      if (!full || since <= before) break;
    }
  }
}

// ---------- housekeeping ----------

/** Counts only, and only if the user opted in. Never content. */
async function heartbeat() {
  if ((await getSetting('share_stats', '0')) !== '1') return;
  const db = await getDb();
  const items = await db.getAllAsync<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM items GROUP BY source');
  const blocked = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM blocked_log WHERE action = 'block'"))?.n ?? 0;
  const body = HeartbeatSchema.parse({ items: Object.fromEntries(items.map((r) => [r.source, r.n])), pending: await pendingCount(), blocked });
  await api.post('/v1/heartbeat', body).catch((e) => logEvent('sync', 'warn', `heartbeat: ${message(e)}`));
}

/**
 * "Delete everything" while offline: the token is parked in SecureStore (the local database is wiped),
 * and the server-side deletion runs on the next connection.
 */
export async function queueDeviceDeletion() {
  const identity = await getIdentity();
  if (identity) await SecureStore.setItemAsync(PENDING_DELETE_KEY, JSON.stringify(identity));
}

async function runPendingDeviceDeletion(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PENDING_DELETE_KEY);
  if (!raw) return false;
  await deleteDeviceRemote(JSON.parse(raw) as Identity);
  await SecureStore.deleteItemAsync(PENDING_DELETE_KEY);
  await clearIdentity();
  return true;
}

// ---------- one run ----------

/**
 * One full sync: push the outbox (facts, then outcomes), pull knowledge for the rider's zone, heartbeat.
 * Overlapping runs are refused. Never throws: failures land in the status store.
 */
export async function syncOnce(): Promise<SyncSummary> {
  const summary = empty();
  if (isSyncing) return { ...summary, skipped: 'busy' };
  isSyncing = true;
  try {
    await refreshPending();
    // local housekeeping first, so it also happens offline: drop knowledge for a zone we no longer subscribe to
    summary.pruned = (await pruneUnsubscribed().catch(() => ({ groups: [], points: 0 }))).points;
    if (await isOffline()) {
      setSyncState({ status: 'offline' });
      return { ...summary, skipped: 'offline' };
    }

    setSyncState({ status: 'pushing', lastError: null });
    if (await runPendingDeviceDeletion()) {
      setSyncState({ status: 'idle' });
      return { ...summary, deletedDevice: true };
    }

    await push(summary);

    setSyncState({ status: 'pulling' });
    await pull(summary);
    await heartbeat();

    const now = Date.now();
    await setSetting('last_sync_at', String(now));
    setSyncState({
      status: 'idle',
      lastSyncAt: now,
      lastError: null,
      lastPulled: summary.pulled || summary.tombstones ? { points: summary.pulled, tombstones: summary.tombstones } : null,
    });
    return summary;
  } catch (e) {
    summary.error = message(e);
    const offlineish = e instanceof NetworkError;
    setSyncState({ status: 'error', lastError: summary.error });
    await logEvent('sync', offlineish ? 'warn' : 'error', summary.error);
    return summary;
  } finally {
    isSyncing = false;
    await refreshPending().catch(() => undefined);
  }
}

export const isSyncRunning = () => isSyncing;
