// Proves the pure-JS SHA-256 against Node's crypto, and the receipt chain / tamper detection / backoff logic.
// Run: node tools/seed/verify-receipts.mjs
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { loadTs, root } from './_load.mjs';

const { sha256Hex, receiptHash, verifyChain, GENESIS_HASH, backoffMinutes } = loadTs(join(root, 'packages/shared/src/index.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const node = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// --- SHA-256 ---
check('empty string (known vector)', sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
check('"abc" (known vector)', sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
let same = true;
for (const len of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 5000]) {
  const s = randomBytes(len).toString('base64').slice(0, len);
  if (sha256Hex(s) !== node(s)) same = false;
}
check('matches Node crypto for lengths around the 55/56/64-byte padding boundaries', same);
const uni = 'Café ₹450 — नमस्ते 😀 “quotes”';
check('multi-byte UTF-8 (₹, Devanagari, emoji)', sha256Hex(uni) === node(uni));
check('lone surrogate becomes U+FFFD like Node', sha256Hex('a\ud800b') === node('a\ud800b'));

// --- receipt chain ---
const make = (n) => {
  const rows = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const ts = 1_700_000_000_000 + i * 1000;
    const sent = JSON.stringify([{ kind: 'merchant_category', group: 'IN', key: `SHOP ${i}`, value: 'Groceries', text: `SHOP ${i} is Groceries` }]);
    const blocked = JSON.stringify(i % 2 ? [{ ts, kind: 'doubt', action: 'block', reason: 'too close to your private chat' }] : []);
    const hash = receiptHash(prev, ts, sent, blocked);
    rows.push({ id: i, ts, sent, blocked, prev_hash: prev, hash });
    prev = hash;
  }
  return rows;
};

const chain = make(6);
check('genesis links to 64 zeros', chain[0].prev_hash === '0'.repeat(64));
check('clean chain verifies', verifyChain(chain) === null);
check('empty chain verifies', verifyChain([]) === null);

const tampered = structuredClone(chain);
tampered[3].sent = tampered[3].sent.replace('Groceries', 'Shopping');
check('editing a receipt reports its exact id', verifyChain(tampered) === 4, String(verifyChain(tampered)));

const blockedEdit = structuredClone(chain);
blockedEdit[2].blocked = '[]';
check('hiding a blocked verdict is detected', verifyChain(blockedEdit) === 3);

const deleted = chain.filter((r) => r.id !== 3);
check('deleting a middle receipt breaks the chain at the next one', verifyChain(deleted) === 4);

const reordered = [chain[0], chain[2], chain[1], ...chain.slice(3)];
check('reordering receipts is detected', verifyChain(reordered) === 3);

const rehashed = structuredClone(chain);
rehashed[1].sent = '[]';
rehashed[1].hash = receiptHash(rehashed[1].prev_hash, rehashed[1].ts, rehashed[1].sent, rehashed[1].blocked);
check('recomputing one hash still breaks the next link', verifyChain(rehashed) === 3);

check('truncating the tail is not detectable by hashes alone (documented limit)', verifyChain(chain.slice(0, 4)) === null);

// --- backoff ---
const b = [0, 1, 2, 3, 5, 6, 7, 10].map(backoffMinutes);
check('backoff doubles then caps at 60 minutes', JSON.stringify(b) === JSON.stringify([1, 2, 4, 8, 32, 60, 60, 60]), b.join(','));

// --- status pill text ---
const { statusLabel, ago } = loadTs(join(root, 'apps/mobile/src/sync/statusLabel.ts'));
const now = 1_700_000_000_000;
const snap = (status, pendingCount = 0, lastSyncAt = null) => ({ status, pendingCount, lastSyncAt });
check('pill: offline', statusLabel(snap('offline'), now) === 'Offline');
check('pill: offline with pending', statusLabel(snap('offline', 2), now) === 'Offline · 2 pending');
check('pill: syncing', statusLabel(snap('pushing'), now) === 'Syncing…' && statusLabel(snap('pulling'), now) === 'Syncing…');
check('pill: pending wins over synced', statusLabel(snap('idle', 3, now - 1000), now) === '3 pending');
check('pill: synced 2m ago', statusLabel(snap('idle', 0, now - 120_000), now) === 'Synced 2m ago');
check('pill: never synced', statusLabel(snap('idle'), now) === 'Not synced yet');
check('ago: seconds / hours / days', ago(now - 5000, now) === 'just now' && ago(now - 3 * 3600_000, now) === '3h ago' && ago(now - 2 * 86_400_000, now) === '2d ago');

process.exit(failed ? 1 : 0);
