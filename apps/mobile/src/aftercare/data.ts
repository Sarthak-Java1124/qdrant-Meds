const DAY = 86_400_000;

export interface DemoVisit {
  id: string;
  doctor: string;
  specialty: string;
  clinic: string;
  daysAgo: number;
  /** One line per utterance, "Doctor: …" / "Patient: …". Stands in for the on-device speech-to-text output. */
  transcript: string;
}

export const DEMO_VISITS: DemoVisit[] = [
  {
    id: 'demo-mehta-1',
    doctor: 'Dr. Anil Mehta',
    specialty: 'Cardiologist',
    clinic: 'Apollo Clinic, Indiranagar',
    daysAgo: 16,
    transcript: [
      'Doctor: Your blood pressure is 150 over 95, that is on the higher side.',
      'Patient: I sometimes feel dizzy in the morning.',
      'Doctor: That can happen, sit for a minute before you stand up.',
      'Doctor: I am starting Amlodipine 5 mg once daily in the morning, it is the small white tablet.',
      'Doctor: Also take Aspirin 75 mg once daily after breakfast to protect the heart.',
      'Doctor: Take Atorvastatin 10 mg at night for your cholesterol.',
      'Doctor: Avoid extra salt, pickles and papad completely.',
      'Doctor: Walk for thirty minutes every day.',
      'Doctor: Get an ECG and a lipid profile test done before the next visit.',
      'Doctor: If you feel chest pain or breathlessness, go to the emergency immediately.',
      'Doctor: Come back for a follow up in two weeks.',
    ].join('\n'),
  },
  {
    id: 'demo-rao-1',
    doctor: 'Dr. Sneha Rao',
    specialty: 'Orthopaedic',
    clinic: 'Sakra Hospital, Bellandur',
    daysAgo: 3,
    transcript: [
      'Doctor: Your knee X-ray shows mild osteoarthritis.',
      'Doctor: Take Ibuprofen 400 mg twice daily after food for five days for the pain.',
      'Doctor: Take Pantoprazole 40 mg once daily before breakfast to protect your stomach.',
      'Patient: I am also taking some heart medicines.',
      'Doctor: Okay, continue those as they are.',
      'Doctor: Apply a hot compress for fifteen minutes in the evening.',
      'Doctor: Avoid climbing stairs and sitting cross legged on the floor.',
      'Doctor: Start physiotherapy, three sessions a week.',
      'Doctor: Review after one month.',
    ].join('\n'),
  },
  {
    id: 'demo-mehta-2',
    doctor: 'Dr. Anil Mehta',
    specialty: 'Cardiologist',
    clinic: 'Apollo Clinic, Indiranagar',
    daysAgo: 1,
    transcript: [
      'Doctor: Your BP is 138 over 88 now, better but not at target yet.',
      'Doctor: Increase Amlodipine to 10 mg once daily in the morning.',
      'Doctor: Continue Aspirin 75 mg once daily after breakfast.',
      'Doctor: Your cholesterol report is fine, stop Atorvastatin.',
      'Doctor: Your sugar is borderline, start Metformin 500 mg twice daily after meals, it is the blue tablet.',
      'Doctor: Reduce sugar and rice at dinner.',
      'Doctor: Repeat the HbA1c test after three months.',
      'Doctor: Next visit after one month.',
    ].join('\n'),
  },
];

export interface DoctorProfile {
  id: string;
  name: string;
  specialty: string;
  clinic: string;
  qualifications: string;
  experience: string;
  rating: string;
  reviews: number;
  about: string;
  /** Mock Practo-style listing; a real build would look the doctor up in a directory. */
  profileUrl: string;
  /** Demo visits this doctor can be "recorded" for. */
  demoIds: string[];
}

export const DOCTORS: DoctorProfile[] = [
  {
    id: 'dr-mehta',
    name: 'Dr. Anil Mehta',
    specialty: 'Cardiologist',
    clinic: 'Apollo Clinic, Indiranagar',
    qualifications: 'MBBS, MD, DM (Cardiology)',
    experience: '18 yrs experience',
    rating: '4.8',
    reviews: 1240,
    about: 'Hypertension, cholesterol and preventive heart care.',
    profileUrl: 'practo.com/bangalore/doctor/anil-mehta',
    demoIds: ['demo-mehta-1', 'demo-mehta-2'],
  },
  {
    id: 'dr-rao',
    name: 'Dr. Sneha Rao',
    specialty: 'Orthopaedic',
    clinic: 'Sakra Hospital, Bellandur',
    qualifications: 'MBBS, MS (Orthopaedics)',
    experience: '11 yrs experience',
    rating: '4.6',
    reviews: 692,
    about: 'Knee and joint pain, arthritis and physiotherapy plans.',
    profileUrl: 'practo.com/bangalore/doctor/sneha-rao',
    demoIds: ['demo-rao-1'],
  },
];

