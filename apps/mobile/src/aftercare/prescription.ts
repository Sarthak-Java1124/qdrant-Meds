import { DOCTORS, DRUGS, type Drug } from './data';
import { FREQ, TIMING, WORD_NUM, findDrug, type MedMention } from './engine';

/** One medicine read from a prescription. `recognised` is false when the name is not in the drug list (check it by hand). */
export interface RxMedicine extends MedMention {
  recognised: boolean;
  /** The text this was read from, for comparing with the paper. */
  line: string;
}

export interface RxHeader {
  doctor: string;
  specialty: string;
  clinic: string;
  /** The date on the prescription, or null if none was found. */
  ts: number | null;
}

export interface ParsedPrescription {
  header: RxHeader;
  medicines: RxMedicine[];
  /** Instructions that are not medicines: diet, tests, follow-up, warnings. */
  notes: string[];
  /** Share of lines that look like real text (0 to 1), and whether the photo should be retaken or checked closely. */
  quality: { readable: number; poor: boolean };
}

// ---------- cleaning ----------

/** Fixes the usual OCR slips: "rng" for "mg", letter O for zero in doses and schedules, "×" for "x". */
function clean(s: string) {
  return s
    .replace(/℞/g, 'Rx')
    .replace(/[×✕]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[|_]/g, ' ')
    .replace(/(\d)([Oo]+)(?=\s*(?:mg|rng|m9|mq|mcg|ml)\b)/g, (_, d: string, o: string) => d + '0'.repeat(o.length))
    .replace(/\b(\d+)\s*(?:rng|m9|mq)\b/gi, '$1 mg')
    .replace(/(\d)[Oo](?=\d)/g, '$10')
    .replace(/(\d)[lI](?=\d)/g, '$11')
    .replace(/(^|[\s-])[Oo](?=\s*-\s*[01])/g, '$10')
    .replace(/([01]\s*-\s*)[Oo]\b/g, '$10')
    .replace(/(\b\d{1,2})\s*[/.-]\s*(\d{2})\s*[1lI|]\s*(\d{2}\b)/g, '$1/$2/$3')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Printed form labels down the left margin ("Wt", "BP", "SPO2", "Follow Up"): not part of what is written beside them. */
const FORM_LABEL = /^(?:c\/o|ht|wt|bmi|bp|hr|pulse|spo2|temp|built|nutrition|p\/c\/i\/e|p\/a|chest|cvs|cns|diagnosis|follow\s*up|date|name|age\s*\/\s*sex|valid\s*upto)\b[\s.:\-]*/i;
/** Vitals and examination findings: recorded on the sheet but not instructions or medicines. */
const VITALS = /^(?:ht|wt|bmi|bp|hr|pulse|spo2|temp|built|nutrition|p\/c\/i\/e|p\/a|chest|cvs|cns)\b/i;

const NUMBERING = /^\s*(?:\d{1,2}\s*[.)]|[-•*]+)\s+/;
const PREFIX = /^(?:tab(?:let)?s?|cap(?:sule)?s?|syp|syrup|inj(?:ection)?|oint(?:ment)?|cream|gel|drops?|susp(?:ension)?|lotion|sachet|powder|inhaler|spray)\b\.?\s*/i;
const RX_MARK = /^(?:rx|r\/|r x)\b/i;

const PII = /\b(?:name|age\s*\/\s*sex)\b\s*[:.\-]|^(?:patient|pt|name|age|sex|gender|m\/f|ph|phone|mob|mobile|contact|reg|regn|uhid|ipd|opd|id|address|add|dob|weight|wt|height|ht)\b\s*[:.\-]|\b(?:\+?91[\s-]?)?[6-9]\d{9}\b|^(?:mr|mrs|ms|master|baby)\.?\s+[a-z]|\b\d{1,3}\s*(?:y|yrs?|years?)\b.*\b(?:m|f|male|female)\b/i;
const FOOTER = /medicolegal|\bnagar\b|\bstreet\b|\broad\b|\bmarg\b|\b(?:bp|spo2|hr)\s*\d|signature|\bsign\b|stamp|appointment|timings?|clinic hours|www\.|@|\bvalid\b|\bregd?\b|reg\.? no|e-?mail/i;

