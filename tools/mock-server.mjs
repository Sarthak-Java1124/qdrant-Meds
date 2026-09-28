// A tiny stand-in for the LastMeter backend, so the phone's sync engine can be tested end to end.
// It speaks the real API contract (validated with the shared zod schemas) but has no publish/confidence logic:
// contributions are accepted as-is, and "published knowledge" is whatever /_admin/* puts there.
//
// Run: node tools/mock-server.mjs            (listens on 0.0.0.0:8787)
//   trigger rules for tests: key containing REJECTME -> rejected "pii"; text containing DUPLICATE -> "duplicate".
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { loadTs, root } from './seed/_load.mjs';

const { SharedFactSchema, ContributionRequestSchema, EMBED_DIM } = loadTs(join(root, 'packages/shared/src/index.ts'));
const PORT = Number(process.env.PORT ?? 8787);

const devices = new Map(); // token -> { deviceId, seen: Set }
const contributions = []; // everything accepted, for inspection
const knowledge = new Map(); // id -> point
const tombstones = []; // { id, group, version }
let version = 0;
let nextId = 1000;

// deterministic unit vector per id: enough to exercise the phone's crowd shard without a model
function vectorFor(id) {
  let s = id * 2654435761 >>> 0;
  const v = Array.from({ length: EMBED_DIM }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  });
  const n = Math.hypot(...v);
  return v.map((x) => +(x / n).toFixed(6));
}

function publish({ kind = 'place_fact', group = 'zone:demo', key, value = '', text, confirmations = 1, lat = 12.9352, lon = 77.6146, successes = 0, failures = 0, confidence = 0.5, status = 'unverified', observed_at = Date.now() }) {
  const id = nextId++;
  const point = { id, version: ++version, kind, group, key, value, text: text ?? `${key} -> ${value}`, confirmations, vector: vectorFor(id), lat, lon, successes, failures, confidence, status, observed_at };
  knowledge.set(id, point);
  return point;
}

// a few demo place facts the phone's zone pack will pick up
for (const [key, value, text] of [
  ['demo-1:gate_code', '4417', 'Gate code 4417'],
  ['demo-2:entrance', 'rear', 'Entrance: rear gate'],
  ['demo-3:handover', 'guard', 'Hand to the guard'],
]) {
  publish({ key, value, text });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (path === '/health') return json(res, 200, { ok: true, devices: devices.size, knowledge: knowledge.size, version });

    // ----- test controls -----
    if (path === '/_admin/state') return json(res, 200, { devices: devices.size, contributions: contributions.length, knowledge: knowledge.size, tombstones: tombstones.length, version });
    if (path === '/_admin/contributions') return json(res, 200, contributions);
    if (path === '/_admin/publish' && req.method === 'POST') return json(res, 200, publish(await readBody(req)));
    if (path === '/_admin/seed' && req.method === 'POST') {
      const { n = 100, group = 'IN' } = await readBody(req);
      for (let i = 0; i < n; i++) publish({ group, key: `SEED ${version + 1} MART`, value: 'Groceries' });
      log(`seeded ${n} points, version ${version}`);
      return json(res, 200, { version, knowledge: knowledge.size });
    }
    if (path === '/_admin/reset' && req.method === 'POST') {
      // delete every seeded point (keys starting SEED) as tombstones
      for (const p of [...knowledge.values()].filter((p) => p.key.startsWith('SEED '))) {
        knowledge.delete(p.id);
        tombstones.push({ id: p.id, group: p.group, version: ++version });
      }
      return json(res, 200, { version, knowledge: knowledge.size, tombstones: tombstones.length });
    }
    if (path === '/_admin/unpublish' && req.method === 'POST') {
      const { key } = await readBody(req);
      for (const p of [...knowledge.values()].filter((p) => p.key === key)) {
        knowledge.delete(p.id);
        tombstones.push({ id: p.id, group: p.group, version: ++version });
      }
      return json(res, 200, { version });
    }

    // ----- the real API contract -----
    if (path === '/v1/devices/register' && req.method === 'POST') {
      const identity = { deviceId: randomUUID(), token: randomUUID() };
      devices.set(identity.token, { deviceId: identity.deviceId, seen: new Set() });
      log('registered', identity.deviceId);
      return json(res, 200, identity);
    }

    const device = devices.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!device) return json(res, 401, { error: 'unknown device' });

    if (path === '/v1/contributions' && req.method === 'POST') {
      const parsed = ContributionRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: 'invalid', issues: parsed.error.issues.length });
      const accepted = [];
      const rejected = [];
      parsed.data.facts.forEach((f, idx) => {
        const id = `${f.kind}|${f.group}|${f.key}`;
        if (f.key.includes('REJECTME')) rejected.push({ idx, reason: 'pii' });
        else if (f.text.includes('DUPLICATE') || device.seen.has(id)) rejected.push({ idx, reason: 'duplicate' });
        else {
          device.seen.add(id);
          contributions.push({ deviceId: device.deviceId, fact: f });
          accepted.push(idx);
        }
      });
      log(`contributions: ${accepted.length} accepted, ${rejected.length} rejected`);
      return json(res, 200, { accepted, rejected });
    }

    if (path === '/v1/knowledge' && req.method === 'GET') {
      const group = url.searchParams.get('group');
      const since = Number(url.searchParams.get('since') ?? 0);
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 500);
      // points and tombstones interleave by version; the page is the first `limit` of them
      const items = [
        ...[...knowledge.values()].filter((p) => p.group === group && p.version > since).map((p) => ({ v: p.version, point: p })),
        ...tombstones.filter((t) => t.group === group && t.version > since).map((t) => ({ v: t.version, tomb: t.id })),
      ].sort((a, b) => a.v - b.v).slice(0, limit);
      const points = items.filter((i) => i.point).map((i) => i.point);
      const tombs = items.filter((i) => i.tomb !== undefined).map((i) => i.tomb);
      const next = items.length ? items[items.length - 1].v : null;
      log(`knowledge ${group} since ${since}: ${points.length} points, ${tombs.length} tombstones`);
      return json(res, 200, { points, tombstones: tombs, next });
    }

    if (path === '/v1/heartbeat' && req.method === 'POST') {
      log('heartbeat', JSON.stringify(await readBody(req)));
      return json(res, 200, { ok: true });
    }

    if (path === '/v1/devices/me' && req.method === 'DELETE') {
      devices.delete((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      for (let i = contributions.length - 1; i >= 0; i--) if (contributions[i].deviceId === device.deviceId) contributions.splice(i, 1);
      log('device deleted', device.deviceId);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', e);
    return json(res, 500, { error: String(e) });
  }
}).listen(PORT, '0.0.0.0', () => log(`mock LastMeter API on http://0.0.0.0:${PORT}`));
