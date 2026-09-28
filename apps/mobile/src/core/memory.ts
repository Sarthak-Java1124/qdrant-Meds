import type { Source } from '@hive/shared';

import { getDb, getSetting, parseMeta, type ItemRow } from './db';
import { hybridSearch } from './search';
import type { PrivatePayload } from './shards';

export interface SourceCount {
  source: Source;
  total: number;
  embedded: number;
}

export async function itemCounts(): Promise<SourceCount[]> {
  const db = await getDb();
  return db.getAllAsync<SourceCount>('SELECT source, COUNT(*) AS total, SUM(embedded) AS embedded FROM items GROUP BY source ORDER BY total DESC');
}

export async function listItems(source: Source | null, limit = 50, offset = 0): Promise<ItemRow[]> {
  const db = await getDb();
  return source
    ? db.getAllAsync<ItemRow>('SELECT * FROM items WHERE source = ? ORDER BY ts DESC LIMIT ? OFFSET ?', [source, limit, offset])
    : db.getAllAsync<ItemRow>('SELECT * FROM items ORDER BY ts DESC LIMIT ? OFFSET ?', [limit, offset]);
}

export interface ItemDetail {
  item: ItemRow;
  meta: Record<string, unknown>;
}

export async function getItemDetail(id: number): Promise<ItemDetail | null> {
  const db = await getDb();
  const item = await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
  return item ? { item, meta: parseMeta(item.meta) } : null;
}

export interface MemoryHit {
  item: ItemRow;
  score: number;
}

/** The Memory Inspector's search box: hybrid search over the private shard, optionally within one source. */
export async function searchMemory(text: string, source: Source | null, limit = 20): Promise<MemoryHit[]> {
  const filter = source ? { must: [{ key: 'source', match: { value: source } }] } : undefined;
  const hits = await hybridSearch<PrivatePayload>('private', text, filter, limit);
  const db = await getDb();
  const out: MemoryHit[] = [];
  for (const h of hits) {
    const item = await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE id = ?', [Number(h.id)]);
    if (item) out.push({ item, score: h.denseScore ?? 0 });
  }
  return out;
}

export async function lastOptimize(): Promise<{ private: number | null; crowd: number | null }> {
  const read = async (k: string) => {
    const v = await getSetting(k);
    return v ? Number(v) : null;
  };
  return { private: await read('last_optimize_private'), crowd: await read('last_optimize_crowd') };
}
