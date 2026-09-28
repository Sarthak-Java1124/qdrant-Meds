import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AddVisitSheet, type AddMode } from '@/aftercare/AddVisit';
import { CATEGORY_LABEL, type Category } from '@/aftercare/data';
import { listAlerts, listVisits, memoryStats, resetAftercare, warmCategories, type Alert, type SaveSummary, type VisitRow } from '@/aftercare/engine';
import { HeaderActions } from '@/ui/HeaderActions';
import { Button, Card, Chip, Icon, Row, Screen, SectionTitle, Sheet, Sub, T, type IconName } from '@/ui/kit';
import { fmtDate } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { glow, radius, raisedShadow, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

const SOURCE_LABEL = { recording: 'Recorded', prescription: 'Scanned', typed: 'Typed' } as const;
const CAT_TONE: Partial<Record<Category, 'good' | 'warn' | 'bad'>> = { medicine: 'good', warning: 'bad', test: 'warn', follow_up: 'warn' };
const AVATAR_TINTS = ['#EAFFD9', '#F0F0EC', '#C9FF99', '#E6E6E1'];

const initials = (name: string) =>
  name
    .replace(/^Dr\.?\s*/i, '')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

function Avatar({ name, size = 48, light }: { name: string; size?: number; light?: boolean }) {
  const t = useTheme();
  const tint = AVATAR_TINTS[name.length % AVATAR_TINTS.length];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: light ? t.primary : tint, alignItems: 'center', justifyContent: 'center' }}>
      <T weight="700" size={size * 0.34} style={{ color: t.dark }}>{initials(name)}</T>
    </View>
  );
}

type RoundTone = 'light' | 'onDark' | 'onYellow' | 'yellow';

function RoundIcon({ name, tone = 'light', size = 36 }: { name: IconName; tone?: RoundTone; size?: number }) {
  const t = useTheme();
  const c = {
    light: { bg: t.surfaceAlt, fg: t.dark },
    onDark: { bg: 'rgba(255,255,255,0.14)', fg: '#FFFFFF' },
    onYellow: { bg: 'rgba(0,0,0,0.08)', fg: t.dark },
    yellow: { bg: t.primary, fg: t.dark },
  }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.46} color={c.fg} />
    </View>
  );
}

/** One tile of the 2×2 "add a visit" grid, modelled on the mockup's visit-type cards. */
function ActionTile({ icon, title, hint, onPress, featured }: { icon: IconName; title: string; hint: string; onPress: () => void; featured?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[{ backgroundColor: featured ? t.primary : t.card, borderRadius: radius.l, padding: space.m, gap: space.l, minHeight: 132 }, featured ? glow : null]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <RoundIcon name={icon} tone={featured ? 'onYellow' : 'light'} />
          <RoundIcon name="arrow-up-right" tone={featured ? 'onYellow' : 'light'} size={30} />
        </Row>
        <View style={{ gap: 2 }}>
          <T weight="700" size={15} style={{ color: t.dark }}>{title}</T>
          <T size={11} style={{ color: featured ? 'rgba(0,0,0,0.6)' : t.sub }}>{hint}</T>
        </View>
      </View>
    </Pressable>
  );
}

