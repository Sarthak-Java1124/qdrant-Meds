import { useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { warmCategories } from '@/aftercare/engine';
import { useApp } from '@/app-state/store';
import { setSetting } from '@/core/db';
import { setZone } from '@/core/groups';
import { refreshContacts } from '@/core/names';
import { message } from '@/ui/format';
import { Field, Icon, PeachWash, Row, Screen, T, type IconName } from '@/ui/kit';
import { cardShadow, radius, raisedShadow, space } from '@/ui/theme';

type Step = 0 | 1 | 2;

/** Warm peach-and-espresso palette from the onboarding reference, local to this screen. */
const C = {
  ink: '#2B1208',
  inkSub: 'rgba(43,18,8,0.62)',
  peach: '#F9D5BC',
  peachSoft: '#FDEBDD',
  peachDeep: '#F2B48D',
  sage: '#BBD6CD',
  cream: '#FBF7F3',
  white: '#FFFFFF',
} as const;

const AVATAR_TINTS = ['#F4C7A8', '#EBD3C4', '#F9DFC9', '#D9E6DF', '#F2B48D', '#E8CDBB'] as const;

/** Segmented progress across the top, filled up to the current step. */
function Progress({ step }: { step: Step }) {
  return (
    <Row style={{ gap: 6, flex: 1 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? C.ink : 'rgba(43,18,8,0.12)' }} />
      ))}
    </Row>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', ...cardShadow }}>
      <Icon name="chevron-left" size={20} color={C.ink} />
    </Pressable>
  );
}

/** Stand-in for the reference's photo avatars: a tinted circle with a glyph, ringed in white. */
function Avatar({ size, tint, icon, style }: { size: number; tint: string; icon: IconName; style?: object }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center', ...cardShadow }, style]}>
      <Icon name={icon} size={Math.round(size * 0.42)} color={C.ink} />
    </View>
  );
}

