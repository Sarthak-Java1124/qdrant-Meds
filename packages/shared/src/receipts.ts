import { sha256Hex } from './sha256';
import type { FactKind, SharedFact } from './types';

/** The first receipt links back to this. */
export const GENESIS_HASH = '0'.repeat(64);

/** One row of the receipt ledger, exactly as stored on the phone. `sent` and `blocked` are JSON strings. */
export interface ReceiptRecord {
  id: number;
  ts: number;
  sent: string;
  blocked: string;
  prev_hash: string;
  hash: string;
}

/** A Leak Check verdict as recorded in a receipt. Deliberately carries no text: blocked text is private. */
export interface BlockedReceiptEntry {
  ts: number;
  kind: FactKind;
  action: 'block' | 'rewrite' | 'server_rejected';
  reason: string;
  /** Only for `server_rejected`: the fact did leave the phone, so it is disclosed here. */
  fact?: SharedFact;
}

/** hash = SHA-256(prev_hash + ts + sent + blocked). Each receipt commits to everything before it. */
export const receiptHash = (prev: string, ts: number, sent: string, blocked: string) =>
  sha256Hex(prev + ts + sent + blocked);

/** Recomputes the chain (rows in id order). Returns the id of the first broken receipt, or null when intact. */
export function verifyChain(rows: ReceiptRecord[]): number | null {
  let prev = GENESIS_HASH;
  for (const r of rows) {
    if (r.prev_hash !== prev || receiptHash(prev, r.ts, r.sent, r.blocked) !== r.hash) return r.id;
    prev = r.hash;
  }
  return null;
}

/** Retry delay after `attempts` failed uploads: 2^attempts minutes, capped at 60. */
export const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 60);