function LatestVisitCard({ v, moments }: { v: VisitRow | undefined; moments: number }) {
  const t = useTheme();
  const meds = v?.facts.filter((f) => f.med).length ?? 0;
  return (
    <View style={[{ backgroundColor: t.dark, borderRadius: radius.xl, padding: space.l, gap: space.m, overflow: 'hidden' }, raisedShadow]}>
      <View pointerEvents="none" style={{ position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.05)', top: -80, right: -60 }} />
      {v ? (
        <>
          <Row style={{ gap: space.m }}>
            <Avatar name={v.doctor} light />
            <View style={{ flex: 1 }}>
              <T weight="700" size={17} style={{ color: '#fff' }}>{v.doctor}</T>
              <T size={12} style={{ color: 'rgba(255,255,255,0.75)' }}>{`${v.specialty}${v.clinic ? ` · ${v.clinic}` : ''}`}</T>
            </View>
            <RoundIcon name="arrow-up-right" tone="yellow" size={32} />
          </Row>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.m, padding: space.m, flexDirection: 'row', justifyContent: 'space-between' }}>
            {[
              { icon: 'calendar' as IconName, text: fmtDate(v.ts) },
              { icon: 'plus-square' as IconName, text: `${meds} medicine${meds === 1 ? '' : 's'}` },
              { icon: 'cpu' as IconName, text: `${moments} on-device` },
            ].map((x) => (
              <Row key={x.text} style={{ gap: 6 }}>
                <Icon name={x.icon} size={13} color="#fff" />
                <T size={12} weight="600" style={{ color: '#fff' }}>{x.text}</T>
              </Row>
            ))}
          </View>
        </>
      ) : (
        <View style={{ gap: 6 }}>
          <T weight="700" size={18} style={{ color: '#fff' }}>No visits yet</T>
          <T size={13} style={{ color: 'rgba(255,255,255,0.8)' }}>Record your next appointment. It is understood and stored on this phone, even with no internet.</T>
        </View>
      )}
    </View>
  );
}

function AlertCard({ a }: { a: Alert }) {
  const t = useTheme();
  const high = a.interaction.severity === 'high';
  return (
    <Pressable onPress={() => router.navigate('/meds')}>
      <View style={{ backgroundColor: t.card, borderRadius: radius.l, padding: space.m, gap: 6, borderLeftWidth: 4, borderLeftColor: high ? t.bad : t.warn }}>
        <Row>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: high ? t.badSoft : t.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="alert-triangle" size={15} color={high ? t.bad : t.warn} />
          </View>
          <T weight="700" style={{ flex: 1 }}>{`${a.medA.name} + ${a.medB.name}`}</T>
          <Chip small tone={high ? 'bad' : 'warn'} label={high ? 'High risk' : 'Check'} />
        </Row>
        <T size={12} color="sub">{a.interaction.message}</T>
        {a.crossDoctor ? <T size={11} weight="600" color={high ? 'bad' : 'warn'}>{`Prescribed by two doctors: ${a.medA.doctor} & ${a.medB.doctor}`}</T> : null}
      </View>
    </Pressable>
  );
}

