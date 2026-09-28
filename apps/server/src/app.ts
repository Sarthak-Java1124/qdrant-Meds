import { randomBytes, timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import { HeartbeatSchema, OutcomeRequestSchema, parsePlaceKey, sha256Hex, type FactStatus } from '@hive/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config';
import type { Crowd } from './crowd';
import type { EventBus } from './events';
import type { Meta } from './meta/types';
import type { KnowledgeRecord, Store } from './store/types';

export interface AppDeps {
  config: Config;
  crowd: Crowd;
  meta: Meta;
  store: Store;
  bus: EventBus;
  now?: () => number;
}

declare module 'fastify' {
  interface FastifyRequest {
    deviceId?: string;
  }
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const shortId = (id: string) => id.slice(0, 8);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const ContributionBody = z.object({ facts: z.array(z.unknown()).min(1).max(50) });
const KnowledgeQuery = z.object({
  group: z.string().min(1).max(96),
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

/** Best-status-wins ranking for collapsing a place's many facts into one map marker. */
const STATUS_RANK: Record<FactStatus, number> = { verified: 2, unverified: 1, superseded: 0 };

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, crowd, meta, store, bus } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  void app.register(cors, { origin: true });

  // Fastify rejects `Content-Type: application/json` with an empty body (FST_ERR_CTP_EMPTY_JSON_BODY). Clients like
  // register/DELETE legitimately send none, so an empty JSON body is treated as {}. Malformed JSON is still a 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }), undefined);
    }
  });

  // ---------- device auth ----------
  const requireDevice = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const device = token ? meta.deviceByTokenHash(sha256Hex(token)) : null;
    if (!device) return reply.code(401).send({ error: 'unknown device' });
    req.deviceId = device.id;
    meta.touchDevice(device.id, now());
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    // EventSource cannot set headers, so the SSE stream also accepts ?key=
    const key = String(req.headers['x-admin-key'] ?? (req.query as Record<string, string | undefined>).key ?? '');
    if (!key || !safeEqual(key, config.adminKey)) return reply.code(401).send({ error: 'admin key required' });
  };

  app.get('/health', async () => ({ ok: true, devices: meta.countDevices(), version: meta.currentVersion() }));

  // ---------- devices ----------
  const registrations = new Map<string, number[]>();
  app.post('/v1/devices/register', async (req, reply) => {
    const recent = (registrations.get(req.ip) ?? []).filter((t) => now() - t < HOUR);
    if (recent.length >= config.registerPerHour) return reply.code(429).send({ error: 'too many registrations' });
    registrations.set(req.ip, [...recent, now()]);

    // random id + token: no account, name or phone number. Only a hash of the token is stored.
    const deviceId = randomBytes(8).toString('hex');
    const token = randomBytes(24).toString('hex');
    meta.createDevice(deviceId, sha256Hex(token), now());
    bus.emit('device_registered', { device: shortId(deviceId) });
    return { deviceId, token };
  });

  app.delete('/v1/devices/me', { preHandler: requireDevice }, async (req) => {
    const res = await crowd.deleteDevice(req.deviceId!);
    return { ok: true, ...res };
  });

  app.post('/v1/heartbeat', { preHandler: requireDevice }, async (req, reply) => {
    const parsed = HeartbeatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    meta.putHeartbeat(req.deviceId!, now(), parsed.data); // counts only, opt-in
    return { ok: true };
  });

  // ---------- contributions (place facts) ----------
  app.post('/v1/contributions', { preHandler: requireDevice }, async (req, reply) => {
    const body = ContributionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    return crowd.contribute(req.deviceId!, body.data.facts);
  });

  // ---------- outcomes (delivery results) ----------
  app.post('/v1/outcomes', { preHandler: requireDevice }, async (req, reply) => {
    const body = OutcomeRequestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    await crowd.recordOutcomes(req.deviceId!, body.data.outcomes);
    return { ok: true };
  });

  // ---------- knowledge feed ----------
  const lastSynced = new Map<string, number>();
  app.get('/v1/knowledge', { preHandler: requireDevice }, async (req, reply) => {
    const q = KnowledgeQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid' });
    const id = req.deviceId!;
    if (now() - (lastSynced.get(id) ?? 0) > 60_000) {
      lastSynced.set(id, now());
      bus.emit('device_synced', { device: shortId(id) });
    }
    return crowd.feed(q.data.group, q.data.since, q.data.limit);
  });

  // ---------- admin (dashboard). Counts and published knowledge only: never anything private. ----------
  const admin = { preHandler: requireAdmin };

  app.get('/v1/admin/stats', admin, async () => {
    const t = now();
    const midnight = t - (t % DAY);
    const counts = await store.counts();
    const day = meta.eventCounts(t - DAY);
    return {
      devices: meta.countDevices(),
      activeDevices5m: meta.activeDevices(t - 5 * 60_000),
      contributionsToday: meta.eventCounts(midnight).contribution ?? 0,
      knowledge: counts.knowledge,
      tombstones: counts.tombstones,
      version: meta.currentVersion(),
      last24h: day,
      config: { dailyCap: config.dailyCap },
    };
  });

  app.get('/v1/admin/overview', admin, async () => {
    const t = now();
    return meta.overviewStats(t - (t % DAY));
  });

  app.get('/v1/admin/knowledge', admin, async (req) => {
    const q = z.object({ group: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    const rows = await store.scrollKnowledge({ group: q.group, limit: q.limit, includeDeleted: true, sinceVersion: 0 });
    return { knowledge: rows.map((r) => ({ id: r.id, ...r.payload })).sort((a, b) => b.version - a.version) };
  });

  // one marker per place: best-status fact wins, plus how many facts we hold for it
  app.get('/v1/admin/place-memory', admin, async (req) => {
    const q = z.object({ group: z.string().optional() }).parse(req.query);
    const rows = await store.scrollKnowledge({ group: q.group, includeDeleted: false, limit: 10_000 });
    const byPlace = new Map<string, { place_id: string; lat?: number; lon?: number; status: FactStatus; facts: number }>();
    for (const r of rows) {
      const { placeId } = parsePlaceKey(r.payload.key);
      const cur = byPlace.get(placeId);
      if (!cur) {
        byPlace.set(placeId, { place_id: placeId, lat: r.payload.lat, lon: r.payload.lon, status: r.payload.status, facts: 1 });
      } else {
        cur.facts++;
        if (STATUS_RANK[r.payload.status] > STATUS_RANK[cur.status]) cur.status = r.payload.status;
        if (cur.lat === undefined && r.payload.lat !== undefined) [cur.lat, cur.lon] = [r.payload.lat, r.payload.lon];
      }
    }
    return { places: [...byPlace.values()] };
  });

  // every fact at one place, across slots, including its supersede chain (deleted excluded, superseded kept)
  app.get('/v1/admin/place-memory/:placeId', admin, async (req) => {
    const { placeId } = z.object({ placeId: z.string().min(1) }).parse(req.params);
    const q = z.object({ group: z.string().optional() }).parse(req.query);
    const rows = await store.scrollKnowledge({ group: q.group, includeDeleted: false, limit: 10_000 });
    const facts = rows
      .filter((r) => parsePlaceKey(r.payload.key).placeId === placeId)
      .map((r) => ({ id: r.id, slot: parsePlaceKey(r.payload.key).slot, ...r.payload }))
      .sort((a, b) => b.version - a.version);
    return { place_id: placeId, facts };
  });

  // resolved conflicts from the activity log, plus any still-open (2+ live values for one place+slot)
  app.get('/v1/admin/conflicts', admin, async (req) => {
    const q = z.object({ group: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const resolved = meta.recentEvents(2000).filter((e) => e.type === 'conflict_resolved').slice(0, q.limit);

    const rows = await store.scrollKnowledge({ group: q.group, includeDeleted: false, limit: 10_000 });
    const bySlotPlace = new Map<string, KnowledgeRecord[]>();
    for (const r of rows) {
      const { placeId, slot } = parsePlaceKey(r.payload.key);
      const k = `${r.payload.group}|${placeId}|${slot}`;
      bySlotPlace.set(k, [...(bySlotPlace.get(k) ?? []), r]);
    }
    const open = [...bySlotPlace.entries()]
      .filter(([, facts]) => facts.length > 1)
      .map(([k, facts]) => {
        const [group, place_id, slot] = k.split('|');
        return { group, place_id, slot, values: facts.map((f) => ({ id: f.id, value: f.payload.value, confidence: f.payload.confidence, status: f.payload.status })) };
      });
    return { resolved, open };
  });

  app.get('/v1/admin/devices', admin, async () => ({
    note: 'The cloud cannot see private memory by design; use the in-app Memory Inspector.',
    devices: meta.listDevices().map((d) => ({
      id: shortId(d.id),
      created_at: d.created_at,
      last_seen: d.last_seen,
      // opt-in counts only (items per source, pending, blocked); never content
      stats: d.heartbeat,
      stats_at: d.heartbeat_ts,
    })),
  }));

  app.get('/v1/admin/activity', admin, async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return { events: meta.recentEvents(limit) };
  });

  app.get('/v1/admin/safety', admin, async () => {
    const t = now();
    const rejected: Record<string, number> = {};
    for (const e of meta.recentEvents(5000)) {
      if (e.type !== 'rejected' || e.ts < t - DAY) continue;
      const reason = String((e.data as { reason?: string }).reason ?? 'unknown');
      rejected[reason] = (rejected[reason] ?? 0) + 1;
    }
    return { rejected24h: rejected };
  });

  // demo reset (tools/reset.ts). hard = drop everything; soft = withdraw published facts first so phones remove them.
  app.post('/v1/admin/reset', admin, async (req, reply) => {
    const body = z.object({ mode: z.enum(['hard', 'soft']).default('hard') }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'mode must be hard or soft' });
    return { ok: true, ...(await crowd.reset(body.data.mode)) };
  });

  // live activity over Server-Sent Events
  app.get('/v1/admin/events', admin, (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    raw.write(': connected\n\n');
    const unsubscribe = bus.subscribe((e) => raw.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  return app;
}
