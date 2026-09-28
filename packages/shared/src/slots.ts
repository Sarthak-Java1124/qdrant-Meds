import type { Slot } from './types';

/**
 * Example phrases per slot, used to warm an embedding-based classifier
 * (see apps/mobile/src/lastmeter/slotClassifier.ts, ported from the old
 * exemplar-embedding intent router in src/ask/intents.ts).
 */
export const SLOT_EXEMPLARS: Record<Slot, string[]> = {
  entrance: ['entrance is at the back', 'use the side entrance', 'main door is around the corner'],
  gate_code: ['gate code is 4417', 'code changed to 8823', 'keypad pin 1234'],
  access: ['guard will not open after 10pm', 'need to call before entering', 'visitor entry register'],
  handover: ['hand to the guard', 'leave at reception', 'customer comes down'],
  lift: ['lift B is broken', 'use service lift', 'lift not working'],
  parking: ['park near the temple', 'no bike parking inside', 'park at gate 2'],
  hazard: ['dog in the compound', 'wet floor near stairs', 'dark lane at night'],
  timing: ['shop closed after 9', 'office closes at 6', 'society gate closes at 11'],
  other: ['note about this place'],
};

export const extractValue = (slot: Slot, text: string): string => {
  const t = text.toLowerCase();
  if (slot === 'gate_code') return t.match(/\b\d{3,6}\b/)?.[0] ?? '';
  if (slot === 'lift') {
    return (t.match(/lift\s*([a-z0-9])/)?.[1] ?? '') + (/(broken|not working|down)/.test(t) ? ':down' : ':ok');
  }
  if (slot === 'entrance') return t.match(/\b(rear|back|side|front|main|gate\s*\d)\b/)?.[0] ?? t.slice(0, 40);
  if (slot === 'handover') return t.match(/\b(guard|reception|security|customer|lobby)\b/)?.[0] ?? t.slice(0, 40);
  return t.slice(0, 60);
};

const SLOT_LINE: Record<Slot, (value: string) => string> = {
  entrance: (v) => `Entrance: ${v}`,
  gate_code: (v) => `Gate code ${v}`,
  access: (v) => `Access: ${v}`,
  handover: (v) => `Hand to ${v}`,
  lift: (v) => {
    const [id, state] = v.split(':');
    return `Lift ${id?.toUpperCase() || ''} ${state === 'down' ? 'not working' : 'working'}`.trim();
  },
  parking: (v) => `Parking: ${v}`,
  hazard: (v) => `Hazard: ${v}`,
  timing: (v) => `Timing: ${v}`,
  other: (v) => v,
};

/** Human-readable brief line shown to the next rider, e.g. "Gate code 8823". */
export function toBriefLine(slot: Slot, value: string): string {
  return SLOT_LINE[slot](value);
}
