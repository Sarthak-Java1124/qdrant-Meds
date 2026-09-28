// Offline checks for Aftercare's pure extraction logic on the three demo visits: sentence split,
// medicine/dose/frequency/timing/duration extraction, and change/stop/continue detection.
// Run: node tools/seed/verify-aftercare.mjs
import { app, loadTs, mock } from './_load.mjs';

for (const m of ['@/core/embedder', '@/core/embedQueue', '@/core/groups', '@/core/ingest', '@/core/search', '@/core/shards', '@/privacy']) mock(m, {});
mock('@/ui/format', { fmtDate: (ts) => new Date(ts).toDateString() });

const { extractMed, splitTranscript } = loadTs(app('aftercare/engine.ts'));
const { DEMO_VISITS } = loadTs(app('aftercare/data.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const meds = (visit) => splitTranscript(visit.transcript).filter((s) => s.speaker === 'Doctor').map((s) => extractMed(s.text)).filter(Boolean);
const [v1, v2, v3] = DEMO_VISITS.map(meds);
const find = (list, name) => list.find((m) => m.name === name);

check('visit 1 splits into doctor + patient sentences', splitTranscript(DEMO_VISITS[0].transcript).some((s) => s.speaker === 'Patient'));
check('visit 1: three medicines', v1.length === 3, v1.map((m) => m.name).join(', '));
check('Aspirin 75 mg once daily after breakfast', JSON.stringify(find(v1, 'Aspirin')) === JSON.stringify({ name: 'Aspirin', dose: '75 mg', freq: 'once daily', timing: 'after breakfast', durationDays: null, action: 'start' }), JSON.stringify(find(v1, 'Aspirin')));
check('Atorvastatin at night', find(v1, 'Atorvastatin')?.freq === 'at night' && find(v1, 'Atorvastatin')?.durationDays === null, JSON.stringify(find(v1, 'Atorvastatin')));
check('Ibuprofen twice daily, 5-day course', find(v2, 'Ibuprofen')?.freq === 'twice daily' && find(v2, 'Ibuprofen')?.durationDays === 5, JSON.stringify(find(v2, 'Ibuprofen')));
check('Pantoprazole before breakfast', find(v2, 'Pantoprazole')?.timing === 'before breakfast');
check('Amlodipine increase is a change to 10 mg', find(v3, 'Amlodipine')?.action === 'change' && find(v3, 'Amlodipine')?.dose === '10 mg', JSON.stringify(find(v3, 'Amlodipine')));
check('Aspirin continue', find(v3, 'Aspirin')?.action === 'continue');
check('Atorvastatin stop', find(v3, 'Atorvastatin')?.action === 'stop');
check('Metformin 500 mg twice daily after food', find(v3, 'Metformin')?.dose === '500 mg' && find(v3, 'Metformin')?.freq === 'twice daily' && find(v3, 'Metformin')?.timing === 'after food', JSON.stringify(find(v3, 'Metformin')));
check('brand names map to the generic (Dolo -> Paracetamol)', extractMed('Take Dolo 650 mg if the fever is high')?.name === 'Paracetamol');
check('a sentence without a medicine yields nothing', extractMed('Walk for thirty minutes every day.') === null);

process.exit(failed ? 1 : 0);
