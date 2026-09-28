import { EMBED_DIM, type SparseVec } from '@hive/shared';
import { QdrantClient } from '@qdrant/js-client-rest';

import type { KnowledgePayload, KnowledgeRecord, Store } from './types';

const KNOWLEDGE = 'knowledge';

type Cond = Record<string, unknown>;
type Filter = { must?: Cond[]; must_not?: Cond[] };

const match = (key: string, value: string | boolean | number): Cond => ({ key, match: { value } });

/** Named-vector responses look like `{ d: [...] }`. */
function dense(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  const named = (v as Record<string, unknown> | null | undefined)?.d;
  return Array.isArray(named) ? (named as number[]) : [];
}

const toId = (id: string | number) => Number(id);

function toPayload(raw: KnowledgePayload & { location?: { lon: number; lat: number } }): Record<string, unknown> {
  const { lat, lon, ...rest } = raw;
  return { ...rest, ...(lat !== undefined && lon !== undefined ? { location: { lon, lat } } : {}) };
}

function fromPayload(raw: Record<string, unknown>): KnowledgePayload {
  const location = raw.location as { lon: number; lat: number } | undefined;
  const { location: _loc, ...rest } = raw;
  return { ...(rest as unknown as KnowledgePayload), ...(location ? { lat: location.lat, lon: location.lon } : {}) };
}

/** The real store: one Qdrant collection, `knowledge` (published place facts). */
export class QdrantStore implements Store {
  private client: QdrantClient;

  constructor(url: string) {
    this.client = new QdrantClient({ url });
  }

  async init() {
    if (!(await this.client.collectionExists(KNOWLEDGE)).exists) {
      await this.client.createCollection(KNOWLEDGE, {
        vectors: { d: { size: EMBED_DIM, distance: 'Cosine' } },
        sparse_vectors: { s: { modifier: 'idf' } },
      });
      const indexes: [string, 'keyword' | 'integer' | 'bool' | 'geo'][] = [
        ['group', 'keyword'],
        ['version', 'integer'],
        ['deleted', 'bool'],
        ['location', 'geo'],
      ];
      for (const [field_name, field_schema] of indexes) {
        await this.client.createPayloadIndex(KNOWLEDGE, { field_name, field_schema, wait: true });
      }
    }
  }

  async upsertKnowledge(id: number, vector: number[], sparse: SparseVec, payload: KnowledgePayload) {
    await this.client.upsert(KNOWLEDGE, {
      wait: true,
      points: [{ id, vector: { d: vector, s: { indices: sparse.indices, values: sparse.values } }, payload: toPayload(payload) }],
    });
  }

  async getKnowledge(id: number): Promise<KnowledgeRecord | null> {
    const [p] = await this.client.retrieve(KNOWLEDGE, { ids: [id], with_payload: true, with_vector: ['d'] });
    return p ? { id: toId(p.id), vector: dense(p.vector), payload: fromPayload(p.payload as Record<string, unknown>) } : null;
  }

  async scrollKnowledge(opts: { group?: string; sinceVersion?: number; limit: number; includeDeleted?: boolean }): Promise<KnowledgeRecord[]> {
    const must: Cond[] = [{ key: 'version', range: { gt: opts.sinceVersion ?? 0 } }];
    if (opts.group) must.push(match('group', opts.group));
    const filter: Filter = { must, ...(opts.includeDeleted === false ? { must_not: [match('deleted', true)] } : {}) };
    // ordering by an indexed integer field is what makes the delta feed cheap: version > since, ascending
    const page = await this.client.scroll(KNOWLEDGE, {
      filter,
      limit: opts.limit,
      with_payload: true,
      with_vector: ['d'],
      order_by: { key: 'version', direction: 'asc' },
    });
    return page.points.map((p) => ({ id: toId(p.id), vector: dense(p.vector), payload: fromPayload(p.payload as Record<string, unknown>) }));
  }

  async counts() {
    const count = async (filter?: Filter) => (await this.client.count(KNOWLEDGE, { exact: true, filter })).count;
    return { knowledge: await count({ must_not: [match('deleted', true)] }), tombstones: await count({ must: [match('deleted', true)] }) };
  }

  async clear() {
    if ((await this.client.collectionExists(KNOWLEDGE)).exists) await this.client.deleteCollection(KNOWLEDGE);
    await this.init();
  }
}
