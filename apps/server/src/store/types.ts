import type { FactKind, FactStatus, SparseVec } from '@hive/shared';

/**
 * A published place fact. There is no separate "contribution" record any more: LastMeter publishes
 * immediately (see crowd.ts), and `riders` tracks which devices have reported this exact value so a
 * device deletion can just pull itself out of that list. `deleted` points are kept as tombstones so
 * phones can remove them.
 */
export interface KnowledgePayload {
  kind: FactKind;
  /** 'zone:<id>' */
  group: string;
  /** `<place_id>:<slot>` */
  key: string;
  value: string;
  text: string;
  version: number;
  /** riders.length, kept alongside `riders` for cheap reads. */
  confirmations: number;
  deleted: boolean;
  lat?: number;
  lon?: number;
  successes: number;
  failures: number;
  confidence: number;
  status: FactStatus;
  superseded_by?: number;
  last_success_at?: number;
  observed_at: number;
  riders: string[];
}

export interface KnowledgeRecord {
  id: number;
  payload: KnowledgePayload;
  vector: number[];
}

/**
 * Vector storage. Two implementations: Qdrant (real) and in-memory brute force (tests, Docker-free demos).
 * Knowledge points still carry a dense vector (kept for parity with the phone's crowd shard / potential
 * future search), but the server itself no longer runs vector search over its own knowledge — there is
 * no more multi-device voting/clustering to do it for.
 */
export interface Store {
  init(): Promise<void>;

  upsertKnowledge(id: number, vector: number[], sparse: SparseVec, payload: KnowledgePayload): Promise<void>;
  getKnowledge(id: number): Promise<KnowledgeRecord | null>;
  /** Ordered by version ascending. Vectors included. */
  scrollKnowledge(opts: { group?: string; sinceVersion?: number; limit: number; includeDeleted?: boolean }): Promise<KnowledgeRecord[]>;

  counts(): Promise<{ knowledge: number; tombstones: number }>;
  /** Wipes everything (demo reset). */
  clear(): Promise<void>;
}
