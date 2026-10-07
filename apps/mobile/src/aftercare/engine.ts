import { getDb } from '@/core/db';
import { cosine, embed } from '@/core/embedder';
import { drainEmbedQueue } from '@/core/embedQueue';
import { getZone, setZone, slug, zoneGroup } from '@/core/groups';
import { ingest } from '@/core/ingest';
import { hybridSearch } from '@/core/search';
import { deletePrivate, type PrivatePayload } from '@/core/shards';
import { submitFact } from '@/privacy';
import { fmtDate } from '@/ui/format';

import { CATEGORIES, CATEGORY_EXEMPLARS, DRUGS, INTERACTIONS, type Category, type Interaction } from './data';

const DAY = 86_400_000;

export type VisitSource = 'recording' | 'prescription' | 'typed';
export type MedStatus = 'active' | 'replaced' | 'stopped' | 'completed';
export type MedAction = 'start' | 'stop' | 'change' | 'continue';

export interface VisitInput {
  id: string;
  doctor: string;
  specialty: string;
  clinic: string;
  ts: number;
  source: VisitSource;
  transcript: string;
  /** Medicines already read and confirmed by the user (a scanned prescription). Saved as given, so one whose name isn't in the drug list is still kept. */
  meds?: { med: MedMention; sentence: string }[];
}

export interface MedMention {
  name: string;
  dose: string;
  freq: string;
  timing: string;
  durationDays: number | null;
  action: MedAction;
}

export interface VisitFact {
  category: Category;
  speaker: string;
  text: string;
  med?: MedMention;
}

export interface VisitRow {
  id: string;
  doctor: string;
  specialty: string;
  clinic: string;
  ts: number;
  source: VisitSource;
  transcript: string;
  facts: VisitFact[];
}

export interface MedRow {
  id: number;
  name: string;
  dose: string;
  freq: string;
  timing: string;
  purpose: string;
  duration_days: number | null;
  visit_id: string;
  doctor: string;
  ts: number;
  sentence: string;
  status: MedStatus;
  note: string | null;
  synced_status: string | null;
}

export interface Alert {
  interaction: Interaction;
  medA: MedRow;
  medB: MedRow;
  crossDoctor: boolean;
}

// ---------- storage ----------

let ready: Promise<void> | null = null;

