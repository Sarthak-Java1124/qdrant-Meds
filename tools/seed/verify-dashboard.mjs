// Offline checks for the dashboard's pure logic: sparkline buckets, activity text, deletion effects, event merging.
// Run: node tools/seed/verify-dashboard.mjs
import { join } from 'node:path';

import { loadTs, root } from './_load.mjs';

const { perMinute, mergeEvents, describeEvent, deletionEffects, timeAgo, progressPct, EVENT_GROUPS } = loadTs(join(root, 'apps/dashboard/src/lib/aggregate.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const NOW = Date.UTC(2025, 8, 30, 12, 30, 20);
const MIN = 60_000;
const ev = (id, type, msAgo, data = {}) => ({ id, type, ts: NOW - msAgo, data });

// ---------- sparkline ----------
const events = [
  ev(1, 'contribution', 5_000),
  ev(2, 'contribution', 10_000),
  ev(3, 'contribution', 70_000),
  ev(4, 'contribution', 29 * MIN),
  ev(5, 'contribution', 45 * MIN), // outside the 30-minute window
  ev(6, 'rejected', 5_000), // not a contribution
];
const b = perMinute(events, NOW, 30);
check('30 one-minute buckets, oldest first', b.length === 30 && b[0].ts < b[29].ts && b[29].ts - b[0].ts === 29 * MIN);
check('the last bucket is the current minute', b[29].ts === Math.floor(NOW / MIN) * MIN);
check('two contributions in the current minute', b[29].count === 2, String(b[29].count));
check('one in the previous minute', b[28].count === 1);
check('a 29-minute-old contribution lands in the first bucket', b[0].count === 1);
check('older ones and other event types are ignored', b.reduce((s, x) => s + x.count, 0) === 4);
check('empty input gives all zeros', perMinute([], NOW, 10).every((x) => x.count === 0));

// ---------- merging ----------
const m1 = mergeEvents([ev(3, 'contribution', 0), ev(1, 'contribution', 0)], [ev(2, 'contribution', 0), ev(3, 'contribution', 0)]);
check('merge de-duplicates by id and sorts newest first', m1.map((e) => e.id).join() === '3,2,1');
check('merge caps the list', mergeEvents([], Array.from({ length: 10 }, (_, i) => ev(i + 1, 'x', 0)), 4).length === 4);
check('merge keeps the newest when capping', mergeEvents([], Array.from({ length: 10 }, (_, i) => ev(i + 1, 'x', 0)), 4)[0].id === 10);

// ---------- activity text ----------
const d1 = describeEvent(ev(1, 'rejected', 0, { reason: 'pii', device: 'ab12cd34' }));
check('rejected shows the reason and is bad', d1.label === 'Rejected' && /pii/.test(d1.detail) && d1.tone === 'bad', d1.detail);
const d2 = describeEvent(ev(2, 'published', 0, { key: 'tower-4:gate_code', value: '8823', status: 'verified', version: 3, updated: false }));
check('published shows key -> value, status and version', d2.label === 'Published' && /tower-4:gate_code → 8823/.test(d2.detail) && /verified/.test(d2.detail) && /v3/.test(d2.detail) && d2.tone === 'good', d2.detail);
const d2b = describeEvent(ev(2, 'published', 0, { key: 'tower-4:gate_code', value: '8823', status: 'unverified', version: 3, updated: true }));
check('an unverified publish is neutral tone; an update is labelled Updated', d2b.label === 'Updated' && d2b.tone === 'neutral', d2b.detail);
check('unpublished says a tombstone was sent', /tombstone/.test(describeEvent(ev(4, 'unpublished', 0, { key: 'tower-4:gate_code', version: 9 })).detail));
const d3 = describeEvent(ev(5, 'outcome', 0, { stop_id: 's1', place_id: 'tower-4', device: 'aa', result: 'delivered', door_seconds: 25 }));
check('a delivered outcome is good tone and shows the stop/place/door time', d3.label === 'Delivered' && d3.tone === 'good' && /tower-4/.test(d3.detail) && /25s/.test(d3.detail), d3.detail);
const d4 = describeEvent(ev(6, 'outcome', 0, { stop_id: 's2', place_id: 'tower-4', device: 'bb', result: 'failed' }));
check('a failed outcome is bad tone', d4.label === 'Failed' && d4.tone === 'bad');
const d5 = describeEvent(ev(7, 'conflict_resolved', 0, { place_id: 'tower-4', slot: 'gate_code', from: '4417', to: '8823' }));
check('conflict_resolved shows old -> new value', d5.tone === 'good' && /4417 → 8823/.test(d5.detail), d5.detail);
check('device deleted shows how much was removed', /12 contributions removed/.test(describeEvent(ev(8, 'device_deleted', 0, { device: 'aa', removed: 12 })).detail));
check('unknown event types still render', describeEvent(ev(9, 'mystery', 0, { a: 1 })).label === 'mystery');
check('missing fields do not print "undefined"', !/undefined/.test(describeEvent(ev(10, 'contribution', 0, {})).detail));

// ---------- deletion effects ----------
const del = [
  ev(10, 'device_deleted', 20_000, { device: 'aaaa1111', removed: 3 }),
  ev(11, 'unpublished', 19_500, { key: 'A' }),
  ev(12, 'unpublished', 19_000, { key: 'B' }),
  ev(13, 'unpublished', 8_000, { key: 'C' }), // much later: unrelated
  ev(14, 'device_deleted', 6_000, { device: 'bbbb2222', removed: 0 }),
];
const fx = deletionEffects(del);
check('two deletions, newest first', fx.length === 2 && fx[0].device === 'bbbb2222' && fx[1].device === 'aaaa1111');
check('the first deletion unpublished two facts (the later one is not counted)', fx[1].unpublished === 2 && fx[1].removed === 3, JSON.stringify(fx[1]));
check('a deletion that affected nothing shows 0', fx[0].unpublished === 0);

// ---------- helpers ----------
check('timeAgo buckets', timeAgo(NOW - 2_000, NOW) === 'just now' && timeAgo(NOW - 30_000, NOW) === '30s ago' && timeAgo(NOW - 5 * MIN, NOW) === '5m ago' && timeAgo(NOW - 3 * 3600_000, NOW) === '3h ago' && timeAgo(NOW - 2 * 86_400_000, NOW) === '2d ago');
check('timeAgo of nothing is "never"', timeAgo(null, NOW) === 'never' && timeAgo(0, NOW) === 'never');
check('progressPct clamps to 0-100', progressPct(3, 5) === 60 && progressPct(9, 5) === 100 && progressPct(0, 5) === 0 && progressPct(1, 0) === 100);
check('every activity filter group has event types except All', Object.entries(EVENT_GROUPS).every(([k, v]) => k === 'All' || v.length > 0));
check('the outcome/conflict event types are grouped under Outcomes', EVENT_GROUPS.Outcomes?.includes('outcome') && EVENT_GROUPS.Outcomes?.includes('conflict_resolved'));
check('the old voting-only event types are gone', !Object.values(EVENT_GROUPS).flat().includes('cluster_progress') && !Object.values(EVENT_GROUPS).flat().includes('no_majority'));

process.exit(failed ? 1 : 0);
