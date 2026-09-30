import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';

import { Button, Chip, Eyebrow, Field, Icon, Row, Sheet, Sub, T } from '@/ui/kit';
import { radius, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

import { DEMO_VISITS, DOCTORS, visitTs, type DemoVisit, type DoctorProfile } from './data';
import { extractMed, saveVisit, visitExists, type SaveSummary, type Stage, type VisitInput, type VisitSource } from './engine';

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

/**
 * Mock: a live recording. Runs until the user taps Stop, like leaving the phone on record in the consultation.
 * The waveform and the timer are live; the transcript streams in word by word from a demo visit, standing in
 * for on-device Whisper. Whatever was transcribed by the time of Stop is what gets saved.
 */
function Recorder({ demo, onStop }: { demo: DemoVisit; onStop: (transcript: string) => void }) {
  const t = useTheme();
  const words = useRef(demo.transcript.split(/(s+)/)).current;
  const [n, setN] = useState(0);
  const [secs, setSecs] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [bars, setBars] = useState<number[]>(Array(28).fill(6));
  const speaking = n < words.length;

  useEffect(() => {
    if (stopped) return;
    const clock = setInterval(() => setSecs((x) => x + 1), 1000);
    const b = setInterval(() => setBars((prev) => prev.map(() => (speaking ? 6 + Math.random() * 38 : 4 + Math.random() * 6))), 110);
    const w = setInterval(() => setN((x) => Math.min(words.length, x + 1)), 130);
    return () => {
      clearInterval(clock);
      clearInterval(b);
      clearInterval(w);
    };
  }, [stopped, speaking, words.length]);

  const transcript = words.slice(0, n).join('').trim();
  const stop = () => {
    setStopped(true);
    onStop(transcript);
  };

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
      <Eyebrow>Live transcript · on-device</Eyebrow>
      <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, maxHeight: 180 }}>
        <T size={12} style={{ lineHeight: 18 }}>{transcript || 'Listening…'}</T>
      </View>
      {stopped ? null : <Button title="Stop recording" kind="soft" onPress={stop} />}
    </View>
  );
}

/** The recognised text of a demo prescription: the doctor's lines, without the speaker label. */
const prescriptionLines = (demo: DemoVisit) =>
  demo.transcript
    .split('\n')
    .filter((l) => l.startsWith('Doctor:'))
    .map((l) => l.replace('Doctor: ', ''));

/** Four peach corner brackets, the universal "line it up in here" camera cue. */
function Brackets() {
  const t = useTheme();
  const c = { position: 'absolute' as const, width: 34, height: 34, borderColor: t.primary, borderWidth: 4 };
  return (
    <>
      <View style={[c, { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 }]} />
      <View style={[c, { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 }]} />
      <View style={[c, { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 12 }]} />
      <View style={[c, { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 12 }]} />
    </>
  );
}

