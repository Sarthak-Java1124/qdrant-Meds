// SDK 57 moved the classic API behind /legacy; the new class-based Contact API is not needed here.
import * as Contacts from 'expo-contacts/legacy';

import { getSetting, setSetting } from './db';

const CONTACT_KEY = 'contact_names';

/** Lower-cased word tokens (3+ letters) from a full name. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 3);
}

let contactCache: Set<string> | null = null;

/**
 * Reads the phone book once and caches the name tokens on-device (settings). Contacts are used only
 * to catch a rider typing a customer's name into a note; they are never uploaded.
 */
export async function refreshContacts(): Promise<number> {
  const perm = await Contacts.requestPermissionsAsync();
  if (!perm.granted) return 0;
  const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Name] });
  const tokens = new Set<string>();
  for (const c of data) if (c.name) nameTokens(c.name).forEach((t) => tokens.add(t));
  contactCache = tokens;
  await setSetting(CONTACT_KEY, JSON.stringify([...tokens]));
  return tokens.size;
}

async function loadSet(key: string): Promise<Set<string>> {
  const raw = await getSetting(key, '[]');
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function getContactNames(): Promise<Set<string>> {
  contactCache ??= await loadSet(CONTACT_KEY);
  return contactCache;
}

export async function clearNameCaches() {
  contactCache = null;
}
