import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Chip, Eyebrow, Field, Icon, Row, Sub, T } from '@/ui/kit';
import { radius, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

import { ocrSupported, readPrescription, type Photo } from './ocr';
import { NOTE_LABEL, NOTE_ORDER, parsePrescription, tidyNotes, type Note, type ParsedPrescription, type RxMedicine } from './prescription';

/** What the user confirmed after checking the scan. */
export interface ConfirmedPrescription {
  doctor: string;
  specialty: string;
  clinic: string;
  ts: number;
  meds: RxMedicine[];
  notes: string[];
}

type Phase = 'capture' | 'reading' | 'review';

const ACTIONS = [
  ['start', 'New'],
  ['continue', 'Continue'],
  ['stop', 'Stopped'],
] as const;
const ACTION_LABEL: Record<string, string> = { start: 'New', continue: 'Continue', stop: 'Stopped', change: 'Changed' };

const DAY = 86_400_000;
const longDate = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const emptyMedicine = (): RxMedicine => ({ name: '', recognised: true, dose: '', freq: '', timing: '', durationDays: null, action: 'start', line: '' });

/** Four peach corner brackets, the universal "line it up in here" camera cue. */
function Brackets() {
  const t = useTheme();
  const c = { position: 'absolute' as const, width: 34, height: 34, borderColor: t.primary, borderWidth: 4 };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <View style={[c, { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 }]} />
      <View style={[c, { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 }]} />
      <View style={[c, { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 12 }]} />
      <View style={[c, { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 12 }]} />
    </View>
  );
}

function Notice({ text, tone = 'warn' }: { text: string; tone?: 'warn' | 'bad' }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: tone === 'bad' ? t.badSoft : t.warnSoft, borderRadius: radius.m, padding: space.s }}>
      <Icon name="info" size={13} color={tone === 'bad' ? t.bad : t.warn} />
      <T size={11} color={tone} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

