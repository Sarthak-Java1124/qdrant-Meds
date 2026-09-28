// Simulates N riders talking to a REAL running server over HTTP (register a device, post place-fact
// contributions and delivery outcomes), so a "gate changed" rehearsal doesn't need N physical phones.
// Adapted from the old tools/fleet.ts (merchant/doubt K-vote demo) for LastMeter's immediate-publish,
// outcome-verified place facts. Keeps the same _cli.ts plumbing: register/contribute/delay/PRNG.
//
//   node tools/riders.ts --riders 8 --zone koramangala --scenario gate_change --hold
//     Seeds 12 places in the zone with 2-3 facts each (entrance/gate_code/handover/...). Riders "deliver"
//     against each fact, so it moves unverified -> verified. Partway through, Tower 4's gate code changes:
//     riders keep trying the old code and failing. One simulated rider posts the corrected code plus a
//     delivered outcome. --hold stops before Tower 4's next delivery, so a real phone/dashboard-watcher
//     does the decisive step on stage.
//
// Registration is rate-limited per IP (REGISTER_PER_HOUR, default 30/hour) and every simulated rider shares
// this machine's IP, so a run of --riders > that cap needs the server started with a higher limit, e.g.:
//   cd apps/server && REGISTER_PER_HOUR=200 STORE=memory pnpm start
import { fail, helpText, makeApi, mulberry32, num, parseFlags, sleep, str, type Api } from './_cli.ts';

const KNOWN = {
  server: 'server URL (default http://127.0.0.1:8787)',
  'admin-key': 'admin key, only used to print a before/after summary (default dev-admin-key, or $ADMIN_KEY)',
  riders: 'number of rider phones to simulate (default 8)',
  scenario: '"gate_change" (default, only scenario today)',
  zone: 'the zone every rider is subscribed to (default "koramangala")',
  hold: '(flag) stop before Tower 4\'s final delivery, so a live phone/dashboard-watcher does it',
  'delay-ms': 'max random delay between two riders\' actions, in ms (default 150)',
  seed: 'PRNG seed, so a rehearsal can be repeated exactly (default 42)',
  help: '(flag) show this help',
};

const flags = parseFlags(process.argv.slice(2), KNOWN);
if (flags.help) {
  console.log(helpText('Usage: node tools/riders.ts [--riders N] [--zone NAME] [--scenario gate_change] [--hold] [options]', KNOWN));
  process.exit(0);
}

const scenario = str(flags, 'scenario', 'gate_change');
if (scenario !== 'gate_change') fail(`--scenario must be "gate_change" (the only scenario so far), got "${scenario}".`);

const riderCount = num(flags, 'riders', 8, 1, 500);
const delayMs = num(flags, 'delay-ms', 150, 0, 60_000);
const seed = num(flags, 'seed', 42, 0, 2 ** 31 - 1);
const zone = str(flags, 'zone', 'koramangala');
const group = `zone:${zone}`;
const hold = !!flags.hold;

const api = makeApi(str(flags, 'server', 'http://127.0.0.1:8787'), str(flags, 'admin-key', process.env.ADMIN_KEY ?? 'dev-admin-key'));
const rnd = mulberry32(seed);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];

// ---------- the 12 seeded places ----------

type Slot = 'entrance' | 'gate_code' | 'access' | 'handover' | 'lift' | 'parking' | 'hazard' | 'timing' | 'other';
type PlaceFactSeed = { slot: Slot; value: string; text: string };

// Koramangala, Bengaluru-ish coordinates, spread over a small radius so the dashboard map has real geography.
const BASE_LAT = 12.9352;
const BASE_LON = 77.6146;

interface Place {
  id: string;
  label: string;
  lat: number;
  lon: number;
  facts: PlaceFactSeed[];
}

