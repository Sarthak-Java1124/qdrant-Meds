export const SOURCES = ['rider_note', 'visit'] as const;
export type Source = (typeof SOURCES)[number];

export const FACT_KINDS = ['place_fact'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const SLOTS = [
  'entrance',
  'gate_code',
  'access',
  'handover',
  'lift',
  'parking',
  'hazard',
  'timing',
  'other',
] as const;
export type Slot = (typeof SLOTS)[number];

/** MiniLM-L6-v2 output size. Device and server must agree on this. */
export const EMBED_DIM = 384;

/**
 * A general (non-private) fact that may leave the phone after the Leak Check.
 * For LastMeter the only kind is 'place_fact': `key` encodes `<place_id>:<slot>`
 * (see placeKey/parsePlaceKey below) so the wire shape stays the generic
 * {kind,group,key,value,text} fact Hive's crowd/publish pipeline already speaks.
 */
export interface SharedFact {
  kind: FactKind;
  /** 'zone:<id>' */
  group: string;
  /** `${place_id}:${slot}` */
  key: string;
  value: string;
  text: string;
  /** Present when kind === 'place_fact'; used for the geo payload index. */
  lat?: number;
  lon?: number;
}

export function placeKey(placeId: string, slot: Slot): string {
  return `${placeId}:${slot}`;
}

export function parsePlaceKey(key: string): { placeId: string; slot: Slot } {
  const i = key.lastIndexOf(':');
  return { placeId: key.slice(0, i), slot: key.slice(i + 1) as Slot };
}

export type FactStatus = 'verified' | 'unverified' | 'superseded';

/** A published crowd fact as served by GET /v1/knowledge. */
export interface KnowledgePoint {
  id: string | number;
  version: number;
  kind: FactKind;
  group: string;
  key: string;
  value: string;
  text: string;
  confirmations: number;
  /** Dense 384-d vector computed by the server, so phones never re-embed. */
  vector: number[];
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

export interface SparseVec {
  indices: number[];
  values: number[];
}

/**
 * A single delivery result for a stop, reported by a rider's phone. Not a voted-on fact —
 * it directly adjusts the confidence/status of the knowledge points it names in `facts_shown`.
 */
export interface Outcome {
  stop_id: string;
  place_id: string;
  result: 'delivered' | 'failed';
  door_seconds: number;
  /** Knowledge point ids shown in the brief for this stop. */
  facts_shown: (string | number)[];
  at: number;
}