/** Step 1 of scanning: a camera viewfinder with a paper in frame. Capturing is simulated. */
function ScanFrame({ onCapture, onSample }: { onCapture: () => void; onSample: () => void }) {
  const t = useTheme();
  const bar = (w: string, h = 7) => <View style={{ width: w as `${number}%`, height: h, borderRadius: 3, backgroundColor: 'rgba(43,18,8,0.14)' }} />;
  return (
    <View style={{ gap: space.m }}>
      <View style={{ height: 250, borderRadius: radius.l, backgroundColor: t.dark, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <View style={{ width: '58%', height: '76%', backgroundColor: '#FFFDF6', borderRadius: 6, padding: space.m, gap: 9, transform: [{ rotate: '-2deg' }] }}>
          {bar('55%', 9)}
          {bar('38%')}
          <View style={{ height: 1, backgroundColor: t.border, marginVertical: 2 }} />
          {bar('90%')}
          {bar('78%')}
          {bar('84%')}
          {bar('60%')}
          {bar('72%')}
        </View>
        <Brackets />
      </View>
      <Sub style={{ textAlign: 'center' }}>Fit the whole prescription inside the frame, in good light, then capture.</Sub>
      <Button title="Capture photo" onPress={onCapture} />
      <Button title="Use another sample prescription" kind="ghost" onPress={onSample} />
    </View>
  );
}

/** Step 2: the captured prescription with a scan line sweeping over it while its lines are read one by one. */
function Scanner({ demo, onDone }: { demo: DemoVisit; onDone: () => void }) {
  const t = useTheme();
  const lines = prescriptionLines(demo);
  const [shown, setShown] = useState(0);
  const [h, setH] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  useEffect(() => {
    if (shown >= lines.length) {
      const id = setTimeout(onDone, 350);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setShown((s) => s + 1), 320);
    return () => clearTimeout(id);
  }, [shown, lines.length, onDone]);

  return (
    <View style={{ gap: space.s }}>
      <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={{ backgroundColor: '#FFFDF6', borderRadius: radius.m, borderWidth: 1, borderColor: t.borderStrong, padding: space.m, gap: 4, overflow: 'hidden' }}>
        <T weight="700" size={13}>{demo.doctor}</T>
        <T size={10} color="sub">{`${demo.specialty} · ${demo.clinic}`}</T>
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 4 }} />
        <T serif italic size={18}>Rx</T>
        {lines.map((l, i) => (
          <T key={i} size={11} style={{ color: i < shown ? t.text : t.faint, backgroundColor: i === shown ? t.primarySoft : 'transparent' }}>{`${i + 1}. ${l}`}</T>
        ))}
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: t.primary, opacity: 0.9, transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, h - 3)] }) }] }}
        />
      </View>
      <Sub style={{ textAlign: 'center' }}>{`Reading line ${Math.min(shown + 1, lines.length)} of ${lines.length}…`}</Sub>
    </View>
  );
}

const ACTION_LABEL = { start: 'New', change: 'Changed', stop: 'Stopped', continue: 'Continue' } as const;

