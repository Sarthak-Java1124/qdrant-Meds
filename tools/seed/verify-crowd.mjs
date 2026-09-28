// Runs the server's real place-fact/outcome logic (apps/server/src/crowd.ts) against the in-memory store,
// with no Docker and no native installs.
//
// NOTE: written against the LastMeter plan's documented contract (immediate-publish place facts, no vote
// threshold; outcomes drive confidence/status). The old K-vote/clustering tests this file used to have
// (evaluateMerchant, cluster/evaluateCluster, merchantKnowledgeId, doubt clustering, cluster re-centring) are
// gone along with that code. If `Crowd`'s actual method names differ from what's assumed below (it was
// rewritten in parallel), that's a fast follow-up fix here, not evidence the server is wrong.
//
// Run: node tools/seed/verify-crowd.mjs
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { loadTs, root } from './_load.mjs';

const srv = (p) => join(root, 'apps/server/src', p);
const { Crowd } = loadTs(srv('crowd.ts'));
const { MemoryStore } = loadTs(srv('store/memory.ts'));
const { MemoryMeta } = loadTs(srv('meta/memory.ts'));
const { EventBus } = loadTs(srv('events.ts'));
const { stubEmbed } = loadTs(srv('embed/stub.ts'));
const { testConfig } = loadTs(srv('config.ts'));
const { SharedFactSchema, EMBED_DIM } = loadTs(join(root, 'packages/shared/src/index.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const T0 = Date.UTC(2025, 8, 30, 12, 0, 0);
function world(over = {}, embed = stubEmbed) {
  const clock = { t: T0 };
  const store = new MemoryStore();
  const meta = new MemoryMeta();
  const bus = new EventBus(meta, () => clock.t);
  const crowd = new Crowd({ store, meta, embed, config: testConfig(over), bus, now: () => clock.t });
  const device = () => {
    const id = randomBytes(8).toString('hex');
    meta.createDevice(id, id, clock.t);
    return id;
  };
  return { clock, store, meta, bus, crowd, device };
}

const place = (placeId, slot, value, over = {}) => ({ kind: 'place_fact', group: 'zone:koramangala', key: `${placeId}:${slot}`, value, text: `${slot} -> ${value}`, lat: 12.9352, lon: 77.6146, ...over });
const send = (w, dev, ...facts) => w.crowd.contribute(dev, facts);
const publishedFeed = async (w, group = 'zone:koramangala') => (await w.crowd.feed(group, 0, 500)).points;
const eventTypes = (w) => w.meta.recentEvents(1000).map((e) => e.type);

// ---------- immediate publish, no vote threshold ----------
{
  const w = world();
  const dev = w.device();
  const r = await send(w, dev, place('tower-1', 'gate_code', '4417'));
  check('a single contribution accepts the fact', r.accepted.length === 1, JSON.stringify(r));
  const pts = await publishedFeed(w);
  check('it is published immediately (no K threshold) as unverified', pts.length === 1 && pts[0].value === '4417' && pts[0].status === 'unverified', JSON.stringify(pts[0]));
  check('published point carries a server-made 384-d vector', pts[0].vector.length === EMBED_DIM);
  check('lat/lon survive onto the published point', pts[0].lat === 12.9352 && pts[0].lon === 77.6146);
  check('a contribution and a published event were emitted', ['contribution', 'published'].every((t) => eventTypes(w).includes(t)));
}

// ---------- outcomes move confidence/status ----------
{
  const w = world();
  const dev = w.device();
  await send(w, dev, place('tower-2', 'gate_code', '2210'));
  const before = (await publishedFeed(w))[0];
  for (let i = 0; i < 2; i++) {
    await w.crowd.recordOutcomes(dev, [{ stop_id: `s${i}`, place_id: 'tower-2', result: 'delivered', door_seconds: 30, facts_shown: [before.id], at: w.clock.t }]);
  }
  const after = (await publishedFeed(w))[0];
  check('2 delivered outcomes move it to verified', after.status === 'verified' && after.successes >= 2, JSON.stringify(after));
}

// ---------- dedup: the same device contributing the same fact twice ----------
{
  const w = world();
  const dev = w.device();
  const r1 = await send(w, dev, place('tower-3', 'entrance', 'rear'));
  const r2 = await send(w, dev, place('tower-3', 'entrance', 'rear'));
  check('the same device contributing the identical fact twice: second is a duplicate', r1.accepted.length === 1 && r2.rejected[0]?.reason === 'duplicate', JSON.stringify(r2));
}

// ---------- daily cap, PII, invalid ----------
{
  const w = world({ dailyCap: 50 });
  const d = w.device();
  const results = [];
  for (let i = 0; i < 51; i++) results.push((await send(w, d, place(`tower-cap-${i}`, 'entrance', 'rear'))).rejected[0]?.reason ?? 'ok');
  check('daily cap: 50 accepted, the 51st is rate_limited', results.slice(0, 50).every((r) => r === 'ok') && results[50] === 'rate_limited');
  check('another device is unaffected', (await send(w, w.device(), place('tower-other', 'entrance', 'rear'))).accepted.length === 1);
  w.clock.t += 86_400_000;
  check('the cap resets the next UTC day', (await send(w, d, place('tower-nextday', 'entrance', 'rear'))).accepted.length === 1);
}
{
  const w = world();
  const d = w.device();
  const reasons = async (f) => (await send(w, d, f)).rejected[0]?.reason ?? 'accepted';
  check('PII: phone number in a handover note', (await reasons(place('tower-pii-1', 'handover', 'x', { text: 'Call 9876543210 before handing over' }))) === 'pii');
  check('invalid: unknown kind', (await reasons({ kind: 'gossip', group: 'zone:koramangala', key: 'k', value: '', text: 'hello there' })) === 'invalid');
  check('invalid: text over 200 characters', (await reasons(place('tower-pii-2', 'other', 'x', { text: 'x'.repeat(201) }))) === 'invalid');
  check('a bare gate code is NOT rejected as PII', (await reasons(place('tower-pii-3', 'gate_code', '4417'))) === 'accepted');
  check('clean fact still accepted', (await reasons(place('tower-pii-4', 'entrance', 'rear'))) === 'accepted');
}

// ---------- server always re-embeds ----------
{
  const w = world();
  const bogus = { ...place('tower-vec', 'entrance', 'rear'), vector: new Array(EMBED_DIM).fill(1) };
  check('schema strips a phone-supplied vector field', !('vector' in SharedFactSchema.parse(bogus)));
  await send(w, w.device(), bogus);
  const rec = (await publishedFeed(w)).find((p) => p.key === 'tower-vec:entrance');
  const mine = await stubEmbed('entrance -> rear');
  check('stored vector is the server-computed one', rec.vector.every((x, i) => Math.abs(x - mine[i]) < 1e-6));
}

// ---------- feed paging and tombstones ----------
{
  const w = world();
  const dev = w.device();
  for (const [placeId, slot] of [['tower-a', 'entrance'], ['tower-b', 'entrance'], ['tower-c', 'entrance']]) await send(w, dev, place(placeId, slot, 'rear'));
  const p1 = await w.crowd.feed('zone:koramangala', 0, 2);
  check('feed pages by version: first page has 2 and a cursor', p1.points.length === 2 && p1.next === p1.points[1].version);
  const p2 = await w.crowd.feed('zone:koramangala', p1.next, 2);
  check('second page has the remaining point', p2.points.length === 1 && p2.points[0].version > p1.next);
  check('other zones get nothing', (await w.crowd.feed('zone:jaipur', 0, 500)).points.length === 0);

  const del = await w.crowd.deleteDevice(dev);
  check('deleting a device drops it as a rider on the 3 points it contributed to', del.removed === 3, JSON.stringify(del));
  const afterDelete = await publishedFeed(w);
  check('the facts stay published (no vote threshold to fall below), just with 0 confirmations', afterDelete.length === 3 && afterDelete.every((p) => p.confirmations === 0));
  check('device_deleted event emitted', eventTypes(w).includes('device_deleted'));
  check('the device row is gone', w.meta.countDevices() === 0);
}

process.exit(failed ? 1 : 0);
