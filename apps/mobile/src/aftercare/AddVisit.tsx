import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, Eyebrow, Field, Icon, Row, Sheet, Sub, T } from '@/ui/kit';
import { radius, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

import { DEMO_VISITS, visitTs, type DemoVisit } from './data';
import { saveVisit, visitExists, type SaveSummary, type Stage, type VisitInput, type VisitSource } from './engine';

export type AddMode = 'record' | 'scan' | 'type' | null;

const STAGES: { key: Stage; label: string }[] = [
  { key: 'understanding', label: 'Understanding each sentence (MiniLM, on-device)' },
  { key: 'indexing', label: 'Indexing into Qdrant Edge memory' },
  { key: 'checking', label: 'Reconciling medicines & checking interactions' },
];

function DemoPicker({ value, onChange }: { value: DemoVisit; onChange: (d: DemoVisit) => void }) {
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      {DEMO_VISITS.map((d) => (
        <Chip key={d.id} small label={`${d.doctor.replace('Dr. ', '')} · ${d.daysAgo}d ago`} selected={d.id === value.id} onPress={() => onChange(d)} />
      ))}
    </Row>
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

/** Mock: animated waveform + a transcript that streams in word by word, standing in for on-device Whisper. */
function Recorder({ demo, onDone }: { demo: DemoVisit; onDone: () => void }) {
  const t = useTheme();
  const words = useRef(demo.transcript.split(/(\s+)/)).current;
  const [n, setN] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(28).fill(6));
  const done = n >= words.length;

  useEffect(() => {
    if (done) {
      onDone();
      return;
    }
    const w = setInterval(() => setN((x) => Math.min(words.length, x + 2)), 45);
    const b = setInterval(() => setBars((prev) => prev.map(() => 6 + Math.random() * 38)), 110);
    return () => {
      clearInterval(w);
      clearInterval(b);
    };
  }, [done, onDone, words.length]);

  const secs = Math.round((n / words.length) * 612);
  return (
    <View style={{ gap: space.s }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: done ? t.faint : t.bad }} />
          <T mono weight="700" size={12}>{done ? 'RECORDING SAVED' : 'RECORDING'}</T>
        </Row>
        <T mono size={12} color="sub">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</T>
      </Row>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 48, gap: 3 }}>
        {bars.map((h, i) => (
          <View key={i} style={{ flex: 1, height: done ? 4 : h, borderRadius: 2, backgroundColor: i % 3 === 0 ? t.dark : t.primary }} />
        ))}
      </View>
      <Eyebrow>Live transcript · on-device</Eyebrow>
      <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, maxHeight: 180 }}>
        <T size={12} style={{ lineHeight: 18 }}>{words.slice(0, n).join('') || '…'}</T>
      </View>
    </View>
  );
}

/** Mock: a prescription "photo" with a scan line; the recognised lines are the demo visit's doctor lines. */
function Scanner({ demo, onDone }: { demo: DemoVisit; onDone: () => void }) {
  const t = useTheme();
  const lines = demo.transcript
    .split('\n')
    .filter((l) => l.startsWith('Doctor:'))
    .map((l) => l.replace('Doctor: ', ''));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= lines.length) {
      onDone();
      return;
    }
    const id = setTimeout(() => setShown((s) => s + 1), 280);
    return () => clearTimeout(id);
  }, [shown, lines.length, onDone]);

  return (
    <View style={{ gap: space.s }}>
      <View style={{ backgroundColor: '#FFFDF6', borderRadius: radius.m, borderWidth: 1, borderColor: t.borderStrong, padding: space.m, gap: 4 }}>
        <T weight="700" size={13}>{demo.doctor}</T>
        <T size={10} color="sub">{`${demo.specialty} · ${demo.clinic}`}</T>
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 4 }} />
        <T serif italic size={18}>Rx</T>
        {lines.map((l, i) => (
          <T key={i} size={11} style={{ color: i < shown ? t.text : t.faint, backgroundColor: i === shown ? t.warnSoft : 'transparent' }}>{`${i + 1}. ${l}`}</T>
        ))}
      </View>
      <Sub>{shown >= lines.length ? `Recognised ${lines.length} lines on-device` : `Reading line ${shown + 1} of ${lines.length}…`}</Sub>
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
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [detail, setDetail] = useState<string>();
  const [typed, setTyped] = useState({ doctor: '', text: '' });

  useEffect(() => {
    setCaptured(false);
    setRunning(false);
    setStage(null);
  }, [mode, demo.id]);

  const save = async () => {
    const source: VisitSource = mode === 'record' ? 'recording' : mode === 'scan' ? 'prescription' : 'typed';
    const v: VisitInput =
      mode === 'type'
        ? { id: `v-${Date.now()}`, doctor: typed.doctor.trim() || 'Doctor', specialty: 'General', clinic: '', ts: Date.now(), source, transcript: typed.text }
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

  const title = mode === 'record' ? 'Record a visit' : mode === 'scan' ? 'Scan a prescription' : 'Type or paste notes';
  return (
    <Sheet visible={!!mode} title={title} onClose={running ? () => undefined : onClose}>
      {mode !== 'type' ? (
        <>
          <Eyebrow>Which visit?</Eyebrow>
          <DemoPicker value={demo} onChange={setDemo} />
          {mode === 'record' ? (
            <MockBadge text="Prototype: speech-to-text is simulated from a recorded demo visit. Real build runs Whisper on the phone; audio never leaves it." />
          ) : (
            <MockBadge text="Prototype: the scan is simulated. Real build runs on-device OCR on the camera photo." />
          )}
          {mode === 'record' ? <Recorder key={demo.id} demo={demo} onDone={() => setCaptured(true)} /> : <Scanner key={demo.id} demo={demo} onDone={() => setCaptured(true)} />}
        </>
      ) : (
        <>
          <Field label="Doctor" placeholder="Dr. …" value={typed.doctor} onChangeText={(doctor) => setTyped((x) => ({ ...x, doctor }))} />
          <Field label="What did the doctor say?" placeholder="Doctor: Take Paracetamol 500 mg twice daily for three days." value={typed.text} onChangeText={(text) => setTyped((x) => ({ ...x, text }))} multiline />
        </>
      )}

      {running || stage ? <Progress stage={stage} detail={detail} /> : null}
      <Button title={running ? 'Working on-device…' : 'Save to memory'} busy={running} disabled={mode !== 'type' && !captured} onPress={save} />
    </Sheet>
  );
}
