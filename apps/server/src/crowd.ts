import {
  SharedFactSchema,
  fnv1a,
  parsePlaceKey,
  scanPii,
  sparseEncode,
  type FactStatus,
  type KnowledgePoint,
  type Outcome,
  type SharedFact,
  type Slot,
} from '@hive/shared';

import type { Config } from './config';
import type { Embed } from './embed/types';
import type { EventBus } from './events';
import type { Meta } from './meta/types';
import type { KnowledgePayload, KnowledgeRecord, Store } from './store/types';

export type Rejection = 'invalid' | 'pii' | 'rate_limited' | 'duplicate';

export interface ContributeResult {
  /** Indexes into the request's `facts` array. */
  accepted: number[];
  rejected: { idx: number; reason: Rejection }[];
}

export interface Feed {
  points: KnowledgePoint[];
  tombstones: number[];
  /** Highest version among points AND tombstones, so a tombstone-only page still moves the phone's cursor. */
  next: number | null;
}

/**
 * A place fact's knowledge id is derived from (group, key, value) so the same claim from different riders
 * always lands on the same point (that's how `riders` accumulates), while a genuinely different value for
 * the same place+slot gets its own point (that's how conflicts arise, for resolveConflicts to settle later).
 * Always >= 2^32, mirroring the old merchant-id convention (no other id space to avoid colliding with any more).
 */
export function placeFactId(group: string, key: string, value: string): number {
  const s = `place_fact|${group}|${key}|${value}`;
  return (1 + (fnv1a(s) % 0xfffff)) * 2 ** 32 + fnv1a(`k:${s}`);
}

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const shortId = (id: string) => id.slice(0, 8);

/** Free-text slots where two different-looking values might just be paraphrases of the same thing. */
const FREE_TEXT_SLOTS = new Set<Slot>(['entrance', 'handover', 'access', 'hazard', 'parking', 'timing', 'other']);
const PARAPHRASE_SIM = 0.85;
const DAY_MS = 86_400_000;
/** Exponential recency decay, half-life ~10 days at 14-day time constant. */
const recency = (ts: number, now: number) => Math.exp(-(now - ts) / (14 * DAY_MS));

const toPoint = (r: KnowledgeRecord): KnowledgePoint => ({
  id: r.id,
  version: r.payload.version,
  kind: r.payload.kind,
  group: r.payload.group,
  key: r.payload.key,
  value: r.payload.value,
  text: r.payload.text,
  confirmations: r.payload.confirmations,
  vector: r.vector.map((x) => Math.round(x * 1e6) / 1e6),
  lat: r.payload.lat,
  lon: r.payload.lon,
  successes: r.payload.successes,
  failures: r.payload.failures,
  confidence: r.payload.confidence,
  status: r.payload.status,
  superseded_by: r.payload.superseded_by,
  last_success_at: r.payload.last_success_at,
  observed_at: r.payload.observed_at,
});

export interface CrowdDeps {
  store: Store;
  meta: Meta;
  embed: Embed;
  config: Config;
  bus: EventBus;
  now?: () => number;
}

/**
 * The server's brain for place facts: a rider's contribution publishes immediately as `unverified` (no
 * multi-device voting any more — LastMeter has exactly one fact kind and confidence comes from delivery
 * OUTCOMES, not votes). PII rejection and a daily cap are still enforced; anti-poisoning now lives in
 * `recordOutcomes`/`resolveConflicts` (a bad fact loses to outcome evidence, not to being outvoted).
 */
export class Crowd {
  constructor(private d: CrowdDeps) {}

  private now() {
    return this.d.now?.() ?? Date.now();
  }

  // ---------- contributions ----------

  async contribute(deviceId: string, rawFacts: unknown[]): Promise<ContributeResult> {
    const result: ContributeResult = { accepted: [], rejected: [] };
    for (let idx = 0; idx < rawFacts.length; idx++) {
      const parsed = SharedFactSchema.safeParse(rawFacts[idx]);
      const reason = parsed.success ? await this.accept(deviceId, parsed.data) : 'invalid';
      if (reason) {
        result.rejected.push({ idx, reason });
        this.d.bus.emit('rejected', { reason, device: shortId(deviceId) });
      } else {
        result.accepted.push(idx);
      }
    }
    return result;
  }

