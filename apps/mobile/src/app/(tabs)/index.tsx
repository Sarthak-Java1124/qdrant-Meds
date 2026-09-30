import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { AddVisitSheet, type AddMode } from '@/aftercare/AddVisit';
import { CATEGORY_LABEL, type Category } from '@/aftercare/data';
import { listAlerts, listVisits, memoryStats, resetAftercare, warmCategories, type Alert, type SaveSummary, type VisitRow } from '@/aftercare/engine';
import { AnimatedCounter } from '@/ui/AnimatedCounter';
import { HeaderActions } from '@/ui/HeaderActions';
import { Button, Card, Chip, Icon, Row, Screen, SectionTitle, Sheet, Sub, T, type IconName } from '@/ui/kit';
import { fmtDate } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { SpringIn } from '@/ui/SpringIn';
import { cardShadow, pastel, radius, raisedShadow, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

const SOURCE_LABEL = { recording: 'Recorded', prescription: 'Scanned', typed: 'Typed' } as const;
const CAT_TONE: Partial<Record<Category, 'good' | 'warn' | 'bad'>> = { medicine: 'good', warning: 'bad', test: 'warn', follow_up: 'warn' };
const AVATAR_TINTS = [pastel.skySoft, pastel.mintSoft, pastel.pinkSoft, '#F1E9E1'];

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
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: light ? pastel.mint : tint, alignItems: 'center', justifyContent: 'center' }}>
      <T weight="700" size={size * 0.34} style={{ color: t.dark }}>{initials(name)}</T>
    </View>
  );
}

type RoundTone = 'light' | 'onDark' | 'sky';

function RoundIcon({ name, tone = 'light', size = 36 }: { name: IconName; tone?: RoundTone; size?: number }) {
  const t = useTheme();
  const c = {
    light: { bg: t.surfaceAlt, fg: t.dark },
    onDark: { bg: 'rgba(255,255,255,0.14)', fg: '#FFFFFF' },
    sky: { bg: t.primary, fg: t.dark },
  }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.46} color={c.fg} />
    </View>
  );
}

/** A round play-style button: sky on light surfaces, white on the sky card. `pulsing` breathes a soft ring
 *  outward behind it on a loop — the "tap to talk" cue on the featured record action. */
function PlayDot({ icon, tone = 'sky', size = 34, pulsing }: { icon: IconName; tone?: 'sky' | 'white'; size?: number; pulsing?: boolean }) {
  const t = useTheme();
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulsing) return;
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulsing, ring]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pulsing ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: radius.pill,
            backgroundColor: t.primary,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
          }}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: tone === 'sky' ? t.primary : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={size * 0.44} color={t.dark} />
      </View>
    </View>
  );
}

/** Press-in/out spring, shared by the tappable home-screen tiles — the same tactile feel as Card/Button. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
  return { scale, pressIn, pressOut };
}

/** One of the two big side-by-side cards: title up top, a pill with hint + play dot at the bottom. `pulse`
 *  marks the featured/primary one so its play dot breathes to draw the eye. */
function HeroTile({ icon, title, hint, onPress, dark, pulse }: { icon: IconName; title: string; hint: string; onPress: () => void; dark?: boolean; pulse?: boolean }) {
  const t = useTheme();
  const { scale, pressIn, pressOut } = usePressScale();
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={{ flex: 1 }}>
        <View style={[{ flex: 1, backgroundColor: dark ? t.dark : t.card, borderRadius: radius.l, padding: space.m, paddingTop: space.l, justifyContent: 'space-between', gap: space.xl, minHeight: 156 }, dark ? raisedShadow : cardShadow]}>
          <T weight="600" size={21} track={-0.02} style={{ color: dark ? '#FFFFFF' : t.dark, lineHeight: 25 }}>{title}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: dark ? t.darkRaised : t.surfaceAlt, borderRadius: radius.pill, paddingLeft: 12, padding: 4 }}>
            <T size={11} weight="500" numberOfLines={1} style={{ flex: 1, color: dark ? 'rgba(255,255,255,0.85)' : t.sub }}>{hint}</T>
            <PlayDot icon={icon} size={30} pulsing={pulse} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** A full-width list card: title, small pill tags, round action on the right. */
