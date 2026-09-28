import { getDb, type StopRow } from '@/core/db';
import { setZone } from '@/core/groups';

interface DemoRoute {
  zone: string;
  stops: { id: string; place_id: string; label: string; lat: number; lon: number; seq: number }[];
}

/** Seeds (or re-seeds) today's stops from the bundled demo route and sets the rider's zone to match. */
export async function loadDemoRoute(): Promise<DemoRoute> {
  const route = require('../../assets/demo/route.json') as DemoRoute;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM stops');
    await db.runAsync('DELETE FROM briefs');
    for (const s of route.stops) {
      await db.runAsync(
        'INSERT INTO stops (id, place_id, label, lat, lon, seq, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [s.id, s.place_id, s.label, s.lat, s.lon, s.seq, 'pending'],
      );
    }
  });
  await setZone(route.zone);
  return route;
}

export async function listStops(): Promise<StopRow[]> {
  const db = await getDb();
  return db.getAllAsync<StopRow>('SELECT * FROM stops ORDER BY seq');
}

export async function markArrived(stopId: string) {
  const db = await getDb();
  await db.runAsync("UPDATE stops SET status = 'arrived', arrived_at = ? WHERE id = ?", [Date.now(), stopId]);
}

export async function markDone(stopId: string, result: 'delivered' | 'failed') {
  const db = await getDb();
  await db.runAsync("UPDATE stops SET status = 'done', done_at = ?, result = ? WHERE id = ?", [Date.now(), result, stopId]);
}

export interface RouteStats {
  stopsToday: number;
  firstAttemptPct: number;
  avgDoorSeconds: number;
  factsLearned: number;
}

export async function routeStats(): Promise<RouteStats> {
  const db = await getDb();
  const done = await db.getAllAsync<{ result: string; arrived_at: number; done_at: number }>(
    "SELECT result, arrived_at, done_at FROM stops WHERE status = 'done'",
  );
  const stopsToday = done.length;
  const delivered = done.filter((d) => d.result === 'delivered');
  const firstAttemptPct = stopsToday ? Math.round((delivered.length / stopsToday) * 100) : 0;
  const avgDoorSeconds = stopsToday
    ? Math.round(done.reduce((s, d) => s + Math.max(0, (d.done_at - d.arrived_at) / 1000), 0) / stopsToday)
    : 0;
  const factsLearned = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE type = 'fact' AND status = 'sent'"))?.n ?? 0;
  return { stopsToday, firstAttemptPct, avgDoorSeconds, factsLearned };
}
