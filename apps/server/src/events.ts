import type { EventRow, Meta } from './meta/types';

export type EventType =
  | 'device_registered'
  | 'device_synced'
  | 'device_deleted'
  | 'contribution'
  | 'rejected'
  | 'published'
  | 'unpublished'
  | 'outcome'
  | 'conflict_resolved'
  | 'reset';

/** Activity feed. Every event is stored (for the Safety page counts) and pushed live to the dashboard over SSE. */
export class EventBus {
  private listeners = new Set<(e: EventRow) => void>();

  constructor(
    private meta: Meta,
    private now: () => number = Date.now,
  ) {}

  emit(type: EventType, data: Record<string, unknown> = {}) {
    const ts = this.now();
    const id = this.meta.addEvent(ts, type, data);
    const event: EventRow = { id, ts, type, data };
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // a dead SSE connection must never break the request that caused the event
      }
    }
  }

  subscribe(fn: (e: EventRow) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
