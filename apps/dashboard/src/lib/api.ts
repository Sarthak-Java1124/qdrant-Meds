import type { Conflicts, DeviceRow, Overview, PlaceMemoryDetail, PlaceMemoryRow, Safety, ServerEvent, Stats } from './types';

export interface Connection {
  base: string;
  key: string;
}

/** The admin key was rejected (HTTP 401). */
export class AuthError extends Error {
  constructor() {
    super('The server rejected the admin key.');
    this.name = 'AuthError';
  }
}

export const DEFAULT_BASE = process.env.NEXT_PUBLIC_API ?? 'http://localhost:8787';

/** "192.168.1.9:8787" -> "http://192.168.1.9:8787"; strips trailing slashes. */
export function normalizeBase(input: string): string {
  const s = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

export function makeApi(c: Connection) {
  const get = async <T>(path: string): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${c.base}${path}`, { headers: { 'x-admin-key': c.key }, cache: 'no-store' });
    } catch {
      throw new Error(`Cannot reach the server at ${c.base}. Is it running?`);
    }
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`Server error ${res.status} for ${path}`);
    return (await res.json()) as T;
  };

  return {
    stats: () => get<Stats>('/v1/admin/stats'),
    overview: () => get<Overview>('/v1/admin/overview'),
    placeMemory: () => get<{ places: PlaceMemoryRow[] }>('/v1/admin/place-memory'),
    placeMemoryDetail: (placeId: string) => get<PlaceMemoryDetail>(`/v1/admin/place-memory/${encodeURIComponent(placeId)}`),
    conflicts: () => get<Conflicts>('/v1/admin/conflicts'),
    devices: () => get<{ note: string; devices: DeviceRow[] }>('/v1/admin/devices'),
    activity: (limit = 200) => get<{ events: ServerEvent[] }>(`/v1/admin/activity?limit=${limit}`),
    safety: () => get<Safety>('/v1/admin/safety'),
  };
}

export type Api = ReturnType<typeof makeApi>;

/** EventSource cannot set headers, so the stream takes the key as a query parameter. */
export const eventsUrl = (c: Connection) => `${c.base}/v1/admin/events?key=${encodeURIComponent(c.key)}`;
