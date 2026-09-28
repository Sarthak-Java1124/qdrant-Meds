import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeKey, type Slot } from '@hive/shared';

import { buildApp } from '../src/app';
import { testConfig } from '../src/config';
import { Crowd } from '../src/crowd';
import { stubEmbed } from '../src/embed/stub';
import { EventBus } from '../src/events';
import { MemoryMeta } from '../src/meta/memory';
import { MemoryStore } from '../src/store/memory';

const ADMIN = { 'x-admin-key': 'dev-admin-key' };

function setup(over = {}) {
  const config = testConfig(over);
  const meta = new MemoryMeta();
  const store = new MemoryStore();
  const bus = new EventBus(meta);
  const crowd = new Crowd({ store, meta, embed: stubEmbed, config, bus });
  const app = buildApp({ config, crowd, meta, store, bus });
  const register = async () => (await app.inject({ method: 'POST', url: '/v1/devices/register' })).json() as { deviceId: string; token: string };
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  return { app, meta, register, auth, config };
}

const GROUP = 'zone:koramangala';
const placeFact = (placeId: string, slot: Slot, value: string, text: string) => ({
  kind: 'place_fact',
  group: GROUP,
  key: placeKey(placeId, slot),
  value,
  text,
});
const outcome = (stopId: string, placeId: string, result: 'delivered' | 'failed', factIds: (string | number)[], doorSeconds = 30, at = Date.now()) => ({
  stop_id: stopId,
  place_id: placeId,
  result,
  door_seconds: doorSeconds,
  facts_shown: factIds,
  at,
});

async function contribute(app: ReturnType<typeof setup>['app'], token: string, facts: unknown[]) {
  return (await app.inject({ method: 'POST', url: '/v1/contributions', headers: { authorization: `Bearer ${token}` }, payload: { facts } })).json();
}

test('register returns a random id and token; the token is stored only as a hash', async () => {
  const { app, register, meta } = setup();
  const d = await register();
  assert.match(d.deviceId, /^[0-9a-f]{16}$/);
  assert.match(d.token, /^[0-9a-f]{48}$/);
  assert.equal(meta.countDevices(), 1);
  assert.equal(meta.deviceByTokenHash(d.token), null, 'raw token must not be usable as the stored hash');
  await app.close();
});

test('an empty JSON body is accepted where none is needed, but malformed JSON is a 400', async () => {
  const { app, auth } = setup();
  const reg = await app.inject({ method: 'POST', url: '/v1/devices/register', headers: { 'content-type': 'application/json' } });
  assert.equal(reg.statusCode, 200);
  const { token } = reg.json() as { token: string };
  const del = await app.inject({ method: 'DELETE', url: '/v1/devices/me', headers: { ...auth(token), 'content-type': 'application/json' } });
  assert.equal(del.statusCode, 200);
  const bad = await app.inject({ method: 'POST', url: '/v1/devices/register', headers: { 'content-type': 'application/json' }, payload: '{not json' });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test('unauthenticated and unknown tokens get 401', async () => {
  const { app, auth } = setup();
  assert.equal((await app.inject({ method: 'GET', url: '/v1/knowledge?group=IN' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/knowledge?group=IN', headers: auth('nope') })).statusCode, 401);
  await app.close();
});

test('invalid bodies are 400; a gate_code numeric value is not flagged as PII, but a phone number in free text is', async () => {
  const { app, register, auth } = setup();
  const d = await register();
  const h = auth(d.token);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/contributions', headers: h, payload: { nope: 1 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/contributions', headers: h, payload: { facts: [] } })).statusCode, 400);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/contributions',
    headers: h,
    payload: {
      facts: [
        { kind: 'bad' },
        placeFact('tower4', 'gate_code', '4417', 'Gate code 4417'),
        placeFact('tower4', 'handover', 'guard', 'call 9876543210 before handover'),
      ],
    },
  });
  assert.deepEqual(res.json(), { accepted: [1], rejected: [{ idx: 0, reason: 'invalid' }, { idx: 2, reason: 'pii' }] });
  await app.close();
});

test('a place_fact contribution publishes immediately as unverified with 0.5 confidence', async () => {
  const { app, register, auth } = setup();
  const rider = await register();
  await contribute(app, rider.token, [placeFact('tower4', 'gate_code', '4417', 'Gate code 4417')]);

  const feed = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  assert.equal(feed.points.length, 1);
  assert.equal(feed.points[0].status, 'unverified');
  assert.equal(feed.points[0].confidence, 0.5);
  assert.equal(feed.points[0].value, '4417');
  assert.equal(feed.points[0].vector.length, 384);
  await app.close();
});

