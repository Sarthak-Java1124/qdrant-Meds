// End-to-end check of a RUNNING LastMeter server (real Qdrant + real MiniLM), through HTTP only.
// Every run uses its own random zone, so it never collides with real data, and it deletes its devices at the end.
//
// NOTE: written against the LastMeter plan's documented server contract (immediate-publish place facts,
// /v1/outcomes, /v1/admin/{overview,place-memory,conflicts}), not against the server's actual implementation
// (rewritten in parallel from the old merchant/doubt K-vote system). If a field name below doesn't match what
// the server actually returns, that's a fast follow-up fix here, not evidence the server is wrong.
//
// Run: node tools/seed/verify-server.mjs [baseUrl] [adminKey]
const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const adminKey = process.argv[3] ?? 'dev-admin-key';
const run = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, 'x'); // letters only: digit runs would trip the PII scan
const zone = `zone:vrf-${run}`;
const placeA = `place-a-${run}`;
const placeB = `place-b-${run}`;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const call = async (method, path, { body, token, admin } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(admin ? { 'x-admin-key': adminKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const devices = [];
const newDevice = async () => {
  const { data } = await call('POST', '/v1/devices/register');
  devices.push(data);
  return data;
};
const post = (d, ...facts) => call('POST', '/v1/contributions', { token: d.token, body: { facts } });
const outcome = (d, o) => call('POST', '/v1/outcomes', { token: d.token, body: { outcomes: [o] } });
const feed = async (d, group, since = 0, limit = 500) => (await call('GET', `/v1/knowledge?group=${encodeURIComponent(group)}&since=${since}&limit=${limit}`, { token: d.token })).data;
const gate = (placeId, value) => ({ kind: 'place_fact', group: zone, key: `${placeId}:gate_code`, value, text: `Gate code ${value}`, lat: 12.9352, lon: 77.6146 });

try {
  const health = (await call('GET', '/health')).data;
  console.log(`server: ${JSON.stringify(health)}`);
  check('health responds', health.ok === true);

  const viewer = await newDevice();

  // ---------- immediate publish, no vote threshold ----------
  const rider1 = await newDevice();
  await post(rider1, gate(placeA, '4417'));
  const f1 = await feed(viewer, zone);
  const pointA = f1.points.find((p) => p.key === `${placeA}:gate_code`);
  check('a place_fact publishes immediately from ONE device, as unverified', !!pointA && pointA.value === '4417' && pointA.status === 'unverified', JSON.stringify(pointA));
  check('vector round-trips through Qdrant as a unit 384-d vector', pointA.vector.length === 384 && Math.abs(Math.hypot(...pointA.vector) - 1) < 1e-3, `norm ${Math.hypot(...pointA.vector).toFixed(4)}`);
  check('it carries lat/lon for the geo index', pointA.lat === 12.9352 && pointA.lon === 77.6146);

  // ---------- outcomes drive confidence/status, not votes ----------
  for (let i = 0; i < 2; i++) await outcome(rider1, { stop_id: `${run}-a-${i}`, place_id: placeA, result: 'delivered', door_seconds: 30, facts_shown: [pointA.id], at: Date.now() });
  const f2 = await feed(viewer, zone);
  const pointA2 = f2.points.find((p) => p.key === `${placeA}:gate_code`);
  check('2 delivered outcomes move it to verified', pointA2?.status === 'verified' && pointA2.successes >= 2, JSON.stringify(pointA2));

  // ---------- conflict: the code changes, old fails, new is delivered -> old is superseded ----------
  await outcome(rider1, { stop_id: `${run}-a-fail`, place_id: placeA, result: 'failed', door_seconds: 90, facts_shown: [pointA.id], at: Date.now() });
  const rider2 = await newDevice();
  await post(rider2, gate(placeA, '8823'));
  const f3 = await feed(viewer, zone);
  const newCode = f3.points.find((p) => p.key === `${placeA}:gate_code` && p.value === '8823');
  await outcome(rider2, { stop_id: `${run}-a-fixed`, place_id: placeA, result: 'delivered', door_seconds: 20, facts_shown: [newCode.id], at: Date.now() });
  const conflicts = (await call('GET', '/v1/admin/conflicts', { admin: true })).data;
  check('the old code is superseded and the conflict shows up resolved', conflicts?.resolved?.some((c) => c.data?.place_id === placeA && c.data?.from === '4417' && c.data?.to === '8823'), JSON.stringify(conflicts));
  const f4 = await feed(viewer, zone);
  check('a fresh feed no longer offers the superseded code as live', !f4.points.some((p) => p.key === `${placeA}:gate_code` && p.value === '4417' && p.status !== 'superseded'), JSON.stringify(f4.points.filter((p) => p.key === `${placeA}:gate_code`)));

  // ---------- paging on the real order_by ----------
  await post(rider1, { kind: 'place_fact', group: zone, key: `${placeB}:entrance`, value: 'rear', text: 'Entrance: rear gate', lat: 12.9352, lon: 77.6146 });
  const p1 = await feed(viewer, zone, 0, 1);
  check('feed pages by version on the real order_by (limit 1 -> oldest first)', p1.points.length === 1 && p1.next === p1.points[0].version);
  const other = await feed(viewer, `zone:vrf-${run}-other`);
  check('other zones are empty', other.points.length === 0 && other.tombstones.length === 0);

  // ---------- server-side rejection ----------
  const bad = await post(rider1, { ...gate(placeB, '9876543210'), key: `${placeB}:gate_code` }, { kind: 'gossip', group: zone, key: 'x', value: '', text: 'hello' }, { kind: 'place_fact', group: zone, key: `${placeB}:handover`, value: 'guard', text: 'Hand to the guard', lat: 12.9352, lon: 77.6146 });
  check('PII and invalid facts rejected per fact, clean one accepted', bad.data.rejected.some((r) => r.reason === 'pii') && bad.data.rejected.some((r) => r.reason === 'invalid') && bad.data.accepted.length === 1, JSON.stringify(bad.data));
  check('a bare 3-6 digit gate code is NOT treated as PII', (await post(rider1, gate(placeB, '5566'))).data.accepted.length === 1);
  check('a bad request body is 400', (await call('POST', '/v1/contributions', { token: viewer.token, body: { nope: 1 } })).status === 400);
  check('unknown token is 401', (await call('GET', `/v1/knowledge?group=${zone}`, { token: 'nope' })).status === 401);
  check('admin routes need the key', (await call('GET', '/v1/admin/stats')).status === 401);

  // ---------- deletion and tombstones ----------
  const before = await feed(viewer, zone);
  const cursor = before.next;
  await call('DELETE', '/v1/devices/me', { token: rider1.token });
  const after = await feed(viewer, zone, cursor);
  check('a tombstone-only page still advances the cursor (or is empty if nothing changed)', after.next === null || after.next > cursor, `next ${after.next}, cursor ${cursor}`);
  check('the deleted device token stops working', (await call('GET', `/v1/knowledge?group=${zone}`, { token: rider1.token })).status === 401);

  // ---------- admin + live SSE ----------
  const stats = (await call('GET', '/v1/admin/stats', { admin: true })).data;
  check('admin stats', stats.devices >= 1 && stats.knowledge >= 1, `${stats.devices} devices, ${stats.contributionsToday} contributions today`);
  const overview = (await call('GET', '/v1/admin/overview', { admin: true })).data;
  check('admin overview has the 3 tiles', ['stopsToday', 'firstAttemptSuccessPct', 'avgDoorSeconds'].every((k) => k in overview), JSON.stringify(overview));
  const devList = (await call('GET', '/v1/admin/devices', { admin: true })).data;
  check('admin devices: short ids, no tokens, the privacy note', devList.devices.every((d) => d.id.length === 8) && !JSON.stringify(devList).includes(viewer.token) && /private/.test(devList.note));
  const safety = (await call('GET', '/v1/admin/safety', { admin: true })).data;
  check('safety counts the rejected PII', safety.rejected24h.pii >= 1, JSON.stringify(safety));

  const ctl = new AbortController();
  const sse = await fetch(`${base}/v1/admin/events?key=${encodeURIComponent(adminKey)}`, { signal: ctl.signal });
  const reader = sse.body.getReader();
  const seen = new Promise(async (resolve) => {
    let buf = '';
    const timer = setTimeout(() => resolve(null), 4000);
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buf += new TextDecoder().decode(value);
      const m = buf.match(/data: (\{.*"type":"contribution".*\})\n/);
      if (m) {
        clearTimeout(timer);
        resolve(JSON.parse(m[1]));
        break;
      }
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  await post(viewer, { kind: 'place_fact', group: zone, key: `${placeB}:parking`, value: 'gate 2', text: 'Parking: gate 2', lat: 12.9352, lon: 77.6146 });
  const ev = await seen;
  ctl.abort();
  check('SSE streams the contribution live', ev?.type === 'contribution', ev ? JSON.stringify(ev.data) : 'no event in 4s');
} finally {
  for (const d of devices) await call('DELETE', '/v1/devices/me', { token: d.token }).catch(() => {});
  console.log(`cleaned up ${devices.length} test devices`);
}
process.exit(failed ? 1 : 0);