/** A medicine card as in the demo: name and dose, how and when, and a chip. Tap to correct it. */
function MedicineCard({ med, open, onToggle, onChange, onRemove }: { med: RxMedicine; open: boolean; onToggle: () => void; onChange: (m: RxMedicine) => void; onRemove: () => void }) {
  const t = useTheme();
  const details = [med.freq, med.timing, med.durationDays ? `for ${med.durationDays} days` : ''].filter(Boolean).join(' · ');
  return (
    <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, gap: space.s, borderWidth: med.recognised ? 0 : 1, borderColor: t.warn }}>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: med.recognised ? t.primarySoft : t.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={med.recognised ? 'plus-circle' : 'help-circle'} size={18} color={med.recognised ? t.dark : t.warn} />
        </View>
        <View style={{ flex: 1 }}>
          <T weight="700" size={14}>{[med.name || 'New medicine', med.dose].filter(Boolean).join(' ')}</T>
          <T size={12} color="sub">{details || 'No schedule read. Tap to add.'}</T>
        </View>
        <Chip small label={med.recognised ? ACTION_LABEL[med.action] : 'Check name'} tone={!med.recognised ? 'warn' : med.action === 'stop' ? 'bad' : 'soft'} />
      </Pressable>
      {open ? (
        <View style={{ gap: space.s }}>
          <Field label="Medicine" placeholder="Name" value={med.name} onChangeText={(name) => onChange({ ...med, name, recognised: true })} />
          <Field label="Dose" placeholder="e.g. 5 mg" value={med.dose} onChangeText={(dose) => onChange({ ...med, dose })} />
          <Field label="How often" placeholder="e.g. twice daily" value={med.freq} onChangeText={(freq) => onChange({ ...med, freq })} />
          <Field label="When" placeholder="e.g. after food" value={med.timing} onChangeText={(timing) => onChange({ ...med, timing })} />
          <Field label="For how many days" placeholder="Leave empty if not stated" keyboardType="number-pad" value={med.durationDays ? String(med.durationDays) : ''} onChangeText={(v) => onChange({ ...med, durationDays: Number(v.replace(/\D/g, '')) || null })} />
          <Row>
            {ACTIONS.map(([action, label]) => (
              <Chip key={action} label={label} selected={med.action === action} onPress={() => onChange({ ...med, action })} />
            ))}
          </Row>
          <Button title="Remove this medicine" kind="danger" small onPress={onRemove} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Scan a prescription: frame it with the camera (or pick a photo), read it on the phone, check the cards, save.
 * The photo is deleted after reading; only the confirmed text is kept.
 */
export function ScanPrescription({ busy, onConfirm }: { busy: boolean; onConfirm: (c: ConfirmedPrescription) => void }) {
  const t = useTheme();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // simulators have no camera; `CameraView.isAvailableAsync` only exists on web, so ask the device instead
  const hasCamera = Device.isDevice;
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('capture');
  const [raw, setRaw] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedPrescription | null>(null);
  const [doctor, setDoctor] = useState({ name: '', specialty: '', clinic: '' });
  const [meds, setMeds] = useState<RxMedicine[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [unclear, setUnclear] = useState<string[]>([]);
  const [showUnclear, setShowUnclear] = useState(false);
  const [editDoctor, setEditDoctor] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [useToday, setUseToday] = useState(false);
  const [now, setNow] = useState(0);

  const read = async (photo: Photo) => {
    setPhase('reading');
    try {
      const lines = await readPrescription(photo);
      const result = parsePrescription(lines);
      setRaw(lines);
      setParsed(result);
      setDoctor({ name: result.header.doctor, specialty: result.header.specialty, clinic: result.header.clinic });
      setMeds(result.medicines);
      const tidy = tidyNotes(result.notes);
      setNotes(tidy.notes);
      setUnclear(tidy.unclear);
      setShowUnclear(false);
      setEditDoctor(!result.header.doctor);
      setOpen(null);
      setShowRaw(false);
      setUseToday(false);
      setNow(Date.now());
      setPhase('review');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that photo', 'bad');
      setPhase('capture');
    }
  };

  const capture = async () => {
    try {
      const pic = await camera.current?.takePictureAsync({ quality: 0.9 });
      if (pic) await read({ uri: pic.uri, width: pic.width, height: pic.height });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not take the photo', 'bad');
    }
  };

  const choose = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (asset) await read({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  if (!ocrSupported()) return <Notice tone="bad" text="This phone cannot read text from photos. Use “Type your notes” instead." />;

  if (phase === 'capture') {
    const live = permission?.granted && hasCamera;
    return (
      <View style={{ gap: space.m }}>
        <View style={{ height: 250, borderRadius: radius.l, backgroundColor: t.dark, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: space.l }}>
          {live ? (
            <>
              <CameraView ref={camera} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} facing="back" onCameraReady={() => setReady(true)} />
              <Brackets />
            </>
          ) : hasCamera === false ? (
            <T size={13} style={{ color: '#FFFDF6', textAlign: 'center' }}>There is no camera on this device. Choose a photo of the prescription instead.</T>
          ) : permission && !permission.granted ? (
            <View style={{ gap: space.s, alignItems: 'center' }}>
              <T size={13} style={{ color: '#FFFDF6', textAlign: 'center' }}>{permission.canAskAgain ? 'Allow the camera to photograph a prescription. The photo is read on this phone and deleted.' : 'The camera is turned off for this app. Turn it on in Settings, or choose a photo.'}</T>
              {permission.canAskAgain ? <Button title="Allow camera" kind="soft" small onPress={requestPermission} /> : null}
            </View>
          ) : (
            <ActivityIndicator color="#FFFDF6" />
          )}
        </View>
        <Sub style={{ textAlign: 'center' }}>Fit the whole prescription inside the frame, in good light, then capture.</Sub>
        {live ? <Button title="Capture photo" disabled={!ready} onPress={capture} /> : null}
        <Button title="Choose from photos" kind={live ? 'ghost' : 'primary'} onPress={choose} />
      </View>
    );
  }

  if (phase === 'reading' || !parsed) {
    return (
      <View style={{ alignItems: 'center', gap: space.m, paddingVertical: space.xl }}>
        <ActivityIndicator color={t.dark} />
        <Sub style={{ textAlign: 'center' }}>Reading your prescription on this phone…</Sub>
      </View>
    );
  }

  const paperDate = parsed.header.ts;
  const visitTs = !useToday && paperDate ? paperDate : now;
  // a short course that already ended by the date used is saved as finished, so say so
  const finished = meds.filter((m) => m.name.trim() && m.action !== 'stop' && m.durationDays && visitTs + m.durationDays * DAY < now).length;
  const unrecognised = meds.filter((m) => m.name.trim() && !m.recognised).length;
  const usable = meds.filter((m) => m.name.trim());
  const confirm = () =>
    onConfirm({
      doctor: doctor.name.trim() || 'Doctor',
      specialty: doctor.specialty.trim() || 'General',
      clinic: doctor.clinic.trim(),
      ts: visitTs,
      meds: usable,
      notes: notes.map((n) => `${n.text}.`),
    });

  return (
    <View style={{ gap: space.m }}>
      {parsed.quality.poor ? <Notice text="This photo was hard to read. Check every line against the paper, or retake it in better light." /> : null}
      {unrecognised ? <Notice text={`${unrecognised} ${unrecognised === 1 ? 'medicine was' : 'medicines were'} not recognised. Check the name${unrecognised === 1 ? '' : 's'} against the paper.`} /> : null}

      <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, gap: space.s }}>
        <Row style={{ justifyContent: 'space-between', gap: space.s }}>
          <View style={{ flex: 1 }}>
            <T weight="700" size={15}>{doctor.name || 'Doctor not found'}</T>
            <T size={12} color="sub">{[doctor.specialty, doctor.clinic].filter(Boolean).join(' · ') || 'Add speciality and clinic'}</T>
          </View>
          <Chip small label={editDoctor ? 'Done' : 'Edit'} onPress={() => setEditDoctor((v) => !v)} />
        </Row>
        {editDoctor ? (
          <View style={{ gap: space.s }}>
            <Field label="Doctor" placeholder="Dr. …" value={doctor.name} onChangeText={(name) => setDoctor((d) => ({ ...d, name }))} />
            <Field label="Speciality" placeholder="e.g. Cardiologist" value={doctor.specialty} onChangeText={(specialty) => setDoctor((d) => ({ ...d, specialty }))} />
            <Field label="Clinic / hospital" placeholder="e.g. Apollo Clinic" value={doctor.clinic} onChangeText={(clinic) => setDoctor((d) => ({ ...d, clinic }))} />
          </View>
        ) : null}
        <Row style={{ justifyContent: 'space-between', gap: space.s }}>
          <T size={12} color="sub" style={{ flex: 1 }}>{paperDate && !useToday ? `Dated ${longDate(paperDate)}` : paperDate ? `Using today's date (the paper says ${longDate(paperDate)})` : 'No date on the paper, so today is used'}</T>
          {paperDate ? <Chip small label={useToday ? 'Use paper date' : 'Use today'} onPress={() => setUseToday((v) => !v)} /> : null}
        </Row>
      </View>
      {finished ? <Notice text={`${finished} ${finished === 1 ? 'course on this prescription has' : 'courses on this prescription have'} already finished by this date, so ${finished === 1 ? 'it' : 'they'} will be saved as completed. If the date is wrong, use today's date.`} /> : null}

      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow>Medicines</Eyebrow>
        <Chip small tone={usable.length ? 'good' : 'soft'} label={`${usable.length} ${usable.length === 1 ? 'medicine' : 'medicines'}`} />
      </Row>
      {!meds.length ? (
        <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m }}>
          <T size={13} color="sub">{parsed.quality.poor ? 'No medicines could be read from this photo. Add them by hand if the prescription has any.' : 'No medicines found on this prescription.'}</T>
        </View>
      ) : null}
      <View style={{ gap: space.s }}>
        {meds.map((m, i) => (
          <MedicineCard
            key={i}
            med={m}
            open={open === i}
            onToggle={() => setOpen(open === i ? null : i)}
            onChange={(next) => setMeds((all) => all.map((x, j) => (j === i ? next : x)))}
            onRemove={() => {
              setMeds((all) => all.filter((_, j) => j !== i));
              setOpen(null);
            }}
          />
        ))}
      </View>
      <Button
        title="Add a medicine"
        kind={meds.length ? 'ghost' : 'soft'}
        onPress={() => {
          setMeds((all) => [...all, emptyMedicine()]);
          setOpen(meds.length);
        }}
      />

      {NOTE_ORDER.map((kind) => {
        const items = notes.map((n, index) => ({ n, index })).filter(({ n }) => n.kind === kind);
        if (!items.length) return null;
        return (
          <View key={kind} style={{ gap: space.s }}>
            <Eyebrow>{NOTE_LABEL[kind]}</Eyebrow>
            <View style={{ backgroundColor: t.input, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s, gap: space.s }}>
              {items.map(({ n, index }) => (
                <Row key={`${index}-${n.text}`} style={{ justifyContent: 'space-between', gap: space.s }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
                    <T size={13}>{n.text}</T>
                    {n.check ? <Chip small tone="warn" label="Check" /> : null}
                  </View>
                  <Pressable hitSlop={10} onPress={() => setNotes((all) => all.filter((_, j) => j !== index))}>
                    <Icon name="x" size={16} color={t.faint} />
                  </Pressable>
                </Row>
              ))}
            </View>
          </View>
        );
      })}

      {unclear.length ? (
        <View style={{ gap: space.s }}>
          <Pressable onPress={() => setShowUnclear((v) => !v)}>
            <Sub>{`${unclear.length} ${unclear.length === 1 ? 'line' : 'lines'} could not be read clearly and ${unclear.length === 1 ? 'was' : 'were'} left out. ${showUnclear ? 'Hide' : 'Review'}`}</Sub>
          </Pressable>
          {showUnclear
            ? unclear.map((line, i) => (
                <Row key={`${i}-${line}`} style={{ justifyContent: 'space-between', gap: space.s }}>
                  <T size={12} color="sub" style={{ flex: 1 }}>{line}</T>
                  <Chip
                    small
                    label="Keep"
                    onPress={() => {
                      setNotes((all) => [...all, { text: line, kind: 'other', check: true }]);
                      setUnclear((all) => all.filter((_, j) => j !== i));
                    }}
                  />
                </Row>
              ))
            : null}
        </View>
      ) : null}

      <Pressable onPress={() => setShowRaw((v) => !v)}>
        <Sub>{`${showRaw ? 'Hide' : 'Show'} what was read from the photo`}</Sub>
      </Pressable>
      {showRaw ? (
        <View style={{ backgroundColor: t.input, borderRadius: radius.m, padding: space.m, gap: 2 }}>
          {raw.map((l, i) => (
            <T key={i} mono size={11}>{l}</T>
          ))}
        </View>
      ) : null}

      <Button title="Save to memory" busy={busy} disabled={busy || (!usable.length && !notes.length)} onPress={confirm} />
      <Button title="Retake photo" kind="ghost" disabled={busy} onPress={() => setPhase('capture')} />
    </View>
  );
}
