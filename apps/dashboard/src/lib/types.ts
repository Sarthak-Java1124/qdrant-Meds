export type FactKind = 'place_fact';

export type Slot = 'entrance' | 'gate_code' | 'access' | 'handover' | 'lift' | 'parking' | 'hazard' | 'timing' | 'other';

export type FactStatus = 'verified' | 'unverified' | 'superseded';

export interface ServerEvent {
  id: number;
  ts: number;
  type: string;
  data: Record<string, unknown>;
}

export interface Stats {
  devices: number;
  activeDevices5m: number;
  contributionsToday: number;
  contributionsTotal: number;
  knowledge: Record<FactKind, number>;
  tombstones: number;
  version: number;
  last24h: Record<string, number>;
  config: { dailyCap: number; minAgeMin: number };
}

export interface Overview {
  stopsToday: number;
  firstAttemptPct: number;
  avgDoorSeconds: number;
}

/** One row per place for the map: enough to color the marker without fetching the full timeline. */
export interface PlaceMemoryRow {
  placeId: string;
  lat: number;
  lon: number;
  /** verified > unverified > superseded, best fact at this place wins. */
  bestStatus: FactStatus;
  factCount: number;
  slots: Slot[];
}

export interface PlaceFactRow {
  id: number | string;
  slot: Slot;
  value: string;
  text: string;
  status: FactStatus;
  confidence: number;
  successes: number;
  failures: number;
  supersededBy?: number | string;
  version: number;
  observedAt: number;
  lastSuccessAt?: number;
}

export interface PlaceMemoryDetail {
  placeId: string;
  lat: number;
  lon: number;
  /** Every fact ever recorded here, including superseded ones, oldest first, for the timeline. */
  facts: PlaceFactRow[];
}

export interface ConflictRow {
  placeId: string;
  slot: Slot;
  fromValue: string;
  toValue: string;
  resolvedAt: number;
  /** How many delivery outcomes it took to settle this conflict. */
  settledByOutcomes: number;
}

export interface OpenConflictValue {
  value: string;
  confidence: number;
  successes: number;
  failures: number;
}

export interface OpenConflict {
  placeId: string;
  slot: Slot;
  values: OpenConflictValue[];
}

export interface Conflicts {
  resolved: ConflictRow[];
  open: OpenConflict[];
}

export interface DeviceRow {
  /** First 8 characters of the random device id. */
  id: string;
  created_at: number;
  last_seen: number;
  /** Opt-in counts only (items per source, pending, blocked). Never content. */
  stats: { items?: Record<string, number>; pending?: number; blocked?: number } | null;
  stats_at: number | null;
}

export interface Safety {
  rejected24h: Record<string, number>;
}