/** Step 3: what the scan found, in plain terms, so the user can check it before it goes into memory. */
function ScanReview({ demo, onRetake }: { demo: DemoVisit; onRetake: () => void }) {
  const t = useTheme();
  const lines = prescriptionLines(demo);
  const meds = lines.map((l) => extractMed(l)).filter((m): m is NonNullable<typeof m> => !!m);
  const notes = lines.filter((l) => !extractMed(l)).length;
  return (
    <View style={{ gap: space.m }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T weight="700" size={15}>{demo.doctor}</T>
          <T size={12} color="sub">{`${demo.specialty} · ${demo.clinic}`}</T>
        </View>
        <Chip small tone="good" label={`${meds.length} ${meds.length === 1 ? 'medicine' : 'medicines'}`} />
      </Row>
      <View style={{ gap: space.s }}>
        {meds.map((m, i) => (
          <View key={i} style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus-circle" size={18} color={t.dark} />
            </View>
            <View style={{ flex: 1 }}>
              <T weight="700" size={14}>{[m.name, m.dose].filter(Boolean).join(' ')}</T>
              <T size={12} color="sub">{[m.freq, m.timing, m.durationDays ? `for ${m.durationDays} days` : ''].filter(Boolean).join(' · ') || 'As directed'}</T>
            </View>
            <Chip small label={ACTION_LABEL[m.action]} tone={m.action === 'stop' ? 'bad' : 'soft'} />
          </View>
        ))}
      </View>
      {notes ? <Sub>{`Also noted ${notes} ${notes === 1 ? 'instruction' : 'instructions'} such as diet, tests and follow-ups.`}</Sub> : null}
      <Button title="Retake photo" kind="ghost" onPress={onRetake} />
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
  const [demo, setDemo] = useState<DemoVisit>(DEMO_VISITS[0]);
  const [captured, setCaptured] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [detail, setDetail] = useState<string>();
  const [step, setStep] = useState<'details' | 'capture'>('details');
  const [scanStep, setScanStep] = useState<'frame' | 'reading' | 'review'>('frame');
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
  }, [mode, demo.id, step]);

  useEffect(() => {
    if (mode) {
      setStep('details');
      setScanStep('frame');
      setQuery('');
      setProfile(null);
      setManual({ specialty: '', clinic: '' });
      setReason('');
      setDemo(DEMO_VISITS[0]);
    }
  }, [mode]);

  // Recording a doctor (or scanning a prescription) picks the next demo visit that isn't in memory yet
  // (Mehta's first visit, then his follow-up).
  useEffect(() => {
    if (mode !== 'record' && mode !== 'scan') return;
    let live = true;
    (async () => {
      const suffix = mode === 'scan' ? 'prescription' : 'recording';
      const ids = mode === 'record' && profile ? profile.demoIds : DEMO_VISITS.map((d) => d.id);
      let pick = ids[ids.length - 1];
      for (const id of ids) {
        if (!(await visitExists(`${id}-${suffix}`))) {
          pick = id;
          break;
        }
      }
      if (live) setDemo(DEMO_VISITS.find((d) => d.id === pick)!);
    })();
    return () => {
      live = false;
    };
  }, [mode, profile]);

  const recordDoctor: VisitDoctor = profile
    ? { name: profile.name, specialty: profile.specialty, clinic: profile.clinic }
    : { name: query.trim(), specialty: manual.specialty.trim() || 'General', clinic: manual.clinic.trim() };

  const save = async () => {
    const source: VisitSource = mode === 'record' ? 'recording' : mode === 'scan' ? 'prescription' : 'typed';
    const v: VisitInput =
      mode === 'type'
        ? { id: `v-${Date.now()}`, doctor: typed.doctor.trim() || 'Doctor', specialty: 'General', clinic: '', ts: Date.now(), source, transcript: typed.text }
        : mode === 'record'
          ? { id: `${demo.id}-${source}`, doctor: recordDoctor.name, specialty: recordDoctor.specialty, clinic: recordDoctor.clinic, ts: Date.now(), source, transcript: (reason.trim() ? `Patient: I am here for ${reason.trim()}.\n` : '') + recorded }
          : { id: `${demo.id}-${source}`, doctor: demo.doctor, specialty: demo.specialty, clinic: demo.clinic, ts: visitTs(demo.daysAgo), source, transcript: demo.transcript };
    if (!v.transcript.trim()) return toast('Nothing to save yet', 'warn');
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

  const detailsStep = mode === 'record' && step === 'details';
  const scanTitle = { frame: 'Scan a prescription', reading: 'Reading your prescription', review: 'Check what we found' }[scanStep];
  const title = mode === 'record' ? (detailsStep ? 'Who was the visit with?' : 'Recording') : mode === 'scan' ? scanTitle : 'Type or paste notes';
  const showSave = !detailsStep && (mode !== 'scan' || scanStep === 'review');
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
          <Recorder key={`${demo.id}-${step}`} demo={demo} onStop={(text) => { setRecorded(text); setCaptured(true); }} />
        </>
      ) : mode === 'scan' ? (
        <>
          <MockBadge text="Prototype: the scan is simulated. Real build runs on-device OCR on the camera photo." />
          {scanStep === 'frame' ? (
            <ScanFrame
              onCapture={() => setScanStep('reading')}
              onSample={() => setDemo((d) => DEMO_VISITS[(DEMO_VISITS.findIndex((x) => x.id === d.id) + 1) % DEMO_VISITS.length])}
            />
          ) : scanStep === 'reading' ? (
            <Scanner key={demo.id} demo={demo} onDone={() => { setCaptured(true); setScanStep('review'); }} />
          ) : (
            <ScanReview demo={demo} onRetake={() => { setCaptured(false); setScanStep('frame'); }} />
          )}
        </>
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