function ensure() {
  ready ??= (async () => {
    const db = await getDb();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS visits (
        id TEXT PRIMARY KEY, doctor TEXT, specialty TEXT, clinic TEXT, ts INTEGER,
        source TEXT, transcript TEXT, facts TEXT);
      CREATE TABLE IF NOT EXISTS meds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, dose TEXT, freq TEXT, timing TEXT, purpose TEXT,
        duration_days INTEGER, visit_id TEXT, doctor TEXT, ts INTEGER, sentence TEXT,
        status TEXT DEFAULT 'active', note TEXT, synced_status TEXT);
    `);
    if (!(await getZone())) await setZone('family');
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// ---------- on-device understanding ----------

let categoryVectors: Map<Category, number[][]> | null = null;
let warming: Promise<Map<Category, number[][]>> | null = null;

/** Embeds the category exemplars once (~21 short sentences) so the first visit isn't slow. */
export function warmCategories() {
  warming ??= (async () => {
    const m = new Map<Category, number[][]>();
    for (const c of CATEGORIES) {
      const vs: number[][] = [];
      for (const s of CATEGORY_EXEMPLARS[c]) vs.push(await embed(s));
      m.set(c, vs);
    }
    categoryVectors = m;
    return m;
  })().catch((e) => {
    warming = null;
    throw e;
  });
  return warming;
}

async function classify(text: string): Promise<Category> {
  const vectors = categoryVectors ?? (await warmCategories());
  const q = await embed(text);
  let best: Category = 'finding';
  let bestScore = -1;
  for (const c of CATEGORIES) {
    const sims = vectors.get(c)!.map((v) => cosine(q, v)).sort((a, b) => b - a);
    const score = (sims[0] + (sims[1] ?? sims[0])) / 2;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const FREQ: [RegExp, string][] = [
  [/three times|thrice/, 'three times a day'],
  [/twice|two times/, 'twice daily'],
  [/once (?:a day|daily)|every day|daily/, 'once daily'],
  [/at night|bedtime/, 'at night'],
  [/when needed|if (?:the )?pain|\bsos\b/, 'when needed'],
];

export const TIMING: [RegExp, string][] = [
  [/after breakfast/, 'after breakfast'],
  [/before breakfast|empty stomach/, 'before breakfast'],
  [/after (?:food|meals?)/, 'after food'],
  [/in the morning/, 'in the morning'],
  [/at night|bedtime/, 'at night'],
  [/after dinner/, 'after dinner'],
];

export const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30 };

// Aliases are matched as whole words (longest first), so "telma" is not found inside another word.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIASES = new Map(DRUGS.flatMap((d) => d.aliases.map((a) => [a, d] as const)));
const ALIAS_RE = new RegExp(`\\b(?:${[...ALIASES.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`);

export function findDrug(text: string) {
  const m = ALIAS_RE.exec(text.toLowerCase());
  return m ? ALIASES.get(m[0]) : undefined;
}

/** Pulls a structured prescription out of one sentence: drug, dose, how often, when, for how long, and what changed. */
export function extractMed(text: string): MedMention | null {
  const drug = findDrug(text);
  if (!drug) return null;
  const t = text.toLowerCase();
  const doseM = t.match(/(\d+(?:\.\d+)?)\s?(mg|mcg|ml|g|units?)\b/);
  const durM = t.match(/for (\d+|\w+) (day|week|month)s?/);
  let durationDays: number | null = null;
  if (durM) {
    const n = Number(durM[1]) || WORD_NUM[durM[1]] || 0;
    durationDays = n ? n * (durM[2] === 'week' ? 7 : durM[2] === 'month' ? 30 : 1) : null;
  }
  const action: MedAction = /\b(stop|discontinue|no more|don't take)\b/.test(t)
    ? 'stop'
    : /\b(increase|reduce|decrease|change|double|half)\b/.test(t)
      ? 'change'
      : /\bcontinue\b/.test(t)
        ? 'continue'
        : 'start';
  const freq = FREQ.find(([r]) => r.test(t))?.[1] ?? '';
  const timing = TIMING.find(([r]) => r.test(t))?.[1] ?? '';
  return {
    name: drug.name,
    dose: doseM ? `${doseM[1]} ${doseM[2]}` : '',
    freq,
    timing: timing === freq ? '' : timing,
    durationDays,
    action,
  };
}

export function splitTranscript(transcript: string) {
  const out: { speaker: string; text: string }[] = [];
  for (const raw of transcript.split(/\n+/)) {
    const m = raw.match(/^\s*(doctor|patient|dr\.?[^:]*)\s*:\s*(.*)$/i);
    const speaker = m ? (/^patient/i.test(m[1]) ? 'Patient' : 'Doctor') : 'Doctor';
    const body = (m ? m[2] : raw).trim();
    for (const s of body.match(/[^.!?]+[.!?]*/g) ?? []) if (s.trim().length > 3) out.push({ speaker, text: s.trim() });
  }
  return out;
}

/** The doctor speaking in the first person ("I am starting…", "I will write the tests", "I want you to rest", "I have changed your tablet"). */
const DOCTOR_FIRST_PERSON = new RegExp(
  [
    String.raw`\bI(?:'ll| will) (?:write|check|give|prescribe|increase|reduce|start|stop|change|add|order|refer|see|examine|repeat|continue|keep|send|note|explain|arrange|run|review)\b`,
    String.raw`\bI am (?:starting|increasing|reducing|stopping|adding|changing|prescribing|giving)\b`,
    String.raw`\bI(?: would|'d) (?:like you|like to (?:see|check|examine|start|change|increase|reduce|repeat)|suggest|advise|recommend)\b`,
    String.raw`\bI (?:want|need) you\b|\bI (?:suggest|advise|recommend|prescribe|can see)\b|\bI'm going to (?:start|give|prescribe|check|change)\b`,
    String.raw`\bI(?:'ve| have)? \w+ (?:your|you)\b`,
    String.raw`\bmy (?:advice|suggestion|recommendation|opinion)\b`,
  ].join('|'),
  'gi',
);

/** A sentence that is only an acknowledgement or a non-answer ("Yes", "Okay", "Haan", "Theek hai", "Not really", "Sorry, what?"). */
const ACKNOWLEDGEMENT =
  /^(?:(?:yes|yeah|yep|yup|no|nope|ok|okay|hmm+|haan?|ji|nahi|nahin|achha|accha|acha|theek hai|right|sure|fine|alright|sorry|pardon|what|thanks|thank you|nothing else|nothing|not really|not much|a little|a bit|little bit|maybe|doctor|dr|sir|madam|ma'am)\b[\s,.!?]*)+$/i;

// "sir" and "madam" are not used here: doctors address patients that way too
const DOCTOR_WORDS = String.raw`(?:doctor|dr)`;
const GREETING = String.raw`(?:(?:hi|hello|hey|yes|yeah|ok|okay|sure|alright|namaste|ji|good (?:morning|afternoon|evening)),?\s*)*`;
/** Addressing the doctor ("Hi, Dr.", "Yes doctor", "Okay doctor, I will do that", "Is it serious doctor?"), but not "see a doctor". */
function addressesDoctor(text: string) {
  if (new RegExp(`^${GREETING}${DOCTOR_WORDS}\\b`, 'i').test(text)) return true;
  const m = new RegExp(`\\b(?:(\\w+)\\s+)?${DOCTOR_WORDS}\\W*$`, 'i').exec(text);
  return !!m && !/^(?:a|an|the|your|another|family|my|good)$/i.test(m[1] ?? '');
}

/** A short answer about how long or when ("Three days", "Since last week", "Yesterday evening"). */
const TIME_ANSWER =
  /^(?:(?:since|from|about|around|nearly|almost)\s+)?(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|couple of|\d+)\s+(?:day|week|month|year|hour)s?(?:\s+ago)?|yesterday(?:\s+(?:morning|afternoon|evening|night))?|last\s+(?:week|month|year|night)|this\s+(?:morning|week))[\s.!?]*$|^since\s+(?:yesterday|last\s+\w+|morning|\w+day)[\s.!?]*$/i;

/** Symptoms described as happening ("The pain gets worse at night", "It started a week ago"). "If the pain gets worse, call me" is the doctor's. */
const SYMPTOM_REPORT =
  /\b(?:pain|headache|cough|fever|swelling|burning|itching|dizziness|nausea|vomiting|weakness|cramps?|rash|bleeding)\s+(?:started|starts|keeps|gets worse|got worse|is worse|comes (?:every|daily|at|after|in the)|increases)\b|^it (?:started|began) (?:\d|a |an |one |two |three |few |after |when |since |yesterday|last )/i;
const CONDITIONAL = /^(?:if|when|in case|once|unless|until)\b/i;

/**
 * True when a sentence is clearly the patient speaking: first-person statements ("I feel dizzy", "my knee hurts",
 * "I am taking Aspirin"), thank-yous and one-word replies, addressing the doctor, short "how long" answers, and
 * symptom reports. The speech recognizer gives words, not voices, so this goes by wording and only catches clear
 * cases. Anything unclear stays with the doctor, which is the safe side; the review step can put lines back.
 */
export function soundsLikePatient(text: string) {
  const t = text.replace(/[’‘]/g, "'").trim();
  if (/\bthank(?:s| you)\b/i.test(t) || ACKNOWLEDGEMENT.test(t) || addressesDoctor(t) || TIME_ANSWER.test(t)) return true;
  if (!CONDITIONAL.test(t) && SYMPTOM_REPORT.test(t)) return true;
  const rest = t.replace(DOCTOR_FIRST_PERSON, ' ').replace(/\b(?:let|call|tell|show|give|ask|see) me\b/gi, ' ');
  return /\b(?:I|I'm|I've|I'd|I'll|my|mine|myself|me)\b/i.test(rest);
}

/**
 * Splits a recorded transcript into the doctor's sentences (one per line, unlabeled: saveVisit treats unlabeled
 * lines as the doctor's) and the sentences set aside as the patient's, so the review step can show them and put any back.
 */
export function splitDoctorLines(transcript: string) {
  const doctor: string[] = [];
  const leftOut: string[] = [];
  for (const s of splitTranscript(transcript)) (soundsLikePatient(s.text) ? leftOut : doctor).push(s.text);
  return { doctor: doctor.join('\n'), leftOut };
}

// ---------- saving a visit ----------

export type Stage = 'transcribing' | 'understanding' | 'indexing' | 'checking' | 'done';

export interface SaveSummary {
  facts: VisitFact[];
  changes: string[];
  newAlerts: Alert[];
}

export async function visitExists(id: string) {
  await ensure();
  const db = await getDb();
  return !!(await db.getFirstAsync('SELECT id FROM visits WHERE id = ?', [id]));
}

/**
 * The whole on-device pipeline for one visit: split → classify every sentence with MiniLM → extract
 * prescriptions → index every sentence into the private Qdrant Edge shard → reconcile the medicine list
 * (dose changes supersede, stops retire) → re-check interactions → queue the medicine list for family sync.
 */
export async function saveVisit(v: VisitInput, onStage?: (s: Stage, detail?: string) => void): Promise<SaveSummary> {
  await ensure();
  const db = await getDb();
  const alertsBefore = new Set((await listAlerts()).map(alertKey));

  onStage?.('understanding');
  const sentences = splitTranscript(v.transcript);
  const facts: VisitFact[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const med = s.speaker === 'Doctor' ? extractMed(s.text) : null;
    const category: Category = med ? 'medicine' : await classify(s.text);
    facts.push({ category, speaker: s.speaker, text: s.text, ...(med ? { med } : {}) });
    onStage?.('understanding', `${i + 1}/${sentences.length}`);
  }
  const given: VisitFact[] = (v.meds ?? []).map(({ med, sentence }) => ({ category: 'medicine', speaker: 'Doctor', text: sentence, med }));
  facts.unshift(...given);
  const transcript = [...given.map((f) => f.text), v.transcript].filter(Boolean).join('\n');

  await db.runAsync(
    'INSERT OR REPLACE INTO visits (id, doctor, specialty, clinic, ts, source, transcript, facts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [v.id, v.doctor, v.specialty, v.clinic, v.ts, v.source, transcript, JSON.stringify(facts)],
  );

  onStage?.('indexing');
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    await ingest({
      source: 'visit',
      extId: `visit:${v.id}:${i}`,
      text: f.text,
      ts: v.ts,
      meta: { visit_id: v.id, speaker: f.speaker, category: f.category },
    });
  }
  await drainEmbedQueue();

  onStage?.('checking');
  const changes: string[] = [];
  for (const f of facts) if (f.med) changes.push(...(await applyMed(f.med, f.text, v)));
  await expireCourses();

  const newAlerts = (await listAlerts()).filter((a) => !alertsBefore.has(alertKey(a)));
  await queueMedSync();
  onStage?.('done');
  return { facts, changes, newAlerts };
}

async function applyMed(m: MedMention, sentence: string, v: VisitInput): Promise<string[]> {
  const db = await getDb();
  const current = await db.getFirstAsync<MedRow>("SELECT * FROM meds WHERE name = ? AND status = 'active' ORDER BY ts DESC LIMIT 1", [m.name]);
  const when = fmtDate(v.ts);

  if (m.action === 'stop') {
    if (!current) return [];
    await db.runAsync("UPDATE meds SET status = 'stopped', note = ? WHERE id = ?", [`Stopped by ${v.doctor} on ${when}`, current.id]);
    return [`${m.name} stopped`];
  }

  const dose = m.dose || current?.dose || '';
  const freq = m.freq || current?.freq || '';
  const timing = m.timing || current?.timing || '';

  if (current && current.dose === dose && current.freq === freq) {
    await db.runAsync('UPDATE meds SET note = ? WHERE id = ?', [`Re-confirmed by ${v.doctor} on ${when}`, current.id]);
    return [];
  }

  const purpose = findDrug(m.name)?.purpose ?? '';
  await db.runAsync(
    'INSERT INTO meds (name, dose, freq, timing, purpose, duration_days, visit_id, doctor, ts, sentence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.name, dose, freq, timing, purpose, m.durationDays, v.id, v.doctor, v.ts, sentence],
  );
  if (current) {
    await db.runAsync("UPDATE meds SET status = 'replaced', note = ? WHERE id = ?", [`Changed to ${dose} by ${v.doctor} on ${when}`, current.id]);
    return [`${m.name} ${current.dose} → ${dose}`];
  }
  return [`${m.name} ${dose} started`];
}

/** A fixed-length course (e.g. "for five days") retires itself once the days are over. */
async function expireCourses(now = Date.now()) {
  const db = await getDb();
  await db.runAsync(
    "UPDATE meds SET status = 'completed', note = 'Course finished' WHERE status = 'active' AND duration_days IS NOT NULL AND ts + duration_days * ? < ?",
    [DAY, now],
  );
}

// ---------- reads ----------

export async function listVisits(): Promise<VisitRow[]> {
  await ensure();
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<VisitRow, 'facts'> & { facts: string }>('SELECT * FROM visits ORDER BY ts DESC');
  return rows.map((r) => ({ ...r, facts: JSON.parse(r.facts || '[]') as VisitFact[] }));
}

export async function listMeds(): Promise<MedRow[]> {
  await ensure();
  await expireCourses();
  const db = await getDb();
  return db.getAllAsync<MedRow>("SELECT * FROM meds ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, ts DESC");
}

const alertKey = (a: Alert) => [a.medA.id, a.medB.id].sort().join('-');

export async function listAlerts(): Promise<Alert[]> {
  await ensure();
  const db = await getDb();
  const active = await db.getAllAsync<MedRow>("SELECT * FROM meds WHERE status = 'active'");
  const byName = new Map(active.map((m) => [m.name, m]));
  const out: Alert[] = [];
  for (const i of INTERACTIONS) {
    const a = byName.get(i.a);
    const b = byName.get(i.b);
    if (a && b) out.push({ interaction: i, medA: a, medB: b, crossDoctor: a.doctor !== b.doctor });
  }
  return out.sort((x, y) => (x.interaction.severity === 'high' ? -1 : 1) - (y.interaction.severity === 'high' ? -1 : 1));
}

export async function memoryStats() {
  await ensure();
  const db = await getDb();
  const moments = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE source = 'visit' AND embedded = 1");
  const visits = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM visits');
  const pending = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'");
  return { moments: moments?.n ?? 0, visits: visits?.n ?? 0, pending: pending?.n ?? 0 };
}

// ---------- asking ----------

export interface AskHit {
  text: string;
  doctor: string;
  specialty: string;
  date: string;
  category: string;
  score: number;
}

export interface AskAnswer {
  answer: string;
  tone: 'good' | 'warn' | 'bad' | 'soft';
  drug: string | null;
  hits: AskHit[];
  ms: number;
}

/** Hybrid (MiniLM dense + keyword sparse) search over every visit sentence in the private shard, fully offline. */
export async function ask(question: string): Promise<AskAnswer> {
  const t0 = Date.now();
  await ensure();
  const db = await getDb();
  const raw = await hybridSearch<PrivatePayload>('private', question, { must: [{ key: 'source', match: { value: 'visit' } }] }, 5);

  const visits = new Map((await listVisits()).map((v) => [v.id, v]));
  const hits: AskHit[] = [];
  for (const h of raw) {
    const ref = h.payload.ref ?? '';
    const visitId = ref.slice(ref.indexOf(':') + 1, ref.lastIndexOf(':'));
    const v = visits.get(visitId);
    if (!v) continue;
    const item = await db.getFirstAsync<{ meta: string | null }>('SELECT meta FROM items WHERE ext_id = ?', [ref]);
    const meta = item?.meta ? (JSON.parse(item.meta) as { category?: string }) : {};
    hits.push({ text: h.payload.text, doctor: v.doctor, specialty: v.specialty, date: fmtDate(v.ts), category: meta.category ?? '', score: h.denseScore ?? h.score });
  }

  const drug = findDrug(question) ?? (hits[0] ? findDrug(hits[0].text) : undefined);
  let answer = hits[0] ? `${hits[0].doctor} said: “${hits[0].text}”` : 'Nothing about that in your visits yet.';
  let tone: AskAnswer['tone'] = hits[0] ? 'soft' : 'warn';

  if (drug) {
    const history = await db.getAllAsync<MedRow>('SELECT * FROM meds WHERE name = ? ORDER BY ts DESC', [drug.name]);
    const current = history.find((m) => m.status === 'active');
    if (current) {
      answer = `Take ${drug.name} ${current.dose}${current.freq ? `, ${current.freq}` : ''}${current.timing ? `, ${current.timing}` : ''}. ${drug.purpose}. Prescribed by ${current.doctor} on ${fmtDate(current.ts)}.`;
      const older = history.find((m) => m.status === 'replaced');
      if (older) answer += ` (Changed from ${older.dose}.)`;
      tone = 'good';
      const clash = (await listAlerts()).find((a) => a.medA.name === drug.name || a.medB.name === drug.name);
      if (clash) {
        const other = clash.medA.name === drug.name ? clash.medB : clash.medA;
        answer += ` ⚠ Don’t combine with ${other.name} without asking a doctor: ${clash.interaction.message}`;
        tone = 'bad';
      }
    } else if (history[0]) {
      answer = `${drug.name} is no longer on your list. ${cap(history[0].note ?? history[0].status)}.`;
      tone = 'warn';
    }
  }
  return { answer, tone, drug: drug?.name ?? null, hits, ms: Date.now() - t0 };
}

// ---------- family sync ----------

const medText = (m: MedRow) =>
  m.status === 'active' ? `${m.name} ${m.dose}${m.freq ? ` ${m.freq}` : ''}${m.timing ? `, ${m.timing}` : ''}` : `${m.name} ${m.dose} ${m.status}`;

/**
 * Only the medicine list leaves the phone — never the transcript or audio. Each status change is queued
 * once through the Leak Check into the outbox; the sync engine pushes it when a network is available.
 */
export async function queueMedSync() {
  await ensure();
  const db = await getDb();
  const zone = (await getZone()) ?? 'family';
  const rows = await db.getAllAsync<MedRow>('SELECT * FROM meds WHERE synced_status IS NULL OR synced_status != status');
  let queued = 0;
  for (const m of rows) {
    const res = await submitFact(
      { kind: 'place_fact', group: zoneGroup(zone), key: `med-${slug(m.name)}:other`, value: `${m.dose} ${m.freq} ${m.status}`.trim(), text: medText(m) },
      { slot: 'other' },
    );
    if (res.status !== 'blocked') {
      await db.runAsync('UPDATE meds SET synced_status = ? WHERE id = ?', [m.status, m.id]);
      if (res.status === 'queued') queued++;
    }
  }
  return queued;
}

// ---------- demo reset ----------

export async function resetAftercare() {
  await ensure();
  const db = await getDb();
  const items = await db.getAllAsync<{ id: number }>("SELECT id FROM items WHERE source = 'visit'");
  if (items.length) deletePrivate(items.map((i) => i.id));
  await db.execAsync("DELETE FROM visits; DELETE FROM meds; DELETE FROM items WHERE source = 'visit'; DELETE FROM shared_hashes;");
}