function ListTile({ icon, title, tags, onPress, filled }: { icon: IconName; title: string; tags: string[]; onPress: () => void; filled?: boolean }) {
  const t = useTheme();
  const { scale, pressIn, pressOut } = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}>
        <View style={[{ backgroundColor: filled ? t.primary : t.card, borderRadius: radius.l, padding: space.l, flexDirection: 'row', alignItems: 'center', gap: space.m }, filled ? null : cardShadow]}>
          <View style={{ flex: 1, gap: space.s }}>
            <T weight="600" size={16} style={{ color: t.dark }}>{title}</T>
            <Row style={{ gap: 6 }}>
              {tags.map((tag) => (
                <View key={tag} style={{ backgroundColor: filled ? 'rgba(255,255,255,0.75)' : t.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <T size={11} weight="500" style={{ color: t.dark }}>{tag}</T>
                </View>
              ))}
            </Row>
          </View>
          <PlayDot icon={icon} tone={filled ? 'white' : 'sky'} size={40} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** The home screen's hero card for the most recent visit. Tapping it expands the full transcript inline,
 *  the same "tap a card to read everything" pattern as the visit rows further down the screen. */
function LatestVisitCard({ v, moments }: { v: VisitRow | undefined; moments: number }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const meds = v?.facts.filter((f) => f.med).length ?? 0;
  const body = (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.05)', top: -80, right: -60 }} />
      {v ? (
        <>
          <Row style={{ gap: space.m }}>
            <Avatar name={v.doctor} light />
            <View style={{ flex: 1 }}>
              <T weight="700" size={17} style={{ color: '#fff' }}>{v.doctor}</T>
              <T size={12} style={{ color: 'rgba(255,255,255,0.75)' }}>{`${v.specialty}${v.clinic ? ` · ${v.clinic}` : ''}`}</T>
            </View>
            <RoundIcon name={open ? 'chevron-up' : 'chevron-down'} tone="sky" size={32} />
          </Row>
          <View style={{ backgroundColor: t.darkRaised, borderRadius: radius.pill, paddingVertical: space.m, paddingHorizontal: space.l, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Row style={{ gap: 6 }}>
              <Icon name="calendar" size={13} color="#fff" />
              <T size={12} weight="600" style={{ color: '#fff' }}>{fmtDate(v.ts)}</T>
            </Row>
            <Row style={{ gap: 6 }}>
              <Icon name="plus-square" size={13} color="#fff" />
              <View style={{ flexDirection: 'row' }}>
                <AnimatedCounter value={meds} size={12} weight="600" style={{ color: '#fff' }} />
                <T size={12} weight="600" style={{ color: '#fff' }}>{meds === 1 ? ' medicine' : ' medicines'}</T>
              </View>
            </Row>
            <Row style={{ gap: 6 }}>
              <Icon name="cpu" size={13} color="#fff" />
              <View style={{ flexDirection: 'row' }}>
                <AnimatedCounter value={moments} size={12} weight="600" style={{ color: '#fff' }} />
                <T size={12} weight="600" style={{ color: '#fff' }}> on-device</T>
              </View>
            </Row>
          </View>
          {open ? (
            <View style={{ gap: space.s }}>
              {v.facts.map((f, i) => (
                <Row key={i} style={{ alignItems: 'flex-start' }}>
                  <T size={10} weight="700" style={{ width: 64, paddingTop: 2, color: f.speaker === 'Patient' ? t.primary : 'rgba(255,255,255,0.55)' }}>
                    {f.speaker === 'Patient' ? 'You' : CATEGORY_LABEL[f.category]}
                  </T>
                  <T size={13} style={{ flex: 1, lineHeight: 18, color: '#fff' }}>{f.text}</T>
                </Row>
              ))}
            </View>
          ) : (
            <T size={11} style={{ color: 'rgba(255,255,255,0.55)' }}>{`${v.facts.length} moments · tap to read`}</T>
          )}
        </>
      ) : (
        <View style={{ gap: 6 }}>
          <T weight="700" size={18} style={{ color: '#fff' }}>No visits yet</T>
          <T size={13} style={{ color: 'rgba(255,255,255,0.8)' }}>Record your next appointment. It is understood and stored on this phone, even with no internet.</T>
        </View>
      )}
    </>
  );
  const style = [{ backgroundColor: t.dark, borderRadius: radius.xl, padding: space.l, gap: space.m, overflow: 'hidden' as const }, raisedShadow];
  return v ? (
    <Pressable onPress={() => setOpen((o) => !o)} style={({ pressed }) => [...style, pressed && { opacity: 0.92 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
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
          <View style={{ backgroundColor: t.primary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
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
      <SpringIn style={{ gap: space.m }}>
        <Row style={{ justifyContent: 'flex-end', paddingTop: space.s, marginRight: -space.m }}>
          <HeaderActions />
        </Row>
        <T size={32} weight="700" track={-0.03}>{`${greeting()} 👋`}</T>
      </SpringIn>

      <SpringIn delay={60}>
        <Pressable onPress={() => router.navigate('/ask')} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
          <Row style={{ backgroundColor: t.card, borderRadius: radius.pill, paddingHorizontal: space.l, paddingVertical: 14, gap: space.m, ...cardShadow }}>
            <Icon name="search" size={17} color={t.dark} />
            <T size={14} color="faint">Search your visits…</T>
          </Row>
        </Pressable>
      </SpringIn>

      <SpringIn delay={120}>
        <Row style={{ gap: space.m, alignItems: 'stretch', marginTop: space.xs }}>
          <HeroTile dark pulse icon="mic" title={'Record\nvisit'} hint="Speech → memory" onPress={() => setMode('record')} />
          <HeroTile icon="camera" title={'Scan\nprescription'} hint="Photo → medicines" onPress={() => setMode('scan')} />
        </Row>
      </SpringIn>

      <SpringIn delay={180} style={{ gap: space.m }}>
        <SectionTitle right={<T size={12} weight="500" color="sub">Works offline</T>}>More ways to add</SectionTitle>
        <View style={{ gap: space.m }}>
          <ListTile filled icon="edit-3" title="Type your notes" tags={['Typed', 'Any visit']} onPress={() => setMode('type')} />
          <ListTile icon="message-circle" title="Ask your memory" tags={['On-device', 'Offline']} onPress={() => router.navigate('/ask')} />
        </View>
      </SpringIn>

      <SpringIn delay={240} style={{ gap: space.m }}>
        <SectionTitle
          right={
            <Row style={{ gap: 0 }}>
              <AnimatedCounter value={s.visits} size={12} weight="500" color="sub" />
              <T size={12} weight="500" color="sub">{s.visits === 1 ? ' visit' : ' visits'}</T>
            </Row>
          }>
          Latest visit
        </SectionTitle>
        <LatestVisitCard v={list[0]} moments={s.moments} />
      </SpringIn>

      {(alerts.data ?? []).map((a, i) => (
        <SpringIn key={i} delay={280 + i * 40}>
          <AlertCard a={a} />
        </SpringIn>
      ))}

      <SpringIn delay={300}>
        <SectionTitle right={s.pending ? <Chip small tone="warn" label={`${s.pending} to sync`} /> : undefined}>Your visits</SectionTitle>
      </SpringIn>
      {list.length === 0 ? (
        <SpringIn delay={340}>
          <Sub>Visits you add show up here as a timeline.</Sub>
        </SpringIn>
      ) : (
        list.map((v, i) => (
          <SpringIn key={v.id} delay={320 + Math.min(i, 4) * 40}>
            <VisitCard v={v} />
          </SpringIn>
        ))
      )}

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
