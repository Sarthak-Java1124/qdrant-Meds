import { initCore } from '@/core';
import { memoryClusters } from '@/core/clusters';
import { drainEmbedQueue } from '@/core/embedQueue';
import { getDb } from '@/core/db';
import { ingest } from '@/core/ingest';
import { deletePrivate } from '@/core/shards';

import type { Log } from './edgeSpike';

const TRAVEL = [
  'Booked a train to Jaipur for the long weekend, window seat',
  'Found a cheap hostel near Amber Fort for the Jaipur trip',
  'Need to carry a power bank for the overnight train to Jaipur',
];
const FOOD = [
  'Tried a new biryani place near the office today, excellent',
  'Ordered biryani again for dinner, this place is consistently good',
  'Looking for a good biryani spot open late on weekdays',
];
const UNRELATED = ['Fixed the leaking kitchen tap this morning', 'Renewed the car insurance policy online'];

/** Spike for `searchMatrix` (core/clusters.ts) — never exercised anywhere else in this codebase before. */
export async function clusterSpike(log: Log) {
  const check = (name: string, ok: boolean, detail = '') => log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const db = await initCore().then(getDb);
  const createdItems: number[] = [];

  try {
    let i = 0;
    for (const text of [...TRAVEL, ...FOOD, ...UNRELATED]) {
      const item = await ingest({ source: 'rider_note', extId: `clusterspike:${i++}`, text, ts: Date.now() });
      if (item) createdItems.push(item.id);
    }
    await drainEmbedQueue();
    log(`ingested ${createdItems.length} synthetic notes`);

    const clusters = memoryClusters(50, 5);
    log(`searchMatrix returned ${clusters.length} cluster(s): ${clusters.map((c) => c.size).join(', ')}`);
    check('at least one cluster of 3+ found', clusters.some((c) => c.size >= 3));
    check('every cluster member carries text, a numeric id and a timestamp', clusters.every((c) => c.members.every((m) => m.text.length > 0 && Number.isFinite(m.id) && m.ts > 0)));
    const travelOrFoodTogether = clusters.some((c) => {
      const texts = c.members.map((m) => m.text);
      return TRAVEL.every((t) => texts.includes(t)) || FOOD.every((t) => texts.includes(t));
    });
    check('a genuinely related group (all 3 travel or all 3 food notes) clustered together', travelOrFoodTogether);
  } finally {
    for (const id of createdItems) {
      await db.runAsync('DELETE FROM items WHERE id = ?', [id]);
    }
    deletePrivate(createdItems);
    log(`cleaned up: ${createdItems.length} synthetic notes removed`);
  }
}
