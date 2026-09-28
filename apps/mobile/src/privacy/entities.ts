import { piiStripPatterns, scanPii, type PiiType } from '@hive/shared';

import { getContactNames, nameTokens } from '@/core/names';

export type EntityType = PiiType | 'name';

export interface EntityHit {
  type: EntityType;
  match: string;
}

/** Every non-name detector as a global regex, for removal (shared with the server's PII scan). */
export const stripPatterns = piiStripPatterns;

export interface ScanOptions {
  /** A known gate_code value is allowed to be a bare 3-6 digit number. */
  allowNumeric?: boolean;
}

/**
 * Looks for anything that identifies a person or their money: amounts, phone numbers, VPAs, emails,
 * account numbers, capitalized name-shaped runs (the shared detectors), plus names from the phone's
 * own contacts (phone-only, since only the phone knows them).
 */
export async function scanEntities(text: string, { allowNumeric = false }: ScanOptions = {}): Promise<EntityHit | null> {
  const pii = scanPii(text, { allowNumeric });
  if (pii) return pii;

  const contacts = await getContactNames();
  for (const token of nameTokens(text)) {
    if (contacts.has(token)) return { type: 'name', match: token };
  }
  return null;
}