const PLACES: Place[] = [
  { id: 'tower-1', label: 'Tower 1, 5th Block', lat: BASE_LAT + 0.0021, lon: BASE_LON + 0.0014, facts: [{ slot: 'entrance', value: 'rear', text: 'Entrance: rear gate, not the main road side' }, { slot: 'handover', value: 'guard', text: 'Hand to the guard at the rear gate' }] },
  { id: 'tower-2', label: 'Tower 2, 5th Block', lat: BASE_LAT + 0.0033, lon: BASE_LON - 0.0009, facts: [{ slot: 'gate_code', value: '2210', text: 'Gate code 2210' }, { slot: 'parking', value: 'gate 2', text: 'Parking: park at gate 2' }] },
  { id: 'tower-3', label: 'Tower 3, 6th Block', lat: BASE_LAT - 0.0018, lon: BASE_LON + 0.0027, facts: [{ slot: 'lift', value: 'a:ok', text: 'Lift A working' }, { slot: 'hazard', value: 'dog in the compound', text: 'Hazard: dog in the compound' }] },
  { id: 'tower-4', label: 'Tower 4, 6th Block', lat: BASE_LAT - 0.0026, lon: BASE_LON - 0.0016, facts: [{ slot: 'gate_code', value: '4417', text: 'Gate code 4417' }, { slot: 'handover', value: 'reception', text: 'Leave at reception' }] },
  { id: 'tower-5', label: 'Tower 5, Raheja Arcade side', lat: BASE_LAT + 0.0041, lon: BASE_LON + 0.0032, facts: [{ slot: 'entrance', value: 'side', text: 'Entrance: use the side entrance' }] },
  { id: 'tower-6', label: 'Tower 6, near Sony World Signal', lat: BASE_LAT - 0.0037, lon: BASE_LON + 0.0011, facts: [{ slot: 'access', value: 'call before entering', text: 'Access: call before entering' }, { slot: 'timing', value: 'gate closes at 11', text: 'Timing: society gate closes at 11' }] },
  { id: 'tower-7', label: 'Tower 7, 7th Block', lat: BASE_LAT + 0.0009, lon: BASE_LON - 0.0031, facts: [{ slot: 'gate_code', value: '9081', text: 'Gate code 9081' }] },
  { id: 'tower-8', label: 'Tower 8, near Forum Mall', lat: BASE_LAT - 0.0012, lon: BASE_LON - 0.0038, facts: [{ slot: 'parking', value: 'no bike parking inside', text: 'Parking: no bike parking inside' }, { slot: 'entrance', value: 'main', text: 'Entrance: main door is fine' }] },
  { id: 'tower-9', label: 'Tower 9, 4th Block', lat: BASE_LAT + 0.0028, lon: BASE_LON + 0.0006, facts: [{ slot: 'lift', value: 'b:down', text: 'Lift B not working' }, { slot: 'handover', value: 'security', text: 'Hand to security' }] },
  { id: 'tower-10', label: 'Tower 10, 8th Block', lat: BASE_LAT - 0.0044, lon: BASE_LON + 0.0022, facts: [{ slot: 'gate_code', value: '1234', text: 'Gate code 1234' }] },
  { id: 'tower-11', label: 'Tower 11, near Jyoti Nivas', lat: BASE_LAT + 0.0016, lon: BASE_LON + 0.0039, facts: [{ slot: 'hazard', value: 'dark lane at night', text: 'Hazard: dark lane at night' }, { slot: 'timing', value: 'shop closed after 9', text: 'Timing: shop closed after 9' }] },
  { id: 'tower-12', label: 'Tower 12, 1st Block', lat: BASE_LAT - 0.0007, lon: BASE_LON - 0.0021, facts: [{ slot: 'entrance', value: 'gate 2', text: 'Entrance: gate 2, not gate 1' }, { slot: 'access', value: 'visitor entry register', text: 'Access: visitor entry register' }] },
];

const GATE_CHANGE_PLACE = 'tower-4';
const OLD_CODE: PlaceFactSeed = { slot: 'gate_code', value: '4417', text: 'Gate code 4417' };
const NEW_CODE: PlaceFactSeed = { slot: 'gate_code', value: '8823', text: 'Gate code 8823' };

