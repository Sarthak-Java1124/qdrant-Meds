import { SwitchRow } from './kit';

/**
 * The one "share this generally" pattern, reused everywhere something can leave the phone as a scrubbed,
 * crowd-confirmed fact (a question in Topics, a tip in Topics). One visual pattern and one copy voice,
 * instead of a differently-worded switch bespoke to each screen.
 */
export function ShareToggle({ subject, value, onValueChange }: { subject: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <SwitchRow
      label={`Share as a ${subject} others can see`}
      hint="Names, dates and personal context are removed first, and it only goes out once enough other phones agree."
      value={value}
      onValueChange={onValueChange}
    />
  );
}