// ---------- medicine fields ----------

const DOSE = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*(mg|mcg|µg|ug|gm|g|ml|iu|units?)\b/i;

function doseOf(line: string) {
  const m = DOSE.exec(line);
  if (!m) return '';
  const unit = /^(?:µg|ug)$/i.test(m[2]) ? 'mcg' : /^gm$/i.test(m[2]) ? 'g' : /^unit/i.test(m[2]) ? 'units' : m[2].toLowerCase();
  return `${m[1].replace(',', '.').replace(/\s+/g, '')} ${unit}`;
}

/** "1-0-1" style schedules: morning-noon-night (optionally four slots). */
const SCHEDULE = /(?:^|[^\d/.])([012]|1\/2|½)\s*-\s*([012]|1\/2|½)\s*-\s*([012]|1\/2|½)(?:\s*-\s*([012]|1\/2|½))?(?![\d/.])/;

function scheduleOf(line: string): { freq: string; timing: string } | null {
  const m = SCHEDULE.exec(line);
  if (!m) return null;
  const slots = m.slice(1).filter((x) => x !== undefined);
  const on = slots.map((x) => x !== '0');
  const n = on.filter(Boolean).length;
  if (n === 0) return null;
  if (n === 4) return { freq: 'four times a day', timing: '' };
  if (n === 3) return { freq: 'three times a day', timing: '' };
  if (n === 2) return { freq: 'twice daily', timing: '' };
  if (on[2] && slots.length === 3) return { freq: 'at night', timing: '' };
  return { freq: 'once daily', timing: on[0] ? 'in the morning' : '' };
}

const ABBREVIATION_FREQ: [RegExp, string][] = [
  [/\b(?:od|qd)\b/, 'once daily'],
  [/\b(?:bd|bid)\b/, 'twice daily'],
  [/\b(?:tds|tid)\b/, 'three times a day'],
  [/\b(?:qid|qds)\b/, 'four times a day'],
  [/\bhs\b/, 'at night'],
  [/\b(?:sos|prn)\b/, 'when needed'],
];
const ABBREVIATION_TIMING: [RegExp, string][] = [
  [/\b(?:ac|bb)\b|before (?:food|meals?)/, 'before food'],
  [/\b(?:pc|af|ab)\b|after (?:food|meals?)/, 'after food'],
];

function freqTimingOf(line: string) {
  const lower = line.toLowerCase().replace(/\./g, '');
  const sched = scheduleOf(line);
  const freq = sched?.freq || ABBREVIATION_FREQ.find(([r]) => r.test(lower))?.[1] || FREQ.find(([r]) => r.test(lower))?.[1] || '';
  const timing = ABBREVIATION_TIMING.find(([r]) => r.test(lower))?.[1] || TIMING.find(([r]) => r.test(lower))?.[1] || sched?.timing || '';
  return { freq, timing: timing === freq ? '' : timing };
}

