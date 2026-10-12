import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Chip, Eyebrow, Field, Icon, Row, Sheet, Sub, T } from '@/ui/kit';
import { radius, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

import { DOCTORS, DRUGS, type DoctorProfile } from './data';
import { medicineSentence } from './prescription';
import { ScanPrescription, type ConfirmedPrescription } from './ScanPrescription';
import { extractMed, findDrug, saveVisit, splitDoctorLines, splitTranscript, visitExists, type SaveSummary, type Stage, type VisitInput } from './engine';

export type AddMode = 'record' | 'scan' | 'type' | null;

const STAGES: { key: Stage; label: string }[] = [
  { key: 'understanding', label: 'Understanding each sentence (MiniLM, on-device)' },
  { key: 'indexing', label: 'Indexing into Qdrant Edge memory' },
  { key: 'checking', label: 'Reconciling medicines & checking interactions' },
];

interface VisitDoctor {
  name: string;
  specialty: string;
  clinic: string;
}

/** Step 1 of recording: pick the doctor (Practo-style profile), then add a little context before the mic starts. */
function DoctorStep({ query, onQuery, profile, onProfile, manual, onManual, reason, onReason }: {
  query: string;
  onQuery: (q: string) => void;
  profile: DoctorProfile | null;
  onProfile: (p: DoctorProfile | null) => void;
  manual: { specialty: string; clinic: string };
  onManual: (m: { specialty: string; clinic: string }) => void;
  reason: string;
  onReason: (r: string) => void;
}) {
  const t = useTheme();
  const q = query.trim().toLowerCase();
  const matches = DOCTORS.filter((d) => !q || d.name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q) || d.clinic.toLowerCase().includes(q));
  return (
    <View style={{ gap: space.m }}>
      <Field
        label="Doctor"
        placeholder="Search a doctor, or type a name"
        value={query}
        onChangeText={(v) => {
          onQuery(v);
          if (profile && v !== profile.name) onProfile(null);
        }}
      />
      {!profile ? (
        <View style={{ gap: space.s }}>
          <Eyebrow>{matches.length ? 'Doctor profiles' : 'Not listed, add the details below'}</Eyebrow>
          {matches.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => {
                onProfile(d);
                onQuery(d.name);
              }}>
              <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'center', backgroundColor: t.input, borderRadius: radius.m, padding: space.m }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="user" size={20} color={t.dark} />
                </View>
                <View style={{ flex: 1 }}>
                  <T weight="700" size={14}>{d.name}</T>
                  <T size={12} color="sub">{`${d.specialty} · ${d.clinic}`}</T>
                  <T size={11} color="faint">{`★ ${d.rating} (${d.reviews}) · ${d.experience}`}</T>
                </View>
                <Icon name="chevron-right" size={18} color={t.faint} />
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700" size={15}>{profile.name}</T>
            <Chip small label={`★ ${profile.rating}`} tone="good" />
          </Row>
          <T size={12} color="sub">{`${profile.specialty} · ${profile.qualifications}`}</T>
          <T size={12} color="sub">{`${profile.clinic} · ${profile.experience}`}</T>
          <T size={12} style={{ marginTop: 4 }}>{profile.about}</T>
          <Row style={{ marginTop: 4 }}>
            <Icon name="external-link" size={12} color={t.primary} />
            <T size={11} color="primary">{profile.profileUrl}</T>
          </Row>
        </View>
      )}
      {!profile && query.trim() ? (
        <>
          <Field label="Speciality" placeholder="e.g. Dermatologist" value={manual.specialty} onChangeText={(specialty) => onManual({ ...manual, specialty })} />
          <Field label="Clinic / hospital" placeholder="e.g. Manipal Hospital" value={manual.clinic} onChangeText={(clinic) => onManual({ ...manual, clinic })} />
        </>
      ) : null}
      <Field label="Reason for visit (optional)" placeholder="e.g. High BP, knee pain, routine check-up" value={reason} onChangeText={onReason} />
    </View>
  );
}

