import type { SparseVec } from './types';

const STOP = new Set([
  'the', 'a', 'an', 'is', 'to', 'of', 'and', 'in', 'on', 'for', 'your', 'you', 'has', 'been', 'at', 'rs', 'inr',
]);

/** 32-bit FNV-1a. Also used for stable ids (e.g. WhatsApp chunk ext_ids). */
export const fnv1a = (s: string) => {
  let h = 0x811c9dc5;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/**
 * Hashed term-frequency sparse vector. Qdrant's `idf` modifier supplies the IDF side,
 * so together it behaves like BM25. It's what finds exact tokens (PNRs, merchant codes)
 * that dense vectors miss. Device and server must use this exact function.
 */
export function sparseEncode(text: string): SparseVec {
  const tf = new Map<number, number>();
  for (const t of text.toLowerCase().split(/[^\p{L}\p{N}@*]+/u)) {
    if (t.length < 2 || STOP.has(t)) continue;
    const i = fnv1a(t);
    tf.set(i, (tf.get(i) ?? 0) + 1);
  }
  const indices = [...tf.keys()].sort((a, b) => a - b);
  return { indices, values: indices.map((i) => tf.get(i)!) };
}
