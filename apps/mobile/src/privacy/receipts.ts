import {
  GENESIS_HASH,
  receiptHash,
  verifyChain,
  type BlockedReceiptEntry,
  type ReceiptRecord,
  type SharedFact,
} from '@hive/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDb, logEvent } from '@/core/db';

import { scanEntities } from './entities';
import { unreceiptedVerdicts } from './outbox';

export interface OutboxRow {
  id: number;
  fact: string;
  status: string;
  attempts: number;
  next_at: number;
  created_at: number;
  type: 'fact' | 'outcome';
}

export interface Receipt {
  id: number;
  ts: number;
  sent: SharedFact[];
  blocked: BlockedReceiptEntry[];
  prev_hash: string;
  hash: string;
}

function parseReceipt(r: ReceiptRecord): Receipt {
  const parse = <T>(s: string): T[] => {
    try {
      return JSON.parse(s) as T[];
    } catch {
      return [];
    }
  };
  return { id: r.id, ts: r.ts, sent: parse<SharedFact>(r.sent), blocked: parse<BlockedReceiptEntry>(r.blocked), prev_hash: r.prev_hash, hash: r.hash };
}

/**
 * Records the outcome of one successful upload (HTTP 200) in a single transaction:
 * outbox statuses, one hash-chained receipt, and the blocked verdicts it now covers.
 * A receipt only exists for facts the server actually answered for, never for an attempt that failed.
 *
 * - accepted facts go into `sent` (the exact JSON the server acknowledged);
 * - 'duplicate' rejections count as sent too: the server already had the fact, so an earlier upload
 *   whose receipt was lost (e.g. a crash) is still disclosed;
 * - other rejections did leave the phone, so they are disclosed as `server_rejected` with their reason;
 * - Leak Check blocks/rewrites since the last receipt are listed without their text.
 */
export async function commitUpload(
  batch: OutboxRow[],
  accepted: number[],
  rejected: { idx: number; reason: string }[],
): Promise<Receipt> {
  const db = await getDb();
  const acceptedSet = new Set(accepted);
  const rejectedByIdx = new Map(rejected.map((r) => [r.idx, r.reason]));
  const verdicts = await unreceiptedVerdicts();
  const ts = Date.now();

  const sent: SharedFact[] = [];
  const blocked: BlockedReceiptEntry[] = verdicts.map((v) => ({ ts: v.ts, kind: v.kind, action: v.action, reason: v.reason }));
  const statuses: [string, number][] = [];

  batch.forEach((row, idx) => {
    const fact = JSON.parse(row.fact) as SharedFact;
    const reason = rejectedByIdx.get(idx);
    if (acceptedSet.has(idx) || reason === 'duplicate') {
      sent.push(fact);
      statuses.push(['sent', row.id]);
    } else {
      blocked.push({ ts, kind: fact.kind, action: 'server_rejected', reason: reason ?? 'not acknowledged', fact });
      statuses.push([`rejected:${reason ?? 'unacknowledged'}`.slice(0, 60), row.id]);
    }
  });

  const sentJson = JSON.stringify(sent);
  const blockedJson = JSON.stringify(blocked);
  let receiptId = 0;
  let prev = GENESIS_HASH;
  let hash = '';

  await db.withTransactionAsync(async () => {
    const last = await db.getFirstAsync<{ hash: string }>('SELECT hash FROM receipts ORDER BY id DESC LIMIT 1');
    prev = last?.hash ?? GENESIS_HASH;
    hash = receiptHash(prev, ts, sentJson, blockedJson);
    const res = await db.runAsync('INSERT INTO receipts (ts, sent, blocked, prev_hash, hash) VALUES (?, ?, ?, ?, ?)', [
      ts,
      sentJson,
      blockedJson,
      prev,
      hash,
    ]);
    receiptId = res.lastInsertRowId;
    for (const [status, id] of statuses) await db.runAsync('UPDATE outbox SET status = ? WHERE id = ?', [status, id]);
    if (verdicts.length) {
      await db.runAsync(`UPDATE blocked_log SET receipted = 1 WHERE id IN (${verdicts.map(() => '?').join(',')})`, verdicts.map((v) => v.id));
    }
  });

  return { id: receiptId, ts, sent, blocked, prev_hash: prev, hash };
}