  private async accept(deviceId: string, fact: SharedFact): Promise<Rejection | null> {
    const { store, meta, embed, config, bus } = this.d;
    const { slot } = parsePlaceKey(fact.key);

    // defence in depth: the phone already ran its Leak Check, but the server never trusts that.
    // A gate_code's value is a bare 3-6 digit number, which would otherwise look like a 'reference'/PII hit.
    if (scanPii(fact.key) ?? scanPii(fact.text, { allowNumeric: slot === 'gate_code' })) return 'pii';

    const date = new Date(this.now()).toISOString().slice(0, 10);
    if (meta.dailyCount(deviceId, date) >= config.dailyCap) return 'rate_limited';

    const id = placeFactId(fact.group, fact.key, fact.value);
    const existing = await store.getKnowledge(id);
    if (existing && !existing.payload.deleted && existing.payload.riders.includes(deviceId) && existing.payload.text === fact.text) {
      return 'duplicate';
    }

    const vector = await embed(fact.text); // always embedded here; phones never send vectors
    meta.incrDaily(deviceId, date);
    bus.emit('contribution', { key: fact.key, device: shortId(deviceId) });
    await this.publishPlaceFact(deviceId, id, fact, vector);
    return null;
  }

  /** Publish immediately (no K-vote threshold): new value -> new unverified point, known value -> add this rider. */
  private async publishPlaceFact(deviceId: string, id: number, fact: SharedFact, vector: number[]) {
    const { store, meta, bus } = this.d;
    const existing = await store.getKnowledge(id);
    const now = this.now();

    if (existing && !existing.payload.deleted) {
      const riders = existing.payload.riders.includes(deviceId) ? existing.payload.riders : [...existing.payload.riders, deviceId];
      if (riders.length === existing.payload.riders.length && existing.payload.text === fact.text) return; // no-op duplicate
      const version = meta.nextVersion();
      const payload: KnowledgePayload = { ...existing.payload, text: fact.text, riders, confirmations: riders.length, version };
      await store.upsertKnowledge(id, existing.vector, sparseEncode(fact.text), payload);
      bus.emit('published', { id, key: fact.key, value: fact.value, version, confirmations: riders.length, updated: true });
      return;
    }

    const version = meta.nextVersion();
    const payload: KnowledgePayload = {
      kind: fact.kind,
      group: fact.group,
      key: fact.key,
      value: fact.value,
      text: fact.text,
      version,
      confirmations: 1,
      deleted: false,
      lat: fact.lat,
      lon: fact.lon,
      successes: 0,
      failures: 0,
      confidence: 0.5,
      status: 'unverified',
      observed_at: now,
      riders: [deviceId],
    };
    await store.upsertKnowledge(id, vector, sparseEncode(fact.text), payload);
    bus.emit('published', { id, key: fact.key, value: fact.value, version, confirmations: 1, updated: false });
  }

  // ---------- outcomes ----------

  /**
   * A delivery result adjusts the confidence/status of the facts shown for that stop, then re-checks the
   * place for conflicts (two live facts disagreeing on the same slot).
   */
  async recordOutcomes(deviceId: string, outcomes: Outcome[]): Promise<void> {
    const { store, meta, bus } = this.d;
    const touched = new Map<string, string>(); // place_id -> group

    for (const o of outcomes) {
      meta.addOutcome({ stop_id: o.stop_id, place_id: o.place_id, device_id: deviceId, result: o.result, door_seconds: o.door_seconds, at: o.at });

      for (const rawId of o.facts_shown) {
        const id = Number(rawId);
        const existing = await store.getKnowledge(id);
        if (!existing || existing.payload.deleted) continue;
        const p = existing.payload;

        const successes = p.successes + (o.result === 'delivered' ? 1 : 0);
        const failures = p.failures + (o.result === 'failed' ? 1 : 0);
        const confidence = (successes + 1) / (successes + failures + 2);
        const status: FactStatus = p.status === 'superseded' ? 'superseded' : successes >= 2 && confidence >= 0.7 ? 'verified' : 'unverified';
        const last_success_at = o.result === 'delivered' ? o.at : p.last_success_at;

        const version = meta.nextVersion();
        const payload: KnowledgePayload = { ...p, successes, failures, confidence, status, last_success_at, version };
        await store.upsertKnowledge(id, existing.vector, sparseEncode(p.text), payload);
        bus.emit('outcome', { id, place_id: o.place_id, slot: parsePlaceKey(p.key).slot, result: o.result, door_seconds: o.door_seconds, confidence, status });
        touched.set(o.place_id, p.group);
      }
    }

    for (const [placeId, group] of touched) await this.resolveConflicts(placeId, group);
  }