function VisitCard({ v }: { v: VisitRow }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const meds = v.facts.filter((f) => f.med);
  const keyFacts = v.facts.filter((f) => !f.med && f.speaker === 'Doctor' && f.category !== 'finding');
  return (
    <Card onPress={() => setOpen((o) => !o)}>
      <Row style={{ gap: space.m }}>
        <Avatar name={v.doctor} />
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="700" size={16}>{v.doctor}</T>
          <Sub>{v.specialty}</Sub>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={{ backgroundColor: t.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <T size={11} weight="700" style={{ color: t.dark }}>{fmtDate(v.ts)}</T>
          </View>
          <T size={10} color="faint">{SOURCE_LABEL[v.source]}</T>
        </View>
      </Row>
      {meds.length ? (
        <View style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.m, padding: space.m, gap: 6 }}>
          {meds.map((f, i) => (
            <Row key={`m${i}`}>
              <Icon name="plus-circle" size={14} color={t.dark} />
              <T size={13} weight="600" style={{ flex: 1 }}>{`${f.med!.name} ${f.med!.dose}`}</T>
              <T size={12} color="sub">{f.med!.action === 'start' ? f.med!.freq : f.med!.action}</T>
            </Row>
          ))}
        </View>
      ) : null}
      <Row style={{ flexWrap: 'wrap' }}>
        {keyFacts.slice(0, open ? undefined : 3).map((f, i) => (
          <Chip key={`c${i}`} small tone={CAT_TONE[f.category] ?? 'soft'} label={CATEGORY_LABEL[f.category]} />
        ))}
        <T size={11} color="faint">{`${v.facts.length} moments · tap to ${open ? 'hide' : 'read'}`}</T>
      </Row>
      {open
        ? v.facts.map((f, i) => (
            <Row key={`f${i}`} style={{ alignItems: 'flex-start' }}>
              <T size={10} weight="700" color={f.speaker === 'Patient' ? 'primary' : 'faint'} style={{ width: 64, paddingTop: 2 }}>{f.speaker === 'Patient' ? 'You' : CATEGORY_LABEL[f.category]}</T>
              <T size={13} style={{ flex: 1, lineHeight: 18 }}>{f.text}</T>
            </Row>
          ))
        : null}
    </Card>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function VisitsScreen() {
  const t = useTheme();
  const [mode, setMode] = useState<AddMode>(null);
  const [result, setResult] = useState<{ s: SaveSummary; doctor: string } | null>(null);
  const visits = useLoad(listVisits);
  const alerts = useLoad(listAlerts);
  const stats = useLoad(memoryStats);

  useEffect(() => {
    void warmCategories().catch(() => undefined);
  }, []);

  const reload = () => {
    void visits.reload();
    void alerts.reload();
    void stats.reload();
  };

  const s = stats.data ?? { moments: 0, visits: 0, pending: 0 };
  const list = visits.data ?? [];

  return (
    <Screen top>
      <Row style={{ justifyContent: 'space-between', paddingTop: space.s }}>
        <T size={14} color="sub">{greeting()}</T>
        <HeaderActions />
      </Row>
      <T size={30} weight="700" track={-0.03} style={{ marginTop: -space.s }}>Your health memory</T>

      <SectionTitle right={<T size={12} weight="600" color="primary">{`${s.visits} visit${s.visits === 1 ? '' : 's'}`}</T>}>Latest visit</SectionTitle>
      <LatestVisitCard v={list[0]} moments={s.moments} />

      {(alerts.data ?? []).map((a, i) => (
        <AlertCard key={i} a={a} />
      ))}

      <SectionTitle
        right={
          <Pressable onPress={() => router.navigate('/ask')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="search" size={16} />
          </Pressable>
        }>
        Add a visit
      </SectionTitle>
      <Row style={{ gap: space.m, alignItems: 'stretch' }}>
        <ActionTile featured icon="mic" title="Record visit" hint="Speech → memory" onPress={() => setMode('record')} />
        <ActionTile icon="camera" title="Scan Rx" hint="Read a prescription" onPress={() => setMode('scan')} />
      </Row>
      <Row style={{ gap: space.m, alignItems: 'stretch' }}>
        <ActionTile icon="edit-3" title="Type notes" hint="Paste what was said" onPress={() => setMode('type')} />
        <ActionTile icon="message-circle" title="Ask memory" hint="Works offline" onPress={() => router.navigate('/ask')} />
      </Row>

      <SectionTitle right={s.pending ? <Chip small tone="warn" label={`${s.pending} to sync`} /> : undefined}>Your visits</SectionTitle>
      {list.length === 0 ? <Sub>Visits you add show up here as a timeline.</Sub> : list.map((v) => <VisitCard key={v.id} v={v} />)}

      {list.length ? (
        <Button
          small
          kind="ghost"
          title="Reset demo data"
          onPress={async () => {
            await resetAftercare();
            reload();
            toast('Demo data cleared');
          }}
        />
      ) : null}

      <AddVisitSheet
        mode={mode}
        onClose={() => setMode(null)}
        onSaved={(summary, doctor) => {
          setMode(null);
          setResult({ s: summary, doctor });
          reload();
        }}
      />

      <Sheet visible={!!result} title="Visit remembered" onClose={() => setResult(null)}>
        {result ? (
          <>
            <Sub>{`${result.s.facts.length} moments from ${result.doctor} understood and stored on this phone.`}</Sub>
            {result.s.changes.map((c, i) => (
              <Row key={i} style={{ backgroundColor: t.card, borderRadius: radius.m, padding: space.m }}>
                <Icon name="refresh-cw" size={14} color={t.dark} />
                <T size={14} weight="600">{c}</T>
              </Row>
            ))}
            {result.s.newAlerts.map((a, i) => (
              <AlertCard key={`a${i}`} a={a} />
            ))}
            <Button title="Done" onPress={() => setResult(null)} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
