import type { PrivatePayload } from './shards';
import { getShard } from './shards';

/**
 * "Memory Map": auto-discovered topic clusters over the private shard, with no manual tagging. The one feature
 * in this app built on Qdrant Edge's `searchMatrix` — a native, on-device pairwise-nearest-neighbour sample
 * (real Qdrant's "search matrix" primitive, meant for exactly this: dedup and clustering analysis). Nothing
 * here embeds or sends anything; it's one native call plus a small union-find over its result.
 */
export interface ClusterMember {
  id: number;
  text: string;
  ts: number;
  source: string;
}

export interface MemoryCluster {
  /** The longest member's text, as a cheap stand-in for "most informative" — not a true medoid. */
  label: string;
  size: number;
  members: ClusterMember[];
}

/** Private-shard ids are always numeric (see `upsertPrivate`); Edge returns every id as a string regardless. */
const toNum = (id: string): number | null => (/^\d+$/.test(id) ? Number(id) : null);

const MIN_SIM = 0.55; // private memory is deliberately diverse, so a looser bar than crowd clustering (0.82+) finds real themes
const MIN_CLUSTER_SIZE = 3;

/** Union-find over the sampled ids, joined whenever `searchMatrix` reports a neighbour at or above `MIN_SIM`. */
function groupBySimilarity(sampleIds: string[], nearests: { id: string; score: number }[][]): string[][] {
  const parent = new Map(sampleIds.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  sampleIds.forEach((id, i) => {
    for (const n of nearests[i] ?? []) if (n.id !== id && n.score >= MIN_SIM && parent.has(n.id)) union(id, n.id);
  });
  const groups = new Map<string, string[]>();
  for (const id of sampleIds) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()];
}

/**
 * Samples up to `sample` private-memory points, finds each one's `neighborsPerSample` nearest neighbours
 * within that sample, and groups them into clusters. Returns the largest clusters first, capped at 8.
 */
export function memoryClusters(sample = 150, neighborsPerSample = 5): MemoryCluster[] {
  const shard = getShard('private');
  if (shard.info().points_count < MIN_CLUSTER_SIZE) return [];

  const result = shard.searchMatrix({ sample, limit: neighborsPerSample, using: 'd' });
  const nearests = result.nearests.map((row) => row.map((p) => ({ id: p.id, score: p.score })));
  const idGroups = groupBySimilarity(result.sample_ids, nearests).filter((g) => g.length >= MIN_CLUSTER_SIZE);
  if (!idGroups.length) return [];

  const allIds = idGroups.flat();
  const points = shard.retrieve(allIds, { withPayload: true });
  const byId = new Map(points.map((p) => [p.id, p.payload as Partial<PrivatePayload> | undefined]));

  const clusters: MemoryCluster[] = [];
  for (const ids of idGroups) {
    const members: ClusterMember[] = [];
    for (const id of ids) {
      const numId = toNum(id);
      const payload = byId.get(id);
      if (numId !== null && payload?.text) members.push({ id: numId, text: payload.text, ts: payload.ts ?? 0, source: payload.source ?? '' });
    }
    if (members.length < MIN_CLUSTER_SIZE) continue;
    members.sort((a, b) => b.ts - a.ts);
    const label = [...members].sort((a, b) => b.text.length - a.text.length)[0]?.text ?? '';
    clusters.push({ label, size: members.length, members });
  }
  return clusters.sort((a, b) => b.size - a.size).slice(0, 8);
}
