import { getSetting, setSetting } from './db';

export const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const zoneGroup = (zone: string) => `zone:${slug(zone)}`;

const ZONE_KEY = 'rider_zone';

export async function getZone(): Promise<string | null> {
  return (await getSetting(ZONE_KEY)) || null;
}

/** Onboarding / Settings: changing this changes which zone pack the phone downloads. */
export async function setZone(zone: string) {
  await setSetting(ZONE_KEY, zone);
}

/** Every knowledge group this phone should pull: just the rider's current zone. */
export async function subscribedGroups(): Promise<string[]> {
  const zone = await getZone();
  return zone ? [zoneGroup(zone)] : [];
}
