import { sparseEncode } from '@hive/shared';
import type { Filter } from 'react-native-qdrant-edge';

import { embed } from './embedder';
import { denseSearch, sparseSearch, type Hit, type ShardName } from './shards';

export interface FusedHit<P> extends Hit<P> {
  /** Raw cosine similarity from the dense search, when the point appeared in it. Used by the Leak Check. */
  denseScore?: number;
  /** The point also matched on exact tokens (a PNR, a merchant code), so it is relevant even with a low denseScore. */
  inSparse?: boolean;
}

/** Reciprocal Rank Fusion. Owning it here keeps ranking predictable whatever the binding's `query` does. */
export function rrf(lists: { id: number | string }[][], k = 60) {
  const s = new Map<number | string, number>();
  lists.forEach((l) => l.forEach((r, i) => s.set(r.id, (s.get(r.id) ?? 0) + 1 / (k + i + 1))));
  return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([id, score]) => ({ id, score }));
}

/**
 * Dense (meaning) + sparse (exact tokens like PNRs and merchant codes) search on one shard,
 * fused with RRF. Each leg fetches 20 candidates under the same filter.
 */
export async function hybridSearch<P>(
  shard: ShardName,
  text: string,
  filter?: Filter,
  limit = 10,
): Promise<FusedHit<P>[]> {
  const dense = denseSearch<P>(shard, await embed(text), filter, 20);
  const sparse = sparseSearch<P>(shard, sparseEncode(text), filter, 20);

  const byId = new Map<number | string, FusedHit<P>>();
  for (const h of sparse) byId.set(h.id, { ...h, inSparse: true });
  for (const h of dense) byId.set(h.id, { ...h, denseScore: h.score, inSparse: byId.get(h.id)?.inSparse });

  return rrf([dense, sparse])
    .slice(0, limit)
    .map(({ id, score }) => ({ ...byId.get(id)!, score }));
}
