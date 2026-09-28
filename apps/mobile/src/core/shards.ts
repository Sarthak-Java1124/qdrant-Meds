import { EMBED_DIM, type FactKind, type FactStatus, type Source, type SparseVec } from '@hive/shared';
import { Directory, Paths } from 'expo-file-system';
import { AppState } from 'react-native';
import {
  createShard,
  loadShard,
  mobileWalDefaults,
  type EdgeConfig,
  type FieldIndexType,
  type Filter,
  type PointId,
  type ScoredPoint,
  type Shard,
} from 'react-native-qdrant-edge';

import { getSetting, logEvent, setSetting } from './db';

export type ShardName = 'private' | 'crowd';

/** Payload stored with each private point (never leaves the phone). */
export interface PrivatePayload {
  source: Source;
  text: string;
  ts: number;
  /** items.ext_id, so a hit can be traced back to the source record. */
  ref: string;
}

/** Payload stored with each crowd point (downloaded knowledge only) — the phone's mirror of a place fact. */
export interface CrowdPayload {
  kind: FactKind;
  group: string;
  /** `${place_id}:${slot}` */
  key: string;
  value: string;
  text: string;
  version: number;
  confirmations: number;
  lat?: number;
  lon?: number;
  successes: number;
  failures: number;
  confidence: number;
  status: FactStatus;
  superseded_by?: string | number;
  last_success_at?: number;
  observed_at: number;
}

export interface Hit<P> {
  /** Point IDs come back from the native layer as strings; numeric ones are converted. */
  id: number | string;
  score: number;
  payload: P;
}

const CONFIG: EdgeConfig = {
  vectors: { d: { size: EMBED_DIM, distance: 'Cosine' } },
  sparse_vectors: { s: { modifier: 'idf' } },
  wal_options: mobileWalDefaults(),
};

const INDEXES: Record<ShardName, [string, FieldIndexType][]> = {
  private: [
    ['source', 'keyword'],
    ['ts', 'integer'],
  ],
  crowd: [
    ['kind', 'keyword'],
    ['group', 'keyword'],
    ['key', 'keyword'],
    ['version', 'integer'],
    ['status', 'keyword'],
  ],
};

const OPTIMIZE_AFTER_POINTS = 500;

const open = new Map<ShardName, Shard>();

function shardDir(name: ShardName) {
  return new Directory(Paths.document, name);
}

function nativePath(dir: Directory) {
  return dir.uri.replace('file://', '').replace(/\/$/, '');
}

const toId = (id: string): number | string => (/^\d+$/.test(id) ? Number(id) : id);

function toHit<P>(p: ScoredPoint): Hit<P> {
  return { id: toId(p.id), score: p.score, payload: (p.payload ?? {}) as P };
}

/** Opens the shard, creating it (with its field indexes) on first use. */
export function getShard(name: ShardName): Shard {
  const cached = open.get(name);
  if (cached) return cached;

  const dir = shardDir(name);
  // Qdrant Edge creates <path>/wal but not <path>, so the folder must exist first.
  // A `wal` subfolder means a shard was already created here.
  const exists = new Directory(dir, 'wal').exists;
  if (!dir.exists) dir.create({ idempotent: true });

  let shard: Shard;
  if (exists) {
    shard = loadShard(nativePath(dir));
  } else {
    shard = createShard(nativePath(dir), CONFIG);
    for (const [field, type] of INDEXES[name]) shard.createFieldIndex(field, type);
    shard.flush();
  }
  open.set(name, shard);
  return shard;
}

async function noteWrites(name: ShardName, n: number) {
  const key = `new_points_${name}`;
  const total = Number(await getSetting(key, '0')) + n;
  await setSetting(key, String(total));
}

export interface PrivatePointInput {
  id: number;
  dense: number[];
  sparse: SparseVec;
  payload: PrivatePayload;
}

export interface CrowdPointInput {
  id: number | string;
  dense: number[];
  sparse: SparseVec;
  payload: CrowdPayload;
}

