export type SyncStatus = 'offline' | 'idle' | 'pushing' | 'pulling' | 'error';

export interface SyncSnapshot {
  status: SyncStatus;
  lastSyncAt: number | null;
  pendingCount: number;
}

/** "Synced 2m ago" style age. */
export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Text for the header pill: Offline / Syncing / N pending / Synced 2m ago. */
export function statusLabel(s: SyncSnapshot, now = Date.now()) {
  if (s.status === 'offline') return s.pendingCount ? `Offline · ${s.pendingCount} pending` : 'Offline';
  if (s.status === 'pushing' || s.status === 'pulling') return 'Syncing…';
  if (s.status === 'error') return s.pendingCount ? `${s.pendingCount} pending` : 'Sync failed';
  if (s.pendingCount > 0) return `${s.pendingCount} pending`;
  return s.lastSyncAt ? `Synced ${ago(s.lastSyncAt, now)}` : 'Not synced yet';
}
