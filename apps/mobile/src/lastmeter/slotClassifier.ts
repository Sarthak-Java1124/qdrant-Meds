import { SLOTS, SLOT_EXEMPLARS, type Slot } from '@hive/shared';

import { cosine, embed } from '@/core/embedder';

/**
 * Ported from the old Ask engine's exemplar-embedding intent router (src/ask/intents.ts, now deleted):
 * same warm-on-startup caching and topTwoAverage scoring, just classifying a rider's note into a Slot
 * instead of a query into a chat Intent. No hint-boost layer this time — the slot exemplars are already
 * short and concrete enough that keyword hints aren't needed, and 'other' already serves as the fallback
 * bucket a low-confidence match would have gone to.
 */

export interface SlotRouting {
  slot: Slot;
  score: number;
}

let cache: Map<Slot, number[][]> | null = null;
let loading: Promise<Map<Slot, number[][]>> | null = null;

/** Embeds every exemplar once (~25 short sentences). Call at startup so the first note isn't slow. */
export function warmSlots() {
  loading ??= (async () => {
    const m = new Map<Slot, number[][]>();
    for (const slot of SLOTS) {
      const vs: number[][] = [];
      for (const s of SLOT_EXEMPLARS[slot]) {
        vs.push(await embed(s));
        await new Promise<void>((r) => setTimeout(r, 0)); // keep the UI responsive
      }
      m.set(slot, vs);
    }
    cache = m;
    return m;
  })();
  return loading;
}

/** Average of the two best exemplar similarities: robust to one odd exemplar, still rewards a close match. */
const topTwoAverage = (sims: number[]) => {
  const s = [...sims].sort((a, b) => b - a);
  return (s[0] + (s[1] ?? s[0])) / 2;
};

export async function classifySlot(text: string): Promise<SlotRouting> {
  const vectors = cache ?? (await warmSlots());
  const q = await embed(text);

  const scored = SLOTS.map((slot) => ({ slot, score: topTwoAverage(vectors.get(slot)!.map((v) => cosine(q, v))) })).sort(
    (a, b) => b.score - a.score,
  );
  return scored[0];
}
