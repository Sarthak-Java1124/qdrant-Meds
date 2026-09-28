export interface DeviceRow {
  id: string;
  created_at: number;
  last_seen: number;
}

export interface EventRow {
  id: number;
  ts: number;
  type: string;
  data: unknown;
}

export interface OutcomeRow {
  stop_id: string;
  place_id: string;
  device_id: string;
  result: 'delivered' | 'failed';
  door_seconds: number;
  at: number;
}

export interface OverviewStats {
  stopsToday: number;
  firstAttemptSuccessPct: number;
  avgDoorSeconds: number;
}

/**
 * Small relational state: devices, counters, daily caps, activity log, opt-in heartbeats.
 * better-sqlite3 is synchronous, so this interface is too.
 */
export interface Meta {
  createDevice(id: string, tokenHash: string, now: number): void;
  deviceByTokenHash(tokenHash: string): DeviceRow | null;
  touchDevice(id: string, now: number): void;
  /** Removes the device, its daily counters and its heartbeat. */
  deleteDevice(id: string): void;
  deviceCreatedAt(id: string): number | null;
  listDevices(): (DeviceRow & { heartbeat: unknown | null; heartbeat_ts: number | null })[];
  countDevices(): number;
  activeDevices(sinceTs: number): number;

  /** Global, strictly increasing knowledge version: the phones' sync cursor. */
  nextVersion(): number;
  currentVersion(): number;
  nextContributionId(): number;

  dailyCount(deviceId: string, date: string): number;
  incrDaily(deviceId: string, date: string): number;

  addEvent(ts: number, type: string, data: unknown): number;
  recentEvents(limit: number): EventRow[];
  eventCounts(sinceTs: number): Record<string, number>;
  /** Sums a numeric field of one event type's data since a time (e.g. outvoted votes). */
  eventSum(type: string, field: string, sinceTs: number): number;

  putHeartbeat(deviceId: string, ts: number, stats: unknown): void;

  addOutcome(row: OutcomeRow): void;
  /** Overview tiles since `sinceTs` (usually today's midnight). See sqlite.ts for the exact definitions. */
  overviewStats(sinceTs: number): OverviewStats;

  /**
   * Demo reset: forgets devices, daily counters, heartbeats, outcomes and the activity log. The version and
   * contribution counters are kept, so a phone that synced before the reset never has a cursor ahead of the server.
   */
  reset(): void;
}