function MockBadge({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: t.warnSoft, borderRadius: radius.m, padding: space.s }}>
      <Icon name="info" size={13} color={t.warn} />
      <T size={11} color="warn" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

const BAR_COUNT = 28;
/** Speech-recognizer errors that just mean "nothing heard yet": the session ends and we start the next one. */
const QUIET_ERRORS = new Set(['no-speech', 'speech-timeout', 'aborted']);
/** Errors where trying again cannot help (no permission, no recognizer, no mic). The user can still type. */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
const DRUG_HINTS = DRUGS.flatMap((d) => [d.name, ...d.aliases]);

/**
 * A live recording. The phone's own speech recognizer (on-device when the phone supports it) turns the
 * conversation into text as it is spoken. Audio is never stored or uploaded; only the text is kept. The
 * recognizer is restarted whenever the OS ends a session on a pause, so a long consultation keeps going.
 * After Stop the transcript becomes editable, so a misheard drug name can be fixed before it is saved.
 */
function Recorder({ onStop, onEdit }: { onStop: (transcript: string) => void; onEdit: (transcript: string) => void }) {
  const t = useTheme();
  const [secs, setSecs] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [typeOnly, setTypeOnly] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const [finals, setFinals] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(4));
  const finalsRef = useRef<string[]>([]);
  const stopRequested = useRef(false);
  const finished = useRef(false);
  const onDevice = useRef(true);
  const [offline, setOffline] = useState(true);

  const begin = () =>
    ExpoSpeechRecognitionModule.start({
      lang: 'en-IN',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: onDevice.current,
      addsPunctuation: true,
      contextualStrings: DRUG_HINTS,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 110 },
    });

  useEffect(() => {
    let live = true;
    (async () => {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!live) return;
      if (!perm.granted) {
        setProblem('Microphone or speech permission is off. Turn it on in Settings, or type what the doctor said below.');
        setTypeOnly(true);
        setStopped(true);
        return;
      }
      onDevice.current = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      setOffline(onDevice.current);
      if (!onDevice.current) setProblem('This phone cannot transcribe offline, so the system speech service may be used for this recording.');
      begin();
    })();
    return () => {
      live = false;
      stopRequested.current = true;
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [stopped]);

  useSpeechRecognitionEvent('result', (e) => {
    const heard = e.results[0]?.transcript?.trim() ?? '';
    if (!e.isFinal) return setPartial(heard);
    setPartial('');
    if (heard) {
      finalsRef.current = [...finalsRef.current, heard];
      setFinals(finalsRef.current);
    }
  });

  useSpeechRecognitionEvent('volumechange', (e) => {
    const level = Math.min(1, Math.max(0, (e.value + 2) / 12));
    setBars((prev) => [...prev.slice(1), 4 + level * 40]);
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (QUIET_ERRORS.has(e.error)) return;
    if (FATAL_ERRORS.has(e.error)) {
      stopRequested.current = true;
      setProblem(`Could not listen (${e.error}). You can type what the doctor said below.`);
      setTypeOnly(true);
      setStopped(true);
      return;
    }
    setProblem(`Speech recognizer: ${e.message || e.error}`);
  });

  useSpeechRecognitionEvent('end', () => {
    if (finished.current) return;
    if (!stopRequested.current) {
      // the OS closes a session after a long pause; carry on listening
      setTimeout(() => {
        if (!stopRequested.current) begin();
      }, 400);
      return;
    }
    finished.current = true;
    const { doctor, leftOut: aside } = splitDoctorLines(finalsRef.current.join('\n'));
    setText(doctor);
    setLeftOut(aside);
    setPartial('');
    setStopped(true);
    onStop(doctor);
  });

  const stop = () => {
    stopRequested.current = true;
    setStopping(true);
    ExpoSpeechRecognitionModule.stop();
  };

  const edit = (v: string) => {
    setText(v);
    onEdit(v);
  };

  const putBack = (i: number) => {
    edit(`${text}${text ? '\n' : ''}${leftOut[i]}`);
    setLeftOut((rows) => rows.filter((_, j) => j !== i));
  };
  const live = finals.join(' ') + (partial ? ` ${partial}` : '');
  const meds = stopped ? splitTranscript(text).filter((x) => x.speaker === 'Doctor' && extractMed(x.text)).length : 0;

  return (
    <View style={{ gap: space.s }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: stopped ? t.faint : t.bad }} />
          <T mono weight="700" size={12}>{stopped ? 'RECORDING SAVED' : 'RECORDING'}</T>
        </Row>
        <T mono size={12} color="sub">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</T>
      </Row>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 48, gap: 3 }}>
        {bars.map((h, i) => (
          <View key={i} style={{ flex: 1, height: stopped ? 4 : h, borderRadius: 2, backgroundColor: i % 3 === 0 ? t.dark : t.primary }} />
        ))}
      </View>
      {problem ? <MockBadge text={problem} /> : null}
      {stopped && (finals.length > 0 || typeOnly) ? (
        <>
          <Field label="Check the transcript. Fix any misheard medicine names." value={text} onChangeText={edit} multiline />
          <Chip small tone={meds ? 'good' : 'soft'} label={`${meds} ${meds === 1 ? 'medicine' : 'medicines'} found`} />
          {leftOut.length ? (
            <View style={{ gap: space.s }}>
              <Eyebrow>Left out · sounded like the patient</Eyebrow>
              {leftOut.map((line, i) => {
                const drug = findDrug(line);
                return (
                  <Row key={`${i}-${line}`} style={{ justifyContent: 'space-between', gap: space.s }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T size={12} color="sub">{line}</T>
                      {drug ? <Chip small tone="warn" label={`mentions ${drug.name}`} /> : null}
                    </View>
                    <Chip small label="Put back" onPress={() => putBack(i)} />
                  </Row>
                );
              })}
            </View>
          ) : null}
        </>
      ) : stopped ? null : (
        <>
          <Eyebrow>{`Live transcript · ${offline ? 'on-device' : 'system speech service'}`}</Eyebrow>
          <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, maxHeight: 180 }}>
            <T size={12} style={{ lineHeight: 18 }}>{live || 'Listening…'}</T>
          </View>
        </>
      )}
      {stopped ? null : <Button title={stopping ? 'Finishing…' : 'Stop recording'} kind="soft" disabled={stopping} onPress={stop} />}
    </View>
  );
}

