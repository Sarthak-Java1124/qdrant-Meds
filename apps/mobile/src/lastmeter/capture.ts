import type { Outcome } from '@hive/shared';

import { ingest } from '@/core/ingest';
import { enqueueOutcome } from '@/privacy';

import type { BriefLine } from './brief';
import { markDone } from './route';

export interface CaptureInput {
  stopId: string;
  placeId: string;
  lat: number;
  lon: number;
  arrivedAt: number;
  result: 'delivered' | 'failed';
  note: string;
  photoUri: string | null;
  factsShown: BriefLine[];
}

/**
 * On Delivered/Failed: record the stop's outcome (queued straight to the outbox — no PII, skips Leak Check),
 * and if the rider left a note, run it through the normal ingest → Splitter → Leak Check pipeline so it can
 * become tomorrow's brief line. The photo, if any, stays local (its path only ever reaches the private shard).
 */
export async function submitCapture(input: CaptureInput) {
  await markDone(input.stopId, input.result);

  const outcome: Outcome = {
    stop_id: input.stopId,
    place_id: input.placeId,
    result: input.result,
    door_seconds: Math.max(0, Math.round((Date.now() - input.arrivedAt) / 1000)),
    facts_shown: input.factsShown.map((f) => f.id),
    at: Date.now(),
  };
  await enqueueOutcome(outcome);

  const text = input.note.trim();
  if (text) {
    await ingest({
      source: 'rider_note',
      extId: `rider_note:${input.stopId}:${Date.now()}`,
      text,
      ts: Date.now(),
      meta: { stop_id: input.stopId, place_id: input.placeId, lat: input.lat, lon: input.lon, photo: input.photoUri },
    });
  }
}
