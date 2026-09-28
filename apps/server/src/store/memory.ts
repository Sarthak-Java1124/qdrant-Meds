import type { SparseVec } from '@hive/shared';

import type { KnowledgePayload, KnowledgeRecord, Store } from './types';

/** Brute-force in-process store. Fine for tests and demos; the Qdrant store is the real one. */
export class MemoryStore implements Store {
  private knowledge = new Map<number, { vector: number[]; sparse: SparseVec; payload: KnowledgePayload }>();

  async init() {}

  async upsertKnowledge(id: number, vector: number[], sparse: SparseVec, payload: KnowledgePayload) {
    this.knowledge.set(id, { vector, sparse, payload });
  }

  async getKnowledge(id: number): Promise<KnowledgeRecord | null> {
    const k = this.knowledge.get(id);
    return k ? { id, vector: k.vector, payload: k.payload } : null;
  }

  async scrollKnowledge(opts: { group?: string; sinceVersion?: number; limit: number; includeDeleted?: boolean }): Promise<KnowledgeRecord[]> {
    const since = opts.sinceVersion ?? 0;
    return [...this.knowledge.entries()]
      .filter(([, k]) => (!opts.group || k.payload.group === opts.group) && k.payload.version > since && (opts.includeDeleted !== false || !k.payload.deleted))
      .sort((a, b) => a[1].payload.version - b[1].payload.version)
      .slice(0, opts.limit)
      .map(([id, k]) => ({ id, vector: k.vector, payload: k.payload }));
  }

  async counts() {
    let knowledge = 0;
    let tombstones = 0;
    for (const k of this.knowledge.values()) {
      if (k.payload.deleted) tombstones++;
      else knowledge++;
    }
    return { knowledge, tombstones };
  }

  async clear() {
    this.knowledge.clear();
  }
}