export const visitTs = (daysAgo: number) => Date.now() - daysAgo * DAY;

export interface Drug {
  name: string;
  aliases: string[];
  purpose: string;
}

export const DRUGS: Drug[] = [
  { name: 'Aspirin', aliases: ['aspirin', 'ecosprin'], purpose: 'Heart protection' },
  { name: 'Ibuprofen', aliases: ['ibuprofen', 'brufen', 'combiflam'], purpose: 'Pain relief' },
  { name: 'Amlodipine', aliases: ['amlodipine', 'amlong'], purpose: 'Blood pressure' },
  { name: 'Atorvastatin', aliases: ['atorvastatin', 'atorva'], purpose: 'Cholesterol' },
  { name: 'Metformin', aliases: ['metformin', 'glycomet'], purpose: 'Blood sugar' },
  { name: 'Pantoprazole', aliases: ['pantoprazole', 'pan 40', 'pantocid'], purpose: 'Acidity' },
  { name: 'Paracetamol', aliases: ['paracetamol', 'dolo', 'crocin', 'calpol'], purpose: 'Fever / pain' },
  { name: 'Warfarin', aliases: ['warfarin'], purpose: 'Blood thinner' },
  { name: 'Clopidogrel', aliases: ['clopidogrel', 'clopilet'], purpose: 'Blood thinner' },
  { name: 'Telmisartan', aliases: ['telmisartan', 'telma'], purpose: 'Blood pressure' },
  { name: 'Losartan', aliases: ['losartan'], purpose: 'Blood pressure' },
  { name: 'Omeprazole', aliases: ['omeprazole', 'omez'], purpose: 'Acidity' },
  { name: 'Azithromycin', aliases: ['azithromycin', 'azithral'], purpose: 'Antibiotic' },
  { name: 'Levothyroxine', aliases: ['levothyroxine', 'thyronorm', 'eltroxin'], purpose: 'Thyroid' },
  { name: 'Cetirizine', aliases: ['cetirizine', 'cetzine'], purpose: 'Allergy' },
];

export interface Interaction {
  a: string;
  b: string;
  severity: 'high' | 'moderate';
  message: string;
}

/** A small on-device subset. The cloud database (mocked in the UI) is what a real build would sync down. */
export const INTERACTIONS: Interaction[] = [
  { a: 'Aspirin', b: 'Ibuprofen', severity: 'high', message: 'Ibuprofen can cancel Aspirin’s heart protection and raises the risk of stomach bleeding.' },
  { a: 'Ibuprofen', b: 'Amlodipine', severity: 'moderate', message: 'Pain killers like Ibuprofen can push blood pressure up and weaken Amlodipine.' },
  { a: 'Aspirin', b: 'Warfarin', severity: 'high', message: 'Two blood thinners together sharply raise bleeding risk.' },
  { a: 'Clopidogrel', b: 'Omeprazole', severity: 'moderate', message: 'Omeprazole can make Clopidogrel less effective.' },
  { a: 'Ibuprofen', b: 'Telmisartan', severity: 'moderate', message: 'Can reduce the BP effect and strain the kidneys.' },
  { a: 'Ibuprofen', b: 'Losartan', severity: 'moderate', message: 'Can reduce the BP effect and strain the kidneys.' },
  { a: 'Atorvastatin', b: 'Azithromycin', severity: 'moderate', message: 'Raises the chance of muscle side effects.' },
  { a: 'Ibuprofen', b: 'Warfarin', severity: 'high', message: 'High bleeding risk.' },
];

export const CATEGORIES = ['medicine', 'diet', 'test', 'follow_up', 'warning', 'lifestyle', 'finding'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_EXEMPLARS: Record<Category, string[]> = {
  medicine: ['take this tablet twice a day', 'start this medicine from today', 'increase the dose of this tablet'],
  diet: ['avoid salt and oily food', 'reduce sugar and rice', 'drink more water every day'],
  test: ['get a blood test done', 'do an ECG before the next visit', 'repeat the X-ray'],
  follow_up: ['come back after two weeks', 'next visit after one month', 'review after ten days'],
  warning: ['if you feel chest pain go to the emergency', 'stop immediately if you get a rash', 'call me if the fever does not come down'],
  lifestyle: ['walk for thirty minutes daily', 'do physiotherapy three times a week', 'apply a hot compress in the evening'],
  finding: ['your blood pressure is high', 'the report shows mild arthritis', 'your sugar levels are normal'],
};

export const CATEGORY_LABEL: Record<Category, string> = {
  medicine: 'Medicine',
  diet: 'Diet',
  test: 'Test',
  follow_up: 'Follow-up',
  warning: 'Warning',
  lifestyle: 'Lifestyle',
  finding: 'Finding',
};

/** Shown on the (mocked) family phone. */
export const FAMILY = { name: 'Priya', relation: 'Daughter', device: 'Pixel 8' };