/** The small espresso rounded-square icon chips that float around the heroes. */
function DarkChip({ icon, style }: { icon: IconName; style?: object }) {
  return (
    <View style={[{ width: 44, height: 36, borderRadius: 18, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', ...raisedShadow, shadowColor: C.peachDeep }, style]}>
      <Icon name={icon} size={16} color={C.white} />
    </View>
  );
}

const Sparkle = ({ size = 22, color = C.white, style }: { size?: number; color?: string; style?: object }) => (
  <T size={size} style={[{ position: 'absolute', color }, style]}>{'✦'}</T>
);

/** Step 1 hero: avatars orbiting a "Memory, simplified" pill. */
function HeroMemory({ height }: { height: number }) {
  return (
    <View style={{ height }}>
      <View style={{ position: 'absolute', left: '6%', right: '6%', top: '14%', bottom: '10%', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(242,180,141,0.45)' }} />
      <Sparkle size={30} style={{ left: '3%', top: '14%' }} />
      <Sparkle size={44} style={{ left: '62%', top: '2%' }} />
      <Sparkle size={16} color={C.peachDeep} style={{ left: '78%', top: '62%' }} />

      <Avatar size={78} tint={AVATAR_TINTS[0]} icon="user" style={{ position: 'absolute', left: '16%', top: '6%' }} />
      <Avatar size={58} tint={AVATAR_TINTS[1]} icon="heart" style={{ position: 'absolute', left: '40%', top: '26%' }} />
      <Avatar size={54} tint={AVATAR_TINTS[2]} icon="activity" style={{ position: 'absolute', right: '4%', top: '16%' }} />
      <Avatar size={52} tint={AVATAR_TINTS[3]} icon="user" style={{ position: 'absolute', left: '4%', bottom: '8%' }} />
      <Avatar size={46} tint={AVATAR_TINTS[4]} icon="clipboard" style={{ position: 'absolute', left: '28%', bottom: '4%' }} />
      <Avatar size={68} tint={AVATAR_TINTS[5]} icon="user" style={{ position: 'absolute', right: '6%', bottom: '4%' }} />

      <View style={{ position: 'absolute', left: '11%', right: '11%', top: '44%', backgroundColor: C.white, borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...raisedShadow, shadowColor: C.peachDeep }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={15} color={C.white} />
        </View>
        <T size={18} weight="500" style={{ color: C.ink }}>Every visit, remembered</T>
      </View>

      <DarkChip icon="calendar" style={{ position: 'absolute', left: -10, top: '38%' }} />
      <DarkChip icon="message-circle" style={{ position: 'absolute', right: -10, top: '36%' }} />
      <DarkChip icon="clipboard" style={{ position: 'absolute', left: '40%', bottom: '2%' }} />
    </View>
  );
}

function VisitCard({ icon, title, sub, tag, tagBg, tagFg, rotate, inset = 0 }: { icon: IconName; title: string; sub: string; tag?: string; tagBg?: string; tagFg?: string; rotate: string; inset?: number }) {
  return (
    <View style={{ backgroundColor: C.white, borderRadius: radius.m, padding: space.m, marginHorizontal: inset, flexDirection: 'row', alignItems: 'center', gap: space.m, transform: [{ rotate }], ...cardShadow }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.peachSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={C.ink} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <T size={14} weight="600" style={{ color: C.ink }} numberOfLines={1}>{title}</T>
        <T size={12} style={{ color: C.inkSub }} numberOfLines={1}>{sub}</T>
      </View>
      {tag ? (
        <View style={{ backgroundColor: tagBg, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 }}>
          <T size={11} weight="600" style={{ color: tagFg }}>{tag}</T>
        </View>
      ) : null}
    </View>
  );
}

/** Step 2 hero: floating visit cards over a row of family avatars. */
function HeroCards({ height }: { height: number }) {
  return (
    <View style={{ height, justifyContent: 'space-between' }}>
      <View style={{ gap: space.s }}>
        <VisitCard icon="heart" title="Dr. Mehta, Cardiologist" sub="Amlodipine 10 mg · every morning" tag="Today" tagBg={C.peach} tagFg={C.ink} rotate="-1.5deg" />
        <VisitCard icon="alert-triangle" title="Aspirin + Ibuprofen" sub="Prescribed by two doctors" tag="High risk" tagBg="#FBDAD5" tagFg="#B3261E" rotate="1deg" inset={10} />
        <VisitCard icon="check-square" title="Get an ECG before next visit" sub="Follow-up in two weeks" rotate="-0.5deg" inset={22} />
      </View>
      <Row style={{ justifyContent: 'center', gap: -10 }}>
        {[1, 4, 0, 3, 2].map((tint, i) => (
          <Avatar key={i} size={i === 2 ? 64 : 46} tint={AVATAR_TINTS[tint]} icon="user" style={{ marginLeft: i ? -8 : 0, zIndex: i === 2 ? 2 : 1 }} />
        ))}
      </Row>
    </View>
  );
}

function PillColumn({ icon, label, fill, height, top, chip }: { icon: IconName; label: string; fill: string; height: number; top: number; chip: IconName }) {
  return (
    <View style={{ flex: 1, height, marginTop: top, borderRadius: 999, backgroundColor: fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: space.m }}>
      <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={C.ink} />
      </View>
      <T size={12} weight="600" style={{ color: C.ink, textAlign: 'center', lineHeight: 16 }}>{label}</T>
      <DarkChip icon={chip} style={{ position: 'absolute', bottom: -14, width: 38, height: 32, borderRadius: 16 }} />
    </View>
  );
}

/** Step 3 hero: the reference's three tall pills, carrying the on-device promises instead of photos. */
function HeroPills({ height }: { height: number }) {
  const h = Math.min(height * 0.62, 250);
  return (
    <View style={{ height }}>
      <Sparkle size={26} color={C.peachDeep} style={{ left: -2, top: '18%' }} />
      <Sparkle size={30} color={C.sage} style={{ right: -2, top: '52%' }} />
      <Row style={{ alignItems: 'flex-start', gap: space.m, paddingHorizontal: space.m }}>
        <PillColumn icon="cpu" label={'Runs on\nthis phone'} fill={C.peach} height={h} top={0} chip="calendar" />
        <PillColumn icon="wifi-off" label={'Works in\nairplane mode'} fill={C.sage} height={h} top={height * 0.16} chip="message-circle" />
        <PillColumn icon="lock" label={'Recordings\nstay here'} fill={C.peachSoft} height={h} top={height * 0.04} chip="clipboard" />
      </Row>
    </View>
  );
}

/** The espresso pill CTA from the reference: label, then an arrow. */
function NextButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed || busy ? 0.85 : 1 })}>
      <View style={{ minWidth: 190, backgroundColor: C.ink, borderRadius: radius.pill, paddingVertical: 17, paddingHorizontal: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...raisedShadow, shadowColor: C.peachDeep }}>
        {busy ? <ActivityIndicator size="small" color={C.white} /> : null}
        <T weight="600" size={15} style={{ color: C.white }}>{busy ? 'Preparing on-device AI…' : label}</T>
        {busy ? null : <Icon name="arrow-right" size={16} color={C.white} />}
      </View>
    </Pressable>
  );
}

const Title = ({ children }: { children: ReactNode }) => (
  <T size={32} weight="700" track={-0.03} style={{ color: C.ink, textAlign: 'center', lineHeight: 38 }}>{children}</T>
);
const Sub = ({ children }: { children: ReactNode }) => (
  <T style={{ color: C.inkSub, textAlign: 'center', fontSize: 15, lineHeight: 22 }}>{children}</T>
);

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const setApp = useApp((s) => s.set);
  const [step, setStep] = useState<Step>(0);
  const [family, setFamily] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const finish = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await setZone(family.trim() || 'family');
      await refreshContacts().catch(() => 0); // best-effort; the Leak Check's name gate degrades gracefully without it
      await warmCategories().catch(() => undefined);
      await setSetting('onboarded', '1');
      setApp({ onboarded: true }); // the root layout then starts sync and moves to the tabs
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };

  const heroH = Math.max(250, Math.min(winH * 0.4, 380));

  return (
    <Screen scroll={false} padded={false}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: step === 0 ? C.white : C.cream, paddingTop: insets.top + space.s, paddingHorizontal: space.l }}>
        {step === 0 ? <PeachWash height={winH * 0.62} to="#FFFFFF" /> : null}

        <Row style={{ gap: space.m }}>
          {step > 0 ? <BackButton onPress={() => (busy ? undefined : setStep((step - 1) as Step))} /> : null}
          <Progress step={step} />
        </Row>

        <View style={{ marginTop: space.xl }}>
          {step === 0 && <HeroMemory height={heroH} />}
          {step === 1 && <HeroCards height={heroH * 0.72} />}
          {step === 2 && <HeroPills height={heroH} />}
        </View>

        <View style={{ marginTop: space.xl, gap: space.m }}>
          {step === 0 && (
            <>
              <Title>{'Never forget what\nthe doctor said'}</Title>
              <Sub>An AI memory of every visit that lives on your phone, answers offline, and catches medicine clashes.</Sub>
            </>
          )}
          {step === 1 && (
            <>
              <Title>{'Who looks\nafter you?'}</Title>
              <Sub>Your family circle gets the medicine list and alerts, never your recordings. You can change this later.</Sub>
              <Field
                placeholder="Family circle name, e.g. Sharma family"
                value={family}
                onChangeText={setFamily}
                autoCapitalize="words"
                style={{ borderRadius: radius.pill, paddingHorizontal: space.l, paddingVertical: 14, backgroundColor: C.white, borderColor: 'rgba(43,18,8,0.12)', color: C.ink }}
              />
            </>
          )}
          {step === 2 && (
            <>
              <Title>{'You’re all set'}</Title>
              <Sub>We’ll prepare the on-device AI now so your first visit is understood instantly, with or without internet.</Sub>
              {failure ? <T style={{ color: '#B3261E', textAlign: 'center' }}>{failure}</T> : null}
            </>
          )}
        </View>

        <View style={{ flex: 1 }} />
        <View style={{ paddingBottom: insets.bottom + space.l }}>
          {step === 0 && <NextButton label="Get started" onPress={() => setStep(1)} />}
          {step === 1 && <NextButton label="Next" onPress={() => setStep(2)} />}
          {step === 2 && <NextButton label="Start" busy={busy} onPress={finish} />}
        </View>
      </View>
    </Screen>
  );
}
