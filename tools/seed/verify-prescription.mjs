// Offline checks for the prescription parser: lines as an OCR engine would return them, in, medicines and header out.
// Run: node tools/seed/verify-prescription.mjs
import { app, loadTs, mock } from './_load.mjs';

for (const m of ['@/core/embedder', '@/core/embedQueue', '@/core/groups', '@/core/ingest', '@/core/search', '@/core/shards', '@/privacy']) mock(m, {});
mock('@/ui/format', { fmtDate: (ts) => new Date(ts).toDateString() });

const { groupRows, parsePrescription, medicineSentence, tidyNotes } = loadTs(app('aftercare/prescription.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const NOW = new Date(2026, 5, 1, 10).getTime();
const brief = (m) => `${m.name}|${m.dose}|${m.freq}|${m.timing}|${m.durationDays ?? '-'}|${m.recognised ? 'known' : 'UNKNOWN'}`;

// ---- A: a clean printed prescription from a known doctor ----
const A = parsePrescription([
  'Dr. Anil Mehta, MBBS, MD, DM (Cardiology)',
  'Apollo Clinic, Indiranagar, Bengaluru',
  'Reg. No: KMC 45213   Ph: 080 4123 4567',
  'Date: 12/03/2026',
  'Patient Name: Ramesh Kumar',
  'Age/Sex: 58 / M',
  'Rx',
  '1) Tab. Amlodipine 5mg 1-0-0 x 30 days',
  '2) Tab. Aspirin 75 mg 0-1-0 after food x 30 days',
  '3) Tab. Atorvastatin 10mg 0-0-1 x 30 days',
  'Avoid salt and pickles',
  'Get ECG and lipid profile done',
  'Review after 2 weeks',
  'Signature',
], NOW);
check('A: doctor name, specialty and clinic come from the known profile', A.header.doctor === 'Dr. Anil Mehta' && A.header.specialty === 'Cardiologist' && A.header.clinic === 'Apollo Clinic, Indiranagar', JSON.stringify(A.header));
check('A: date 12/03/2026 is read as 12 March (day first)', new Date(A.header.ts).toDateString() === new Date(2026, 2, 12).toDateString());
check('A: three medicines', A.medicines.length === 3, A.medicines.map(brief).join(' ; '));
check('A: Amlodipine 5 mg once daily in the morning for 30 days', brief(A.medicines[0]) === 'Amlodipine|5 mg|once daily|in the morning|30|known', brief(A.medicines[0]));
check('A: Aspirin 75 mg once daily after food', brief(A.medicines[1]) === 'Aspirin|75 mg|once daily|after food|30|known', brief(A.medicines[1]));
check('A: Atorvastatin at night', brief(A.medicines[2]) === 'Atorvastatin|10 mg|at night||30|known', brief(A.medicines[2]));
check('A: instructions kept, patient and footer lines left out', A.notes.join(' | ') === 'Avoid salt and pickles | Get ECG and lipid profile done | Review after 2 weeks', A.notes.join(' | '));
check('A: good quality', !A.quality.poor);

// ---- B: OCR slips (O for zero, "rng" for mg, a typo in a drug name) and an unknown drug ----
const B = parsePrescription([
  'Dr Sneha Rao MS Ortho',
  'Sakra Hospital Bellandur',
  '12 Mar 2O26',
  'Rx',
  'Tab Ibuprofen 4OO rng BD af x 5 d',
  'Tab Pantoprazole 4Omg OD ac',
  'Cap Amlodlpine 5mg HS',
  'Tab Xyzolat 20 mg 1-0-1 x 7 days',
  'Apply hot compress',
], NOW);
check('B: known doctor found from "Dr Sneha Rao MS Ortho"', B.header.doctor === 'Dr. Sneha Rao' && B.header.specialty === 'Orthopaedic', JSON.stringify(B.header));
check('B: date "12 Mar 2O26" read as 12 March 2026', new Date(B.header.ts).toDateString() === new Date(2026, 2, 12).toDateString(), String(B.header.ts));
check('B: four medicines', B.medicines.length === 4, B.medicines.map(brief).join(' ; '));
check('B: Ibuprofen 4OO rng BD af x 5 d -> 400 mg twice daily after food 5 days', brief(B.medicines[0]) === 'Ibuprofen|400 mg|twice daily|after food|5|known', brief(B.medicines[0]));
check('B: Pantoprazole 4Omg OD ac -> 40 mg once daily before food', brief(B.medicines[1]) === 'Pantoprazole|40 mg|once daily|before food|-|known', brief(B.medicines[1]));
check('B: "Amlodlpine" typo still found, HS = at night', brief(B.medicines[2]) === 'Amlodipine|5 mg|at night||-|known', brief(B.medicines[2]));
check('B: unknown drug is kept and marked unrecognised, not dropped', brief(B.medicines[3]) === 'Xyzolat|20 mg|twice daily||7|UNKNOWN', brief(B.medicines[3]));
check('B: "Apply hot compress" is an instruction, not a medicine', B.notes.join('|') === 'Apply hot compress', B.notes.join('|'));

// ---- C: dose and schedule on separate lines (a wrapped layout) ----
const C = parsePrescription([
  'Dr. Priya Nair',
  'City Care Hospital',
  'Rx',
  'Tab. Metformin 500mg',
  '1-0-1 after food x 3 months',
  'Tab. Telmisartan 40 mg',
  '0-0-1 x 1 month',
  'Drink plenty of water',
], NOW);
check('C: unknown doctor still read; clinic from the header', C.header.doctor === 'Dr. Priya Nair' && C.header.clinic === 'City Care Hospital', JSON.stringify(C.header));
check('C: schedule lines join the medicine above', C.medicines.length === 2 && brief(C.medicines[0]) === 'Metformin|500 mg|twice daily|after food|90|known' && brief(C.medicines[1]) === 'Telmisartan|40 mg|at night||30|known', C.medicines.map(brief).join(' ; '));
check('C: no date on the paper leaves the date empty', C.header.ts === null);

// ---- D/E/F/G: edge cases ----
const D = parsePrescription(['l1l ~~ ;;', 'xx', '|||'], NOW);
check('D: noise is flagged as a poor read with no invented medicines', D.quality.poor && D.medicines.length === 0);
const E = parsePrescription(['Dr. Anil Mehta', 'Review after 2 weeks', 'Avoid oily food', 'Walk 30 minutes daily'], NOW);
check('E: instructions alone give no medicines and a poor-read flag', E.medicines.length === 0 && E.quality.poor && E.notes.length === 3, E.notes.join('|'));
const F = parsePrescription(['Dr. Anil Mehta', 'Rx', 'Xyzolat 20mg 1-0-1', 'Warfarin 5mg OD'], NOW);
check('F: a line with dose and schedule but no known drug is kept as unrecognised', brief(F.medicines[0]) === 'Xyzolat|20 mg|twice daily||-|UNKNOWN' && F.medicines[1].name === 'Warfarin', F.medicines.map(brief).join(' ; '));
const G = parsePrescription(['Dr. Anil Mehta', 'Rx', 'Tab Atorvastatin 10mg HS', 'Stop Tab Ibuprofen', 'Continue Tab Aspirin 75mg OD'], NOW);
check('G: stop and continue are understood', G.medicines.map((m) => m.action).join() === 'start,stop,continue', G.medicines.map((m) => m.action).join());

// ---- H: a real handwritten cardiology sheet, as Apple Vision returned it (patient row left out). No medicines on it. ----
const H = parsePrescription([
  'Dr. Neeraj Varyani', 'GRS Senior Consultant Interventional Cardiologist', 'G MBBS, MD (BHU), DM Cardiology (CMC, Ludhiana) Associate Fellowship in European Society of Cardiology (AFESC-EUROPE)',
  'HOSPITAL Fellowship of the Society for Cardiovascular Angiography', 'HEART CENTRE and Intervention (FSCAl-USA), Life member of CSI', '(MULTI SUPER SPECIALITY HOSPITAL) С 8604601010, 9780100724, 9260986008',
  'C/o Date 26/06126 Valid upto.. 7das', 'Ht yo walkin time Bethlone HTN,', 'tion', 'Wt 76 kg кісто - Виг он онА:', 'BMI Etho 27-1240 N SR + I BAB, +LPUB', "/ell's BP 190/70", 'HR Gob? Receined. Chen thraafy',
  'SPO2 99+ 202/', 'Nutrition', '• Admission Blood Transfusion', 'P/C/I/E R /Trop I / 2bE cha', 'Chest -Bu Wear • Ivan ProMe/IFTIPTIAR', '• Stool for occutt Blood', '+ 3 days', '-Diagnosis - Blood film', 'Cout',
  'Follow Up Meli', 'SPEP for M Band', 'NOT FOR MEDICOLEGAL PURPOSE', 'Timing : (Mon to Sat) 10.00 a.m. to 4.00 pm.', '111/326, ASHOK NAGAR, PHOOL MATI MATA (BEECH WALA MANDIR), KANPUR',
], new Date(2026, 5, 27).getTime());
check('H: doctor and specialty read from the printed letterhead', H.header.doctor === 'Dr. Neeraj Varyani' && H.header.specialty === 'Cardiologist', JSON.stringify(H.header));
check('H: "26/06126" (a slash read as 1) is repaired to 26 June 2026', new Date(H.header.ts).toDateString() === new Date(2026, 5, 26).toDateString(), String(H.header.ts));
check('H: no medicine is invented from handwriting noise', H.medicines.length === 0, H.medicines.map(brief).join(' ; '));
check('H: a poor read is flagged', H.quality.poor);
check('H: vitals, footer and address lines are not kept as instructions', !H.notes.some((n) => /BP|SPO2|MEDICOLEGAL|ASHOK|Timing|\d{10}/i.test(n)), H.notes.join(' | '));
check('H: no lone fragments kept', H.notes.every((n) => n.split(' ').length >= 2), H.notes.join(' | '));

// ---- tidy instruction lines: the raw lines from the real sheet ----
const T = tidyNotes(['27-1240 N SR + R BAB. +LPHB', 'Admission Blood Transfusion', 'Shol for occutt Blood', '+ 3 days', '-Diagnosis - Blood film', 'Meti Court .', 'SPEP for M Band']);
const texts = T.notes.map((n) => n.text);
check('tidy: misread words are corrected and a stray "+ 3 days" joins the line above', texts.includes('Stool for occult blood × 3 days'), texts.join(' | '));
check('tidy: bullets, trailing dots and the "Diagnosis" form label are stripped', texts.includes('Blood film') && texts.every((x) => !/^[-+•.]|[.]$|diagnosis/i.test(x)), texts.join(' | '));
check('tidy: casing is normalised, acronyms kept', texts.includes('SPEP for M band') && texts.includes('Admission blood transfusion'), texts.join(' | '));
check('tidy: lines are grouped by what they are', T.notes.find((n) => n.text === 'Admission blood transfusion')?.kind === 'hospital' && T.notes.find((n) => n.text === 'Blood film')?.kind === 'test');
check('tidy: a line the app cannot understand is set aside, not saved', T.unclear.length === 1 && T.unclear[0].startsWith('27-1240'), JSON.stringify(T.unclear));
check('tidy: a line with an unknown word is kept but marked "check"', T.notes.find((n) => /^Meti/.test(n.text))?.check === true && T.notes.find((n) => n.text === 'SPEP for M band')?.check === false);
const D2 = tidyNotes(['Avoid salt and pickles', 'Review after 2 weeks', 'Walk 30 minutes daily', 'If you feel chest pain go to the emergency', 'Get ECG and lipid profile done', 'Avoid salt and pickles']);
check('tidy: diet, follow-up, lifestyle, warning and test lines land in their groups, duplicates removed', D2.notes.map((n) => n.kind).join() === 'diet,follow_up,lifestyle,warning,test' && D2.unclear.length === 0, D2.notes.map((n) => `${n.kind}:${n.text}`).join(' | '));
check('tidy: clear typed instructions are not marked "check"', D2.notes.every((n) => !n.check), D2.notes.filter((n) => n.check).map((n) => n.text).join(' | '));

// ---- stored sentences ----
check('sentence: full medicine', medicineSentence({ name: 'Amlodipine', dose: '5 mg', freq: 'once daily', timing: 'after food', durationDays: 5, action: 'start' }) === 'Take Amlodipine 5 mg once daily after food for 5 days.');
check('sentence: stop drops the schedule', medicineSentence({ name: 'Ibuprofen', dose: '', freq: 'twice daily', timing: '', durationDays: 5, action: 'stop' }) === 'Stop Ibuprofen.');

// ---- table rows come back from OCR as separate pieces ----
const box = (text, x, y) => ({ text, x, y, width: 80, height: 30 });
const rows = groupRows([box('1-0-1', 600, 112), box('Tab Amlodipine 5mg', 100, 100), box('x 5 days', 760, 98), box('Review after 2 weeks', 100, 190), box('', 300, 100)]);
check('rows: pieces on one line are joined left to right, lines stay top to bottom', rows.length === 2 && rows[0] === 'Tab Amlodipine 5mg 1-0-1 x 5 days' && rows[1] === 'Review after 2 weeks', JSON.stringify(rows));
check('rows: a slightly tilted page still groups', groupRows([box('Tab Metformin', 100, 100), box('1-0-1', 500, 118)]).length === 1);
check('rows: nothing in, nothing out', groupRows([]).length === 0);

process.exit(failed ? 1 : 0);