  /**
   * For each slot at a place with 2+ live facts, pick a winner by confidence * recency and supersede a
   * clearly-outdated loser (it has since failed, and the winner has a newer success). Free-text slots get
   * a semantic check first: if the two texts are just paraphrases of the same thing (real embedding cosine
   * >= 0.85), leave both live instead of superseding one.
   */
  async resolveConflicts(placeId: string, group: string): Promise<void> {
    const { store, meta, embed, bus } = this.d;
    const now = this.now();
    const rows = await store.scrollKnowledge({ group, includeDeleted: false, limit: 10_000 });
    const atPlace = rows.filter((r) => parsePlaceKey(r.payload.key).placeId === placeId);

    const bySlot = new Map<Slot, KnowledgeRecord[]>();
    for (const r of atPlace) {
      const { slot } = parsePlaceKey(r.payload.key);
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), r]);
    }

    for (const [slot, facts] of bySlot) {
      if (facts.length < 2) continue;
      const score = (f: KnowledgeRecord) => f.payload.confidence * recency(f.payload.last_success_at ?? f.payload.observed_at, now);
      const winner = facts.reduce((a, b) => (score(b) > score(a) ? b : a));

      for (const f of facts) {
        if (f.id === winner.id || f.payload.value === winner.payload.value) continue;

        if (FREE_TEXT_SLOTS.has(slot)) {
          const [va, vb] = await Promise.all([embed(winner.payload.text), embed(f.payload.text)]);
          if (dot(va, vb) >= PARAPHRASE_SIM) continue; // same meaning: leave both live
        }

        const winnerNewer = (winner.payload.last_success_at ?? 0) > (f.payload.last_success_at ?? 0);
        if (winnerNewer && f.payload.failures >= 1) {
          const version = meta.nextVersion();
          await store.upsertKnowledge(f.id, f.vector, sparseEncode(f.payload.text), {
            ...f.payload,
            status: 'superseded',
            superseded_by: winner.id,
            version,
          });
          bus.emit('conflict_resolved', { place_id: placeId, slot, from: f.payload.value, to: winner.payload.value });
        }
      }
    }
  }

  // ---------- reads ----------

  /** Knowledge changes for one group since a version. Live points carry their vector; deleted ones are ids only. */
  async feed(group: string, since: number, limit: number): Promise<Feed> {
    const rows = await this.d.store.scrollKnowledge({ group, sinceVersion: since, limit, includeDeleted: true });
    const points: KnowledgePoint[] = [];
    const tombstones: number[] = [];
    for (const r of rows) {
      if (r.payload.deleted) tombstones.push(r.id);
      else points.push(toPoint(r));
    }
    return { points, tombstones, next: rows.length ? rows[rows.length - 1].payload.version : null };
  }

  // ---------- demo reset ----------

  /**
   * Wipes the server between rehearsals. `hard` drops the collection. `soft` first withdraws every published
   * fact (tombstones), so phones that already downloaded them remove them on their next sync. Either way
   * devices, counters, outcomes and the activity log are cleared, but the version counter keeps counting so
   * no phone's sync cursor ends up ahead.
   */
  async reset(mode: 'hard' | 'soft') {
    const { store, meta, bus } = this.d;
    const before = await store.counts();
    let withdrawn = 0;
    if (mode === 'soft') {
      for (const k of await store.scrollKnowledge({ limit: 100_000, includeDeleted: false })) {
        await this.unpublish(k.id);
        withdrawn++;
      }
    } else {
      await store.clear();
    }
    const devices = meta.countDevices();
    meta.reset();
    bus.emit('reset', { mode, devices, knowledge: before.knowledge, withdrawn });
    return { mode, devices, withdrawn };
  }

  private async unpublish(id: number) {
    const { store, meta, bus } = this.d;
    const existing = await store.getKnowledge(id);
    if (!existing || existing.payload.deleted) return;
    const version = meta.nextVersion();
    await store.upsertKnowledge(id, existing.vector, sparseEncode(existing.payload.text), { ...existing.payload, version, deleted: true });
    bus.emit('unpublished', { key: existing.payload.key, id, version });
  }

  // ---------- deletion ----------

  /** "Delete everything" on a phone. No vote threshold to fall below any more: just drop the device from `riders`. */
  async deleteDevice(deviceId: string) {
    const { store, meta, bus } = this.d;
    const rows = await store.scrollKnowledge({ limit: 100_000, includeDeleted: false });
    let removed = 0;
    for (const r of rows) {
      if (!r.payload.riders.includes(deviceId)) continue;
      const riders = r.payload.riders.filter((x) => x !== deviceId);
      const version = meta.nextVersion();
      await store.upsertKnowledge(r.id, r.vector, sparseEncode(r.payload.text), { ...r.payload, riders, confirmations: riders.length, version });
      removed++;
    }
    meta.deleteDevice(deviceId);
    bus.emit('device_deleted', { device: shortId(deviceId), removed });
    return { removed };
  }
}