test('two delivered outcomes push a fact to verified; the overview tiles reflect the outcomes', async () => {
  const { app, register, auth } = setup();
  const rider = await register();
  await contribute(app, rider.token, [placeFact('tower4', 'gate_code', '4417', 'Gate code 4417')]);
  const feed = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  const factId = feed.points[0].id;

  const at = Date.now();
  await app.inject({ method: 'POST', url: '/v1/outcomes', headers: auth(rider.token), payload: { outcomes: [outcome('stop1', 'tower4', 'delivered', [factId], 20, at)] } });
  await app.inject({ method: 'POST', url: '/v1/outcomes', headers: auth(rider.token), payload: { outcomes: [outcome('stop2', 'tower4', 'delivered', [factId], 40, at + 1000)] } });

  const after = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  assert.equal(after.points[0].status, 'verified');
  assert.equal(after.points[0].successes, 2);

  const overview = (await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: ADMIN })).json();
  assert.equal(overview.stopsToday, 2);
  assert.equal(overview.firstAttemptSuccessPct, 100);
  assert.equal(overview.avgDoorSeconds, 30);
  await app.close();
});

test('a changed gate code: old value fails then a new one is delivered -> old is superseded, conflict_resolved fires', async () => {
  const { app, register, auth } = setup();
  const rider = await register();
  await contribute(app, rider.token, [placeFact('tower4', 'gate_code', '4417', 'Gate code 4417')]);
  const feedBefore = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  const oldId = feedBefore.points[0].id;

  const t0 = Date.now();
  await app.inject({ method: 'POST', url: '/v1/outcomes', headers: auth(rider.token), payload: { outcomes: [outcome('stop1', 'tower4', 'failed', [oldId], 90, t0)] } });

  await contribute(app, rider.token, [placeFact('tower4', 'gate_code', '8823', 'Gate code 8823')]);
  const feedMid = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  const newId = feedMid.points.find((p: { value: string }) => p.value === '8823').id;

  await app.inject({ method: 'POST', url: '/v1/outcomes', headers: auth(rider.token), payload: { outcomes: [outcome('stop2', 'tower4', 'delivered', [newId], 25, t0 + 1000)] } });

  const feedAfter = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  const oldAfter = feedAfter.points.find((p: { id: number }) => p.id === oldId);
  const newAfter = feedAfter.points.find((p: { id: number }) => p.id === newId);
  assert.equal(oldAfter.status, 'superseded');
  assert.equal(oldAfter.superseded_by, newId);
  assert.equal(newAfter.status, 'unverified'); // one delivery isn't enough to verify, but it did win the conflict

  const conflicts = (await app.inject({ method: 'GET', url: '/v1/admin/conflicts', headers: ADMIN })).json();
  assert.ok(conflicts.resolved.some((e: { type: string; data: { from: string; to: string } }) => e.type === 'conflict_resolved' && e.data.from === '4417' && e.data.to === '8823'));
  await app.close();
});

test('two riders reporting the same value accumulate on one knowledge point (confirmations = distinct riders)', async () => {
  const { app, register, auth } = setup();
  const a = await register();
  const b = await register();
  await contribute(app, a.token, [placeFact('tower4', 'lift', 'b:down', 'Lift B not working')]);
  await contribute(app, b.token, [placeFact('tower4', 'lift', 'b:down', 'Lift B not working')]);
  const feed = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(a.token) })).json();
  assert.equal(feed.points.length, 1);
  assert.equal(feed.points[0].confirmations, 2);
  await app.close();
});

