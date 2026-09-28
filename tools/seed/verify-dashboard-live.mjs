// Live check of the dashboard against a RUNNING server and dashboard: pages, browser CORS, the SSE stream, the JSON
// shapes the dashboard reads, and its aggregation logic applied to real events. Uses a random zone and cleans up.
//
// NOTE: this exercises the server's new /v1/outcomes, /v1/admin/overview, /v1/admin/place-memory and
// /v1/admin/conflicts endpoints. It was written against the LastMeter plan's documented contract, not against
// the server's actual implementation (written in parallel) — if a field name below doesn't match what the server
// actually returns, that's a fast follow-up fix here, not evidence the server is wrong.
//
// Run: node tools/seed/verify-dashboard-live.mjs [serverUrl] [dashboardUrl] [adminKey]
import { join } from 'node:path';

import { loadTs, root } from './_load.mjs';

const server = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const dash = (process.argv[3] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const adminKey = process.argv[4] ?? 'dev-admin-key';
const ORIGIN = dash.replace('127.0.0.1', 'localhost');

const { perMinute, describeEvent, deletionEffects, mergeEvents } = loadTs(join(root, 'apps/dashboard/src/lib/aggregate.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const run = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, 'x');
const group = `zone:dash-${run}`;
const placeId = `place-${run}`;
const api = async (method, path, { body, token, admin } = {}) => {
  const res = await fetch(server + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(admin ? { 'x-admin-key': adminKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const admin = (path) => api('GET', path, { admin: true }).then((r) => r.data);
const devices = [];
const newDevice = async () => {
  const d = (await api('POST', '/v1/devices/register')).data;
  devices.push(d);
  return d;
};
const gateFact = (value) => ({ kind: 'place_fact', group, key: `${placeId}:gate_code`, value, text: `Gate code ${value}`, lat: 12.9352, lon: 77.6146 });

try {
  // ---------- the dashboard's pages ----------
  for (const path of ['/', '/place-memory', '/conflicts', '/activity', '/devices', '/safety']) {
    const res = await fetch(dash + path);
    const html = await res.text();
    check(`dashboard ${path} returns 200`, res.status === 200 && html.includes('LastMeter'), `${res.status}, ${html.length} bytes`);
  }
  const home = await (await fetch(dash + '/')).text();
  check('the app shell renders the connect form when signed out', /Connect to the server/.test(home) || /Loading/.test(home));

  // ---------- browser CORS ----------
  const pre = await fetch(`${server}/v1/admin/stats`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-admin-key' } });
  const allowHeaders = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  check('CORS preflight allows the x-admin-key header from the dashboard origin', pre.status < 300 && !!pre.headers.get('access-control-allow-origin') && allowHeaders.includes('x-admin-key'), `${pre.status}, allow-headers "${allowHeaders}"`);
  const wrong = await fetch(`${server}/v1/admin/stats`, { headers: { 'x-admin-key': 'nope', Origin: ORIGIN } });
  check('a wrong admin key is 401 (the connect form shows an error)', wrong.status === 401);

  // ---------- open the live stream like the dashboard does ----------
  const ctl = new AbortController();
  const sse = await fetch(`${server}/v1/admin/events?key=${encodeURIComponent(adminKey)}`, { headers: { Origin: ORIGIN }, signal: ctl.signal });
  check('SSE responds as an event stream with a CORS header', sse.status === 200 && /text\/event-stream/.test(sse.headers.get('content-type') ?? '') && !!sse.headers.get('access-control-allow-origin'));
  const seen = [];
  const reader = sse.body.getReader();
  (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) seen.push(JSON.parse(line.slice(6)));
      }
    }
  })();

  // ---------- drive real traffic: one place, an old code that fails, a new code that's delivered ----------
  const rider = await newDevice();
  await api('POST', '/v1/contributions', { token: rider.token, body: { facts: [gateFact('1111')] } });
  const afterContribute = await admin(`/v1/admin/place-memory/${encodeURIComponent(placeId)}`);
  const oldFact = afterContribute?.facts?.find((f) => f.value === '1111');
  check('a place_fact publishes immediately as unverified (no vote threshold)', oldFact?.status === 'unverified', JSON.stringify(afterContribute));

  // facts_shown takes the numeric knowledge point id (from place-memory/feed), not the "place:slot" key
  await api('POST', '/v1/outcomes', { token: rider.token, body: { outcomes: [{ stop_id: `${run}-1`, place_id: placeId, result: 'failed', door_seconds: 40, facts_shown: [oldFact.id], at: Date.now() }] } });
  await api('POST', '/v1/contributions', { token: rider.token, body: { facts: [gateFact('2222')] } });
  const afterSecond = await admin(`/v1/admin/place-memory/${encodeURIComponent(placeId)}`);
  const newFact = afterSecond?.facts?.find((f) => f.value === '2222');
  await api('POST', '/v1/outcomes', { token: rider.token, body: { outcomes: [{ stop_id: `${run}-2`, place_id: placeId, result: 'delivered', door_seconds: 20, facts_shown: [newFact.id], at: Date.now() }] } });

  const conflicts = await admin('/v1/admin/conflicts');
  check('the code change appears as a resolved conflict', conflicts?.resolved?.some((c) => c.data?.place_id === placeId && c.data?.from === '1111' && c.data?.to === '2222'), JSON.stringify(conflicts));

  const rej = await api('POST', '/v1/contributions', { token: rider.token, body: { facts: [{ kind: 'place_fact', group, key: `${placeId}:handover`, value: '9876543210', text: 'Call 9876543210 before handing over', lat: 12.9352, lon: 77.6146 }] } });
  check('a PII fact is rejected', rej.data.rejected[0]?.reason === 'pii');

  await api('DELETE', '/v1/devices/me', { token: rider.token });
  await new Promise((r) => setTimeout(r, 400));

  // ---------- the stream saw all of it ----------
  const types = new Set(seen.map((e) => e.type));
  check('the live stream delivered contribution, published, outcome, conflict_resolved, rejected and device_deleted', ['contribution', 'published', 'outcome', 'conflict_resolved', 'rejected', 'device_deleted'].every((t) => types.has(t)), [...types].join(', '));
  check('streamed events have the id / ts / type / data the dashboard needs', seen.every((e) => Number.isInteger(e.id) && Number.isFinite(e.ts) && typeof e.type === 'string' && typeof e.data === 'object'));

  // ---------- the dashboard's own logic on REAL events ----------
  const activity = (await admin('/v1/admin/activity?limit=300')).events;
  const merged = mergeEvents(activity, seen);
  check('activity + stream merge without duplicates, newest first', new Set(merged.map((e) => e.id)).size === merged.length && merged.every((e, i) => i === 0 || merged[i - 1].id > e.id));
  const buckets = perMinute(merged, Date.now(), 30);
  check('the sparkline counts the contributions just made in the current minute', buckets.at(-1).count + buckets.at(-2).count >= 2, `last two minutes: ${buckets.at(-2).count}+${buckets.at(-1).count}`);
  const resolvedEv = merged.find((e) => e.type === 'conflict_resolved' && e.data.place_id === placeId);
  check('the activity log describes the resolved conflict readably', !!resolvedEv && /1111 → 2222/.test(describeEvent(resolvedEv).detail), resolvedEv ? describeEvent(resolvedEv).detail : 'no event');
  const rejectedEv = merged.find((e) => e.type === 'rejected' && e.data.reason === 'pii');
  check('and the rejection with its reason', !!rejectedEv && /pii/.test(describeEvent(rejectedEv).detail));

  // ---------- JSON shapes the other pages read ----------
  const overview = await admin('/v1/admin/overview');
  check('overview has the 3 Overview tiles', ['stopsToday', 'firstAttemptSuccessPct', 'avgDoorSeconds'].every((k) => k in overview), JSON.stringify(overview));
  const places = (await admin('/v1/admin/place-memory')).places;
  check('place-memory lists our seeded place with lat/lon/status', places.some((p) => p.place_id === placeId && typeof p.lat === 'number' && typeof p.lon === 'number' && 'status' in p), JSON.stringify(places.find((p) => p.place_id === placeId)));
  const devs = await admin('/v1/admin/devices');
  check('Devices: short ids, timestamps, a stats slot, and the privacy note', devs.devices.every((d) => d.id.length === 8 && 'created_at' in d && 'last_seen' in d && 'stats' in d) && /private/.test(devs.note));
  const safety = await admin('/v1/admin/safety');
  check('Safety has rejected24h', safety.rejected24h.pii >= 1, JSON.stringify(safety));
  ctl.abort();
} finally {
  for (const d of devices) await api('DELETE', '/v1/devices/me', { token: d.token }).catch(() => {});
  console.log(`cleaned up ${devices.length} test devices`);
}
process.exit(failed ? 1 : 0);