function Progress({ stage, detail }: { stage: Stage | null; detail?: string }) {
  const t = useTheme();
  const idx = stage ? (stage === 'done' ? STAGES.length : STAGES.findIndex((s) => s.key === stage)) : -1;
  return (
    <View style={{ gap: 8 }}>
      {STAGES.map((s, i) => (
        <Row key={s.key}>
          <Icon name={i < idx ? 'check-circle' : i === idx ? 'loader' : 'circle'} size={15} color={i < idx ? t.good : i === idx ? t.dark : t.faint} />
          <T size={13} color={i <= idx ? 'text' : 'faint'} style={{ flex: 1 }}>{`${s.label}${i === idx && detail ? ` ${detail}` : ''}`}</T>
        </Row>
      ))}
    </View>
  );
}

export function AddVisitSheet({ mode, onClose, onSaved }: { mode: AddMode; onClose: () => void; onSaved: (s: SaveSummary, doctor: string) => void }) {
  const [captured, setCaptured] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [detail, setDetail] = useState<string>();
  const [step, setStep] = useState<'details' | 'capture'>('details');
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState<DoctorProfile | null>(null);
  const [manual, setManual] = useState({ specialty: '', clinic: '' });
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState({ doctor: '', text: '' });

  useEffect(() => {
    setCaptured(false);
    setRecorded('');
    setRunning(false);
    setStage(null);
  }, [mode, step]);

  useEffect(() => {
    if (mode) {
      setStep('details');
      setQuery('');
      setProfile(null);
      setManual({ specialty: '', clinic: '' });
      setReason('');
    }
  }, [mode]);

  const recordDoctor: VisitDoctor = profile
    ? { name: profile.name, specialty: profile.specialty, clinic: profile.clinic }
    : { name: query.trim(), specialty: manual.specialty.trim() || 'General', clinic: manual.clinic.trim() };

  /** Saves a visit through the on-device pipeline and shows its progress. */
  const commit = async (v: VisitInput) => {
    if (!v.transcript.trim() && !v.meds?.length) return toast('Nothing to save yet', 'warn');
    if (await visitExists(v.id)) return toast('That visit is already in your memory', 'warn');
    setRunning(true);
    try {
      const summary = await saveVisit(v, (s, d) => {
        setStage(s);
        setDetail(d);
      });
      onSaved(summary, v.doctor);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setRunning(false);
    }
  };

  const save = () =>
    commit(
      mode === 'type'
        ? { id: `v-${Date.now()}`, doctor: typed.doctor.trim() || 'Doctor', specialty: 'General', clinic: '', ts: Date.now(), source: 'typed', transcript: typed.text }
        : { id: `v-${Date.now()}`, doctor: recordDoctor.name, specialty: recordDoctor.specialty, clinic: recordDoctor.clinic, ts: Date.now(), source: 'recording', transcript: (reason.trim() ? `Patient: I am here for ${reason.trim()}.\n` : '') + recorded },
    );

  /** The scanned medicines go in as the user confirmed them; the other instructions go through as sentences. */
  const saveScan = (c: ConfirmedPrescription) =>
    commit({
      id: `v-${Date.now()}`,
      doctor: c.doctor,
      specialty: c.specialty,
      clinic: c.clinic,
      ts: c.ts,
      source: 'prescription',
      transcript: c.notes.join('\n'),
      meds: c.meds.map((m) => ({ med: m, sentence: medicineSentence(m) })),
    });

  const detailsStep = mode === 'record' && step === 'details';
  const title = mode === 'record' ? (detailsStep ? 'Who was the visit with?' : 'Recording') : mode === 'scan' ? 'Scan a prescription' : 'Type or paste notes';
  const showSave = !detailsStep && mode !== 'scan';
  return (
    <Sheet visible={!!mode} title={title} onClose={running ? () => undefined : onClose}>
      {detailsStep ? (
        <>
          <DoctorStep
            query={query}
            onQuery={setQuery}
            profile={profile}
            onProfile={setProfile}
            manual={manual}
            onManual={setManual}
            reason={reason}
            onReason={setReason}
          />
          <Button title="Start recording" disabled={!recordDoctor.name} onPress={() => setStep('capture')} />
        </>
      ) : mode === 'record' ? (
        <>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T weight="700" size={14}>{recordDoctor.name}</T>
              <T size={11} color="sub">{[recordDoctor.specialty, recordDoctor.clinic].filter(Boolean).join(' · ')}</T>
            </View>
            {running ? null : <Chip small label="Change" onPress={() => setStep('details')} />}
          </Row>
          {reason.trim() ? <Sub>{`Reason: ${reason.trim()}`}</Sub> : null}
          <Recorder
            key={step}
            onStop={(text) => { setRecorded(text); setCaptured(!!text.trim()); }}
            onEdit={(text) => { setRecorded(text); setCaptured(!!text.trim()); }}
          />
        </>
      ) : mode === 'scan' ? (
        <ScanPrescription busy={running} onConfirm={saveScan} />
      ) : (
        <>
          <Field label="Doctor" placeholder="Dr. …" value={typed.doctor} onChangeText={(doctor) => setTyped((x) => ({ ...x, doctor }))} />
          <Field label="What did the doctor say?" placeholder="Doctor: Take Paracetamol 500 mg twice daily for three days." value={typed.text} onChangeText={(text) => setTyped((x) => ({ ...x, text }))} multiline />
        </>
      )}

      {running || stage ? <Progress stage={stage} detail={detail} /> : null}
      {showSave ? <Button title={running ? 'Working on-device…' : 'Save to memory'} busy={running} disabled={mode !== 'type' && !captured} onPress={save} /> : null}
    </Sheet>
  );
}