test('knowledge query validation', async () => {
  const { app, register, auth } = setup();
  const d = await register();
  assert.equal((await app.inject({ method: 'GET', url: '/v1/knowledge', headers: auth(d.token) })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/knowledge?group=IN&limit=9999', headers: auth(d.token) })).statusCode, 400);
  await app.close();
});

test('heartbeat accepts counts only', async () => {
  const { app, register, auth } = setup();
  const d = await register();
  const ok = await app.inject({ method: 'POST', url: '/v1/heartbeat', headers: auth(d.token), payload: { items: { rider_note: 3 }, pending: 1, blocked: 0 } });
  assert.equal(ok.statusCode, 200);
  const bad = await app.inject({ method: 'POST', url: '/v1/heartbeat', headers: auth(d.token), payload: { items: { rider_note: 'a lot' } } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test('admin routes require the admin key and expose counts, never content of private memory', async () => {
  const { app, register, auth } = setup();
  assert.equal((await app.inject({ method: 'GET', url: '/v1/admin/stats' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: { 'x-admin-key': 'wrong' } })).statusCode, 401);

  const d = await register();
  await app.inject({ method: 'POST', url: '/v1/heartbeat', headers: auth(d.token), payload: { items: { rider_note: 3 }, pending: 1, blocked: 0 } });
  await contribute(app, d.token, [placeFact('a', 'entrance', 'rear', 'Rear entrance'), placeFact('b', 'handover', 'guard', 'call 9876543210')]);

  const stats = (await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: ADMIN })).json();
  assert.equal(stats.devices, 1);
  assert.equal(stats.knowledge, 1);

  const devices = (await app.inject({ method: 'GET', url: '/v1/admin/devices', headers: ADMIN })).json();
  assert.equal(devices.devices.length, 1);
  assert.equal(devices.devices[0].id.length, 8, 'only a short id is shown');
  assert.deepEqual(devices.devices[0].stats, { items: { rider_note: 3 }, pending: 1, blocked: 0 });
  assert.match(devices.note, /cannot see private memory/);
  assert.ok(!JSON.stringify(devices).includes(d.token), 'no token anywhere in the response');

  const safety = (await app.inject({ method: 'GET', url: '/v1/admin/safety', headers: ADMIN })).json();
  assert.equal(safety.rejected24h.pii, 1);

  const act = (await app.inject({ method: 'GET', url: '/v1/admin/activity?limit=50', headers: ADMIN })).json();
  assert.ok(act.events.some((e: { type: string }) => e.type === 'rejected'));
  assert.ok(act.events.some((e: { type: string }) => e.type === 'device_registered'));
  await app.close();
});

test('place-memory: one marker per place, best status wins, timeline lists every slot', async () => {
  const { app, register, auth } = setup();
  const d = await register();
  await contribute(app, d.token, [placeFact('tower4', 'gate_code', '4417', 'Gate code 4417'), placeFact('tower4', 'entrance', 'rear', 'Rear entrance')]);

  const map = (await app.inject({ method: 'GET', url: `/v1/admin/place-memory?group=${GROUP}`, headers: ADMIN })).json();
  assert.equal(map.places.length, 1);
  assert.equal(map.places[0].place_id, 'tower4');
  assert.equal(map.places[0].facts, 2);

  const detail = (await app.inject({ method: 'GET', url: `/v1/admin/place-memory/tower4?group=${GROUP}`, headers: ADMIN })).json();
  assert.equal(detail.facts.length, 2);
  assert.deepEqual(new Set(detail.facts.map((f: { slot: string }) => f.slot)), new Set(['gate_code', 'entrance']));
  await app.close();
});

test('registration is rate limited per IP', async () => {
  const { app } = setup({ registerPerHour: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'POST', url: '/v1/devices/register' })).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  await app.close();
});

test('deleting a device drops it from riders but the fact stays published', async () => {
  const { app, register, auth } = setup();
  const a = await register();
  const b = await register();
  await contribute(app, a.token, [placeFact('tower4', 'entrance', 'rear', 'Rear entrance')]);
  await contribute(app, b.token, [placeFact('tower4', 'entrance', 'rear', 'Rear entrance')]);

  await app.inject({ method: 'DELETE', url: '/v1/devices/me', headers: auth(a.token) });
  assert.equal((await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}`, headers: auth(a.token) })).statusCode, 401);

  const feed = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(b.token) })).json();
  assert.equal(feed.points.length, 1, 'the fact is not withdrawn just because one rider left');
  assert.equal(feed.points[0].confirmations, 1);
  await app.close();
});

test('demo reset: needs the admin key, keeps the version counter, and soft mode tells phones to remove what they downloaded', async () => {
  const { app, register, auth, meta } = setup();
  const rider = await register();
  await contribute(app, rider.token, [placeFact('tower4', 'gate_code', '4417', 'Gate code 4417')]);
  const feed = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=0`, headers: auth(rider.token) })).json();
  assert.equal(feed.points.length, 1);
  const version = meta.currentVersion();

  assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/reset', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/reset', headers: ADMIN, payload: { mode: 'nope' } })).statusCode, 400);

  const soft = (await app.inject({ method: 'POST', url: '/v1/admin/reset', headers: ADMIN, payload: { mode: 'soft' } })).json();
  assert.deepEqual([soft.mode, soft.devices, soft.withdrawn], ['soft', 1, 1]);
  const stats = (await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: ADMIN })).json();
  assert.equal(stats.devices, 0);
  assert.equal(stats.knowledge, 0);
  assert.equal(stats.tombstones, 1, 'the withdrawn fact is a tombstone phones can follow');
  assert.ok(meta.currentVersion() > version, 'version keeps counting');
  assert.equal((await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}`, headers: auth(rider.token) })).statusCode, 401, 'old tokens stop working');

  // a fresh phone with the pre-reset cursor sees the tombstone
  const fresh = await register();
  const after = (await app.inject({ method: 'GET', url: `/v1/knowledge?group=${GROUP}&since=${feed.next}`, headers: auth(fresh.token) })).json();
  assert.equal(after.tombstones.length, 1);

  const hard = (await app.inject({ method: 'POST', url: '/v1/admin/reset', headers: ADMIN, payload: {} })).json();
  assert.equal(hard.mode, 'hard');
  const stats2 = (await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: ADMIN })).json();
  assert.equal(stats2.tombstones, 0);
  assert.equal(stats2.devices, 0);
  const overview = (await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: ADMIN })).json();
  assert.equal(overview.stopsToday, 0, 'hard reset also clears the outcomes log');
  const act = (await app.inject({ method: 'GET', url: '/v1/admin/activity', headers: ADMIN })).json();
  assert.deepEqual(act.events.map((e: { type: string }) => e.type), ['reset'], 'the log restarts with one reset entry');
  await app.close();
});