export async function upsertPrivate(points: PrivatePointInput[]) {
  if (!points.length) return;
  const shard = getShard('private');
  shard.upsert(points.map((p) => ({ id: p.id, vector: { d: p.dense, s: p.sparse }, payload: { ...p.payload } })));
  shard.flush();
  await noteWrites('private', points.length);
}

export async function upsertCrowd(points: CrowdPointInput[]) {
  if (!points.length) return;
  const shard = getShard('crowd');
  shard.upsert(points.map((p) => ({ id: p.id, vector: { d: p.dense, s: p.sparse }, payload: { ...p.payload } })));
  shard.flush();
  await noteWrites('crowd', points.length);
}

export function deletePrivate(ids: PointId[]) {
  if (!ids.length) return;
  const shard = getShard('private');
  shard.deletePoints(ids);
  shard.flush();
}

export function deleteCrowd(ids: PointId[]) {
  if (!ids.length) return;
  const shard = getShard('crowd');
  shard.deletePoints(ids);
  shard.flush();
}

function denseSearch<P>(name: ShardName, vector: number[], filter?: Filter, limit = 10): Hit<P>[] {
  return getShard(name)
    .search({ vector, using: 'd', limit, filter, with_payload: true })
    .map((p) => toHit<P>(p));
}

export function searchPrivate(vector: number[], filter?: Filter, limit = 10) {
  return denseSearch<PrivatePayload>('private', vector, filter, limit);
}

export function searchCrowd(vector: number[], filter?: Filter, limit = 10) {
  return denseSearch<CrowdPayload>('crowd', vector, filter, limit);
}

export function sparseSearch<P>(name: ShardName, vector: SparseVec, filter?: Filter, limit = 10): Hit<P>[] {
  if (!vector.indices.length) return [];
  return getShard(name)
    .search({ vector, using: 's', limit, filter, with_payload: true })
    .map((p) => toHit<P>(p));
}

export { denseSearch };

export interface ShardStats {
  points: number;
  /** Point counts by `source` (private) or `kind` (crowd). */
  breakdown: Record<string, number>;
}

export function stats(): Record<ShardName, ShardStats> {
  const one = (name: ShardName, field: string): ShardStats => {
    const shard = getShard(name);
    let breakdown: Record<string, number> = {};
    try {
      breakdown = Object.fromEntries(shard.facet({ key: field, limit: 50, exact: true }).hits.map((h) => [String(h.value), h.count]));
    } catch (e) {
      void logEvent('shards', 'warn', `facet ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { points: shard.info().points_count, breakdown };
  };
  return { private: one('private', 'source'), crowd: one('crowd', 'kind') };
}

/** Apparent size only: Qdrant preallocates sparse files, so this overstates real disk use (see docs/edge-api.md). */
export function storageBytes(): Record<ShardName, number | null> {
  const size = (name: ShardName) => {
    try {
      return shardDir(name).size;
    } catch {
      return null;
    }
  };
  return { private: size('private'), crowd: size('crowd') };
}

/** Merge segments and build HNSW indexes once enough new points have accumulated. */
export async function optimizeIfNeeded(force = false) {
  for (const name of ['private', 'crowd'] as const) {
    const key = `new_points_${name}`;
    const pending = Number(await getSetting(key, '0'));
    if (!force && pending <= OPTIMIZE_AFTER_POINTS) continue;
    try {
      getShard(name).optimize();
      await setSetting(key, '0');
      await setSetting(`last_optimize_${name}`, String(Date.now()));
    } catch (e) {
      await logEvent('shards', 'error', `optimize ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

let backgroundHook: { remove(): void } | null = null;

/** Optimise on app background, never while the user is looking at the UI. */
export function registerBackgroundOptimize() {
  backgroundHook ??= AppState.addEventListener('change', (state) => {
    if (state === 'background') void optimizeIfNeeded();
  });
}

export function closeAllShards() {
  for (const shard of open.values()) {
    try {
      shard.close();
    } catch {
      // already closed
    }
  }
  open.clear();
}

/** Closes and deletes both shard folders. Used by "Delete everything". */
export function deleteAllShards() {
  closeAllShards();
  for (const name of ['private', 'crowd'] as const) {
    const dir = shardDir(name);
    if (dir.exists) dir.delete();
  }
}
