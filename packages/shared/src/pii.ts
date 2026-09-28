export type PiiType = 'email' | 'url' | 'vpa' | 'pnr' | 'account' | 'amount' | 'phone' | 'reference' | 'name';

export interface PiiHit {
  type: PiiType;
  match: string;
}

/**
 * Detectors for anything that identifies a person or their money. The phone runs these in its Leak Check
 * and the server runs the very same ones as defence in depth, so the two can never disagree.
 * Order matters: an email must be caught before the looser VPA pattern.
 *
 * LastMeter's rider notes may legitimately contain a short numeric gate code (3-6 digits) — callers
 * that already know a fact is a gate_code should skip these patterns for that value rather than trying
 * to special-case them here, since a bare 4-digit number is otherwise indistinguishable from part of
 * a longer PII string.
 */
export const PII_PATTERNS: readonly (readonly [PiiType, string, string])[] = [
  ['email', String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}`, ''],
  ['url', String.raw`\bhttps?:\/\/\S+|\bwww\.\S+`, 'i'],
  ['vpa', String.raw`\b[a-z0-9.\-_]{2,}@[a-z]{2,}\b`, 'i'],
  ['pnr', String.raw`\bPNR[:\s#-]*\d{6,10}\b`, 'i'],
  ['account', String.raw`\b(?:a\/c|acct|account)\b[\s.:]*(?:no\.?)?[\s.:]*[x*]*\d{3,}|\b[x*]{2,}\d{3,4}\b`, 'i'],
  ['amount', String.raw`(?:rs\.?|inr|₹)\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:rupees|rs)\b`, 'i'],
  ['phone', String.raw`(?:\+?91[\s-]?)?\b[6-9]\d{9}\b`, ''],
  ['reference', String.raw`\b\d{6,}\b`, ''],
  // A capitalized two-to-three word run ("Ramesh Kumar", "Ramesh Kumar Singh") is the cheapest signal
  // that a rider typed a customer's name into a note. Deliberately conservative (misses lowercase
  // names, over-fires on real place names) — this is a heuristic backstop, not identification.
  ['name', String.raw`\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,}){1,2}\b`, ''],
];

/**
 * The first PII found in the text, or null. Pass `allowNumeric: true` when the caller already knows
 * this text is a gate_code value, so a bare 3-6 digit code isn't flagged as a 'reference'/'account' hit.
 */
export function scanPii(text: string, opts: { allowNumeric?: boolean } = {}): PiiHit | null {
  if (opts.allowNumeric && /^\d{3,6}$/.test(text.trim())) return null;
  for (const [type, source, flags] of PII_PATTERNS) {
    const m = text.match(new RegExp(source, flags));
    if (m) return { type, match: m[0] };
  }
  return null;
}

/** Every detector as a global regex, for removing PII from text. */
export const piiStripPatterns = (): RegExp[] => PII_PATTERNS.map(([, source, flags]) => new RegExp(source, `${flags}g`));
