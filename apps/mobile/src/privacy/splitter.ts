import { extractValue, placeKey, toBriefLine, type SharedFact } from '@hive/shared';

import { getDb, logEvent, parseMeta } from '@/core/db';
import { zoneGroup, getZone } from '@/core/groups';
import { classifySlot } from '@/lastmeter/slotClassifier';

import { submitFact, type SubmitResult } from './submit';

/**
 * The Splitter turns a private item into a general fact. LastMeter has exactly one path in: a rider note
 * captured after a delivery attempt, tagged with the stop/place it belongs to.
 */

const skipped = (why: string): null => {
  void logEvent('splitter', 'info', `skipped: ${why}`);
  return null;
};

/** A captured rider note becomes a place fact: classify its slot, extract a value, template a brief line. */
export async function splitRiderNote(itemId: number): Promise<SubmitResult | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ text: string; meta: string | null }>('SELECT text, meta FROM items WHERE id = ?', [itemId]);
  if (!row) return skipped('item not found');

  const meta = parseMeta(row.meta) as { stop_id?: string; place_id?: string; lat?: number; lon?: number };
  if (!meta.place_id) return skipped('note has no place_id');

  const { slot } = await classifySlot(row.text);
  const value = extractValue(slot, row.text);
  if (!value) return skipped(`no ${slot} value extracted`);

  const zone = await getZone();
  if (!zone) return skipped('no zone set');

  const fact: SharedFact = {
    kind: 'place_fact',
    group: zoneGroup(zone),
    key: placeKey(meta.place_id, slot),
    value,
    text: toBriefLine(slot, value),
    ...(meta.lat !== undefined && meta.lon !== undefined ? { lat: meta.lat, lon: meta.lon } : {}),
  };
  return submitFact(fact, { slot });
}