async function allRecords() {
  const db = await getDb();
  return db.getAllAsync<ReceiptRecord>('SELECT * FROM receipts ORDER BY id');
}

/**
 * Every fact this phone has ever had acknowledged by the server, flattened across all receipts. Used only to
 * detect, on the next pull, when one of *these* facts crosses the crowd's confirmation threshold and comes back
 * down as published knowledge (`sync/engine.ts`, `sync/confirmed.ts`) — the receipt is the only local record of
 * what you actually contributed, so it's also the only way to recognise your own vote landing.
 */
export async function allSentFacts(): Promise<SharedFact[]> {
  return (await allRecords()).flatMap((r) => parseReceipt(r).sent);
}

export async function listReceipts(limit = 100): Promise<Receipt[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReceiptRecord>('SELECT * FROM receipts ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map(parseReceipt);
}

/** Recomputes every hash. Returns the id of the first broken receipt, or null when the ledger is intact. */
export async function verifyLedger(): Promise<number | null> {
  return verifyChain(await allRecords());
}

export interface LedgerStats {
  receipts: number;
  factsShared: number;
  /** Leak Check blocks plus facts the server rejected. */
  factsBlocked: number;
  factsRewritten: number;
  /** Computed by re-scanning everything that was sent, not assumed. Expected to be 0. */
  personalDetailsShared: number;
}

export async function ledgerStats(): Promise<LedgerStats> {
  const receipts = (await allRecords()).map(parseReceipt);
  let factsShared = 0;
  let factsBlocked = 0;
  let factsRewritten = 0;
  let personalDetailsShared = 0;

  for (const r of receipts) {
    factsShared += r.sent.length;
    for (const b of r.blocked) {
      if (b.action === 'rewrite') factsRewritten++;
      else factsBlocked++;
    }
    for (const f of r.sent) {
      const allowNumeric = f.key.endsWith(':gate_code');
      if ((await scanEntities(`${f.key} ${f.text}`, { allowNumeric })) !== null) personalDetailsShared++;
    }
  }
  // verdicts not yet written into a receipt still count as blocked
  factsBlocked += (await unreceiptedVerdicts()).length;
  return { receipts: receipts.length, factsShared, factsBlocked, factsRewritten, personalDetailsShared };
}

/** Writes the whole ledger to a JSON file in the cache directory and returns its URI. */
export async function exportReceiptsFile(): Promise<{ uri: string; chainValid: boolean; count: number }> {
  const records = await allRecords();
  const brokenAt = verifyChain(records);
  const payload = {
    app: 'lastmeter',
    version: 1,
    exportedAt: new Date().toISOString(),
    chainValid: brokenAt === null,
    brokenAt,
    receipts: records.map(parseReceipt),
  };
  const file = new File(Paths.cache, `lastmeter-receipts-${Date.now()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(payload, null, 2));
  return { uri: file.uri, chainValid: brokenAt === null, count: records.length };
}

/** Opens the system share sheet (Save to Files, etc.) for the exported ledger. */
export async function shareReceipts() {
  const out = await exportReceiptsFile();
  if (!(await Sharing.isAvailableAsync())) {
    await logEvent('receipts', 'warn', 'sharing not available');
    return out;
  }
  await Sharing.shareAsync(out.uri, { mimeType: 'application/json', dialogTitle: 'LastMeter receipts' });
  return out;
}

/** Test-only: silently edits one receipt so "Verify integrity" can be shown catching it. */
export async function debugTamperReceipt(id: number) {
  const db = await getDb();
  await db.runAsync("UPDATE receipts SET sent = REPLACE(sent, 'is ', 'was ') || ' ' WHERE id = ?", [id]);
}