function durationOf(line: string): number | null {
  const lower = line.toLowerCase();
  const slash = /(?:^|[^\d/])(\d{1,3})\s*\/\s*7\b/.exec(lower);
  if (slash) return Number(slash[1]);
  const m =
    /(?:^|[\s(])(?:x|for)\s*(\d+|[a-z]+)\s*(days?|d|weeks?|wks?|w|months?)\b/.exec(lower) ??
    /\b(\d+)\s*(days?|weeks?|wks?|months?)\b/.exec(lower);
  if (!m) return null;
  const n = Number(m[1]) || WORD_NUM[m[1]] || 0;
  if (!n) return null;
  const days = n * (/^m/.test(m[2]) ? 30 : /^w/.test(m[2]) ? 7 : 1);
  return days <= 365 ? days : null;
}

function actionOf(line: string): MedMention['action'] {
  const t = line.toLowerCase();
  if (/\b(?:stop|discontinue)\b/.test(t)) return 'stop';
  if (/\b(?:increase|decrease|reduce)\b/.test(t)) return 'change';
  if (/\bcontinue\b/.test(t)) return 'continue';
  return 'start';
}

// ---------- matching drug names despite OCR mistakes ----------

const FUZZY_ALIASES = DRUGS.flatMap((d) => d.aliases.filter((a) => /^[a-z]{5,}$/.test(a)).map((a) => [a, d] as const));

/** Edit distance counting a swap of two neighbouring letters as one edit. */
function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

/** An exact whole-word match, or else a word within one or two letters of a known drug (OCR typos like "Amlodlpine"). */
function drugIn(line: string, allowTypos: boolean): Drug | undefined {
  const exact = findDrug(line);
  if (exact || !allowTypos) return exact;
  for (const word of line.toLowerCase().match(/[a-z]{5,}/g) ?? []) {
    const limit = word.length >= 8 ? 2 : 1;
    let best: Drug | undefined;
    let bestDistance = limit + 1;
    for (const [alias, drug] of FUZZY_ALIASES) {
      if (Math.abs(alias.length - word.length) > limit) continue;
      const dist = editDistance(word, alias);
      if (dist < bestDistance) {
        best = drug;
        bestDistance = dist;
      }
    }
    if (best) return best;
  }
  return undefined;
}

// ---------- medicine lines ----------

const strip = (line: string) => line.replace(NUMBERING, '').trim();

function looksLikeMedicine(line: string) {
  const t = strip(line);
  const prefixed = PREFIX.test(t);
  const scheduled = !!scheduleOf(t) || freqTimingOf(t).freq !== '' || durationOf(t) !== null;
  const dosed = DOSE.test(t);
  if (prefixed) return true;
  if (findDrug(t)) return true;
  return (dosed && scheduled) || (!!drugIn(t, true) && (dosed || scheduled));
}

/** A short follow-on line such as "1-0-1 x 5 days" that belongs to the medicine on the line above. */
function isDetailOnly(line: string) {
  const t = strip(line);
  return t.split(' ').length <= 8 && !findDrug(t) && !PREFIX.test(t) && (!!scheduleOf(t) || freqTimingOf(t).freq !== '' || durationOf(t) !== null || DOSE.test(t));
}

function parseMedicine(raw: string): RxMedicine {
  const text = strip(raw);
  const withoutPrefix = text.replace(PREFIX, '');
  const drug = drugIn(withoutPrefix, true);
  const ft = freqTimingOf(text);
  let name = drug?.name ?? '';
  if (!drug) {
    const words: string[] = [];
    for (const w of withoutPrefix.split(' ')) {
      if (/^\d/.test(w) || /^[(\[]/.test(w) || ABBREVIATION_FREQ.some(([r]) => r.test(w.toLowerCase())) || /^(?:x|for|after|before|daily|once|twice)$/i.test(w)) break;
      words.push(w.replace(/[^\p{L}\p{N}-]/gu, ''));
      if (words.length === 3) break;
    }
    name = words.filter(Boolean).join(' ');
    name = name ? name[0].toUpperCase() + name.slice(1).toLowerCase() : 'Unreadable medicine';
  }
  return { name, recognised: !!drug, dose: doseOf(text), freq: ft.freq, timing: ft.timing, durationDays: durationOf(text), action: actionOf(text), line: raw };
}

/** The sentence a medicine is stored as, e.g. "Take Amlodipine 5 mg once daily after food for 5 days." */
export function medicineSentence(m: MedMention) {
  const stop = m.action === 'stop';
  const verb = m.action === 'continue' ? 'Continue' : stop ? 'Stop' : 'Take';
  let s = [verb, m.name, m.dose, stop ? '' : m.freq, stop ? '' : m.timing].filter(Boolean).join(' ');
  if (m.durationDays && !stop) s += ` for ${m.durationDays} days`;
  return `${s}.`;
}

// ---------- header: doctor, clinic, date ----------

const SPECIALTIES: [RegExp, string][] = [
  [/cardiolog/i, 'Cardiologist'],
  [/orthop|ortho\b/i, 'Orthopaedic'],
  [/diabet/i, 'Diabetologist'],
  [/endocrin/i, 'Endocrinologist'],
  [/paediatric|pediatric/i, 'Paediatrician'],
  [/gynae|gynec|obstet/i, 'Gynaecologist'],
  [/dermato|skin/i, 'Dermatologist'],
  [/\bent\b|otorhino/i, 'ENT'],
  [/neurolog/i, 'Neurologist'],
  [/psychiat/i, 'Psychiatrist'],
  [/ophthal|\beye\b/i, 'Ophthalmologist'],
  [/urolog/i, 'Urologist'],
  [/gastro/i, 'Gastroenterologist'],
  [/pulmon|chest/i, 'Pulmonologist'],
  [/nephro/i, 'Nephrologist'],
  [/dental|dentist/i, 'Dentist'],
  [/physician|general medicine/i, 'General Physician'],
];
const CLINIC = /\b(?:clinic|hospital|nursing home|health ?care|polyclinic|centre|center|diagnostic|medical)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const titleCase = (s: string) => s.replace(/\b([a-z])([a-z]*)/gi, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
const nameKey = (s: string) => s.toLowerCase().replace(/\bdr\b\.?/g, '').replace(/[^a-z]/g, '');

function doctorNameOf(lines: string[]) {
  for (const line of lines) {
    const m = /\bdr\.?\s+([a-z][a-z.\s]{2,40})/i.exec(line);
    if (!m) continue;
    const cut = m[1].split(/\s+(?:mbbs|md|ms|dm|mch|dnb|bds|mds|dgo|dch|frcs|mrcp)\b|[,(]/i)[0];
    const words = cut.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    if (words.replace(/[^a-z]/gi, '').length >= 3) return `Dr. ${titleCase(words)}`;
  }
  return '';
}

function dateOf(lines: string[], now: number): number | null {
  const ordered = [...lines.filter((l) => /date/i.test(l)), ...lines];
  const year = new Date(now).getFullYear();
  const make = (d: number, mo: number, y: number) => {
    const full = y < 100 ? 2000 + y : y;
    const ts = new Date(full, mo - 1, d, 12).getTime();
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && full >= 2000 && full <= year + 1 && ts <= now + 86_400_000 ? ts : null;
  };
  for (const line of ordered) {
    const num = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})\b/.exec(line);
    const named = new RegExp(`(\\d{1,2})\\s*(${MONTHS.join('|')})[a-z]*\\.?,?\\s*(\\d{2,4})`, 'i').exec(line);
    const ts = num ? make(Number(num[1]), Number(num[2]), Number(num[3])) : named ? make(Number(named[1]), MONTHS.indexOf(named[2].toLowerCase()) + 1, Number(named[3])) : null;
    if (ts) return ts;
  }
  return null;
}

function headerOf(lines: string[], now: number): RxHeader {
  let doctor = doctorNameOf(lines);
  let specialty = SPECIALTIES.find(([r]) => lines.some((l) => r.test(l)))?.[1] ?? '';
  const clinics = lines.filter((l) => CLINIC.test(l) && !PII.test(l) && !/\d/.test(l) && l.split(' ').length <= 8);
  let clinic = (clinics.find((l) => !/\b(?:fellowship|society|association|member)\b/i.test(l)) ?? '').replace(/^[^\p{L}\p{N}(]+|[()]/gu, '').trim();
  const key = nameKey(doctor);
  const profile = key ? DOCTORS.find((p) => nameKey(p.name) === key) : undefined;
  if (profile) {
    doctor = profile.name;
    specialty = profile.specialty;
    clinic = profile.clinic;
  }
  return { doctor, specialty, clinic, ts: dateOf(lines, now) };
}

// ---------- the whole prescription ----------

/** True when a line looks like real text rather than OCR noise. */
function readable(line: string) {
  const plain = line.replace(/[^\p{L}\p{N}\s.,:;()/%+\-]/gu, '').length / Math.max(line.length, 1) >= 0.85;
  const word = /[a-z]{3,}/i.test(line) && /[aeiouy]/i.test(line);
  return plain && (word || /\d/.test(line));
}

/**
 * Turns the lines read from a prescription photo (top to bottom) into the doctor's details, the medicines and the
 * other instructions. Nothing that looks like a medicine is dropped: an unknown name becomes `recognised: false`.
 */
export function parsePrescription(rawLines: string[], now = Date.now()): ParsedPrescription {
  const lines = rawLines.map(clean).filter((l) => l.length > 0);
  const rx = lines.findIndex((l) => RX_MARK.test(l));
  const firstMed = lines.findIndex((l) => !PII.test(l) && looksLikeMedicine(l));
  const headerLike = (l: string) => /\bdr\.?\s/i.test(l) || CLINIC.test(l) || PII.test(l) || /date|\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}/i.test(l);
  let leading = 0;
  while (leading < Math.min(6, lines.length) && headerLike(lines[leading])) leading++;
  // the letterhead and the Date / Name / Age rows come first; what follows is the body
  const lastDetail = lines.slice(0, 14).reduce((last, l, i) => (/\b(?:date|name|age\s*\/\s*sex|valid\s*upto)\b/i.test(l) ? i : last), -1);
  const bodyStart = rx >= 0 && (firstMed < 0 || rx < firstMed) ? rx + 1 : firstMed >= 0 ? firstMed : Math.max(leading, lastDetail + 1);
  const header = headerOf(lines.slice(0, Math.max(bodyStart, Math.min(8, lines.length))), now);

  const meds: string[] = [];
  const notes: string[] = [];
  let afterMedicine = false;
  for (const raw of lines.slice(bodyStart)) {
    if (RX_MARK.test(raw) && raw.split(' ').length <= 2) continue;
    if (PII.test(raw) || FOOTER.test(raw)) continue;
    const line = raw.replace(FORM_LABEL, '').trim();
    if (!line || VITALS.test(raw) && !looksLikeMedicine(line)) continue;
    if (looksLikeMedicine(line)) {
      meds.push(strip(line));
      afterMedicine = true;
    } else if (afterMedicine && isDetailOnly(line)) {
      meds[meds.length - 1] += ` ${strip(line)}`;
    } else {
      afterMedicine = false;
      // a lone fragment (one or two letters of a smudged word) is not an instruction
      if (/[a-z]{3,}/i.test(line) && strip(line).split(' ').length >= 2) notes.push(strip(line));
    }
  }

  const medicines = meds.map(parseMedicine);
  const good = lines.filter(readable).length;
  const share = lines.length ? good / lines.length : 0;
  return { header, medicines, notes: [...new Set(notes)], quality: { readable: share, poor: share < 0.6 || lines.length < 3 || medicines.length === 0 } };
}

/** A piece of text the OCR engine found, with where it sits in the photo. */
export interface OcrBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Joins pieces of text that sit on the same row of the page ("Tab Amlodipine" ... "1-0-1" ... "5 days") into one
 * line, top to bottom, left to right. A table row often comes back from OCR as separate pieces.
 */
export function groupRows(boxes: OcrBox[]): string[] {
  const items = boxes.filter((b) => b.text.trim()).sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const heights = items.map((b) => b.height).sort((a, b) => a - b);
  const typical = heights[heights.length >> 1] ?? 0;
  const rows: OcrBox[][] = [];
  for (const box of items) {
    const row = rows[rows.length - 1];
    const rowMid = row ? row.reduce((sum, r) => sum + r.y + r.height / 2, 0) / row.length : 0;
    if (row && Math.abs(box.y + box.height / 2 - rowMid) <= typical * 0.6) row.push(box);
    else rows.push([box]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((b) => b.text.trim()).join(' '));
}