// ---------- HTTP helpers ----------

interface Rider {
  deviceId: string;
  token: string;
}

async function register(i: number, total: number): Promise<Rider> {
  const res = await api.post<{ deviceId: string; token: string; error?: string }>('/v1/devices/register', undefined);
  if (res.status === 429) {
    fail(
      `Registration was rate-limited after ${i}/${total} riders (429 too many registrations). All simulated riders ` +
        `share this machine's IP, and the server allows REGISTER_PER_HOUR (default 30) registrations per IP per hour. ` +
        `Restart the server with a higher limit for rehearsals, e.g.:\n` +
        `  cd apps/server && REGISTER_PER_HOUR=200 STORE=memory pnpm start`,
    );
  }
  if (res.status !== 200) fail(`Registration failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

type Fact = { kind: 'place_fact'; group: string; key: string; value: string; text: string; lat: number; lon: number };
type ContributeResult = { accepted: number[]; rejected: { idx: number; reason: string }[] };
type OutcomeBody = { stop_id: string; place_id: string; result: 'delivered' | 'failed'; door_seconds: number; facts_shown: (string | number)[]; at: number };

async function contribute(rider: Rider, facts: Fact[]): Promise<ContributeResult> {
  const res = await api.post<ContributeResult>('/v1/contributions', { facts }, { token: rider.token });
  if (res.status !== 200) fail(`Contribution failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function postOutcomes(rider: Rider, outcomes: OutcomeBody[]) {
  const res = await api.post('/v1/outcomes', { outcomes }, { token: rider.token });
  if (res.status !== 200) fail(`Outcome failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function adminStats() {
  const res = await api.get<any>('/v1/admin/stats', { admin: true });
  return res.status === 200 ? res.data : null;
}

async function adminConflicts() {
  const res = await api.get<any>('/v1/admin/conflicts', { admin: true });
  return res.status === 200 ? res.data : null;
}

const key = (placeId: string, slot: Slot) => `${placeId}:${slot}`;
const stopId = (rider: Rider, placeId: string, seq: number) => `${rider.deviceId}-${placeId}-${seq}`;

// ---------- scenario: gate_change ----------

async function runGateChange() {
  console.log(`Simulating ${riderCount} riders delivering across ${PLACES.length} places in zone "${zone}".`);
  if (hold) console.log(`--hold: stopping before Tower 4's final (corrected) delivery, for a live phone to finish it.`);

  const riders: Rider[] = [];
  for (let i = 0; i < riderCount; i++) {
    riders.push(await register(i + 1, riderCount));
    if (delayMs) await sleep(Math.floor(rnd() * delayMs));
  }
  console.log(`Registered ${riders.length} riders.`);

  // 1) Every rider contributes every seeded place's facts (each rider "discovers" the same neighborhood).
  //    Contributions are idempotent per (place, slot, value), so this just builds up the riders[] list server-side.
  for (const rider of riders) {
    const facts: Fact[] = [];
    for (const place of PLACES) {
      for (const f of place.facts) {
        facts.push({ kind: 'place_fact', group, key: key(place.id, f.slot), value: f.value, text: f.text, lat: place.lat, lon: place.lon });
      }
    }
    await contribute(rider, facts);
    if (delayMs) await sleep(Math.floor(rnd() * delayMs));
  }
  console.log('Seeded place facts from every rider.');

  // 2) Riders deliver against every place except Tower 4 (held back for the gate-change beat), 90% success,
  //    so most facts cross into 'verified'.
  let seq = 0;
  for (const rider of riders) {
    for (const place of PLACES) {
      if (place.id === GATE_CHANGE_PLACE) continue;
      const delivered = rnd() < 0.9;
      const sid = stopId(rider, place.id, seq++);
      await postOutcomes(rider, [
        {
          stop_id: sid,
          place_id: place.id,
          result: delivered ? 'delivered' : 'failed',
          door_seconds: 20 + Math.floor(rnd() * 90),
          facts_shown: place.facts.map((f) => key(place.id, f.slot)),
          at: Date.now(),
        },
      ]);
    }
    if (delayMs) await sleep(Math.floor(rnd() * delayMs));
  }
  console.log('Riders delivered everywhere except Tower 4 — those facts should now be verified.');

  // 3) Tower 4's gate code changes: every rider still has the OLD code and fails at the door.
  const failCount = hold ? riderCount - 1 : riderCount;
  for (let i = 0; i < failCount; i++) {
    const rider = riders[i];
    await postOutcomes(rider, [
      { stop_id: stopId(rider, GATE_CHANGE_PLACE, seq++), place_id: GATE_CHANGE_PLACE, result: 'failed', door_seconds: 60 + Math.floor(rnd() * 60), facts_shown: [key(GATE_CHANGE_PLACE, OLD_CODE.slot)], at: Date.now() },
    ]);
    if (delayMs) await sleep(Math.floor(rnd() * delayMs));
  }
  console.log(`Tower 4: ${failCount} rider(s) tried the old code (4417) and failed.`);

  // 4) One rider figures out the new code and posts it, with a delivered outcome referencing it.
  const fixer = riders[failCount % riders.length];
  await contribute(fixer, [{ kind: 'place_fact', group, key: key(GATE_CHANGE_PLACE, NEW_CODE.slot), value: NEW_CODE.value, text: NEW_CODE.text, lat: PLACES.find((p) => p.id === GATE_CHANGE_PLACE)!.lat, lon: PLACES.find((p) => p.id === GATE_CHANGE_PLACE)!.lon }]);
  await postOutcomes(fixer, [
    { stop_id: stopId(fixer, GATE_CHANGE_PLACE, seq++), place_id: GATE_CHANGE_PLACE, result: 'delivered', door_seconds: 25, facts_shown: [key(GATE_CHANGE_PLACE, NEW_CODE.slot)], at: Date.now() },
  ]);
  console.log(`One rider posted the corrected code (8823) and delivered successfully.`);

  if (hold) {
    console.log(`\n--hold: Tower 4 has one rider left who still has the old code. Have your live phone/device try Tower 4 next —`);
    console.log(`it should be shown the new code (8823) once it syncs, since 4417 is now failing and 8823 is confirmed delivered.`);
  }
}

// ---------- run ----------

const health = await api.get<{ ok: boolean; devices: number }>('/health');
if (health.status !== 200) fail(`Cannot reach ${api.server}/health (${health.status}). Is the server running?`);
console.log(`${api.server}: ${health.data.devices} devices already registered.`);

const before = await adminStats();
if (!before) console.log('(admin key not accepted; skipping the before/after summary)');

await runGateChange();

if (before) {
  const after = await adminStats();
  const publishedNow = (obj: any) => Object.values(obj.knowledge as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
  console.log(`\nBefore: ${before.devices} devices, ${publishedNow(before)} published facts.`);
  console.log(`After:  ${after.devices} devices, ${publishedNow(after)} published facts.`);
  const conflicts = await adminConflicts();
  if (conflicts?.resolved?.length) {
    console.log(`\nConflicts resolved (dashboard Conflicts page shows these):`);
    for (const c of conflicts.resolved.slice(0, 10)) console.log(`  ${c.placeId} · ${c.slot}: ${c.fromValue} -> ${c.toValue}`);
  }
  if (conflicts?.open?.length) {
    console.log(`\nStill open:`);
    for (const c of conflicts.open.slice(0, 10)) console.log(`  ${c.placeId} · ${c.slot}: ${c.values.map((v: any) => v.value).join(' vs ')}`);
  }
}

console.log('\nDone. Open the dashboard to watch it live, or `node tools/reset.ts --yes` to wipe this rehearsal.');
