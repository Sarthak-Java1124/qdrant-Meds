import { EMBED_DIM, fnv1a } from '@hive/shared';

import type { Embed } from './types';

const STOP = new Set(['the', 'a', 'an', 'is', 'to', 'of', 'and', 'in', 'on', 'for', 'why', 'how', 'what', 'does', 'do', 'are', 'it', 'be']);

/**
 * Deterministic bag-of-words embedding for tests: texts that share words are close, unrelated texts are not.
 * NOT semantic (it has no idea "buy" ~ "purchase"); the real MiniLM embedder is used in production.
 */
export const stubEmbed: Embed = async (text) => {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const t of text.toLowerCase().split(/[^\p{L}\p{N}*]+/u)) {
    if (t.length < 2 || STOP.has(t)) continue;
    const h = fnv1a(t);
    v[h % EMBED_DIM] += (h >>> 16) & 1 ? 1 : -1;
    const h2 = fnv1a(`x${t}`);
    v[h2 % EMBED_DIM] += (h2 >>> 16) & 1 ? 0.5 : -0.5;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};
