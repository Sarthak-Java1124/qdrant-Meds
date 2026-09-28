import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { warmCategories } from '@/aftercare/engine';
import { useApp } from '@/app-state/store';
import { setSetting } from '@/core/db';
import { setZone } from '@/core/groups';
import { refreshContacts } from '@/core/names';
import { message } from '@/ui/format';
import { Button, Field, Icon, Row, Screen, Sub, T, type IconName } from '@/ui/kit';
import { glow, radius, raisedShadow, space, useTheme } from '@/ui/theme';

type Step = 0 | 1 | 2;

/** The mockup's black bottom bar: label on the left, round blue arrow button on the right. */
function GoBar({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => ({ opacity: pressed || busy ? 0.8 : 1 })}>
      <View style={{ backgroundColor: t.dark, borderRadius: radius.pill, paddingLeft: space.xl, paddingRight: 6, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T weight="600" size={16} style={{ color: '#fff' }}>{busy ? 'Preparing on-device AI…' : label}</T>
        <View style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }, glow]}>
          <Icon name="arrow-up-right" size={22} color={t.dark} />
        </View>
      </View>
    </Pressable>
  );
}

function FloatCard({ icon, title, body, blue, style }: { icon: IconName; title: string; body: string; blue?: boolean; style?: object }) {
  const t = useTheme();
  return (
    <View style={[{ position: 'absolute', width: 190, backgroundColor: blue ? t.primary : t.card, borderRadius: radius.l, padding: space.m, gap: 6 }, blue ? glow : raisedShadow, style]}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: blue ? 'rgba(0,0,0,0.08)' : t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={t.dark} />
      </View>
      <T weight="700" size={14} style={{ color: t.dark }}>{title}</T>
      <T size={11} style={{ color: blue ? 'rgba(0,0,0,0.65)' : t.sub, lineHeight: 15 }}>{body}</T>
    </View>
  );
}

/** Stands in for the mockup's doctor photo: a soft blue stage with floating capability cards. */
function Stage() {
  const t = useTheme();
  return (
    <View style={{ height: 290 }}>
      <View style={{ position: 'absolute', left: 30, right: 30, top: 10, bottom: 10, borderRadius: 150, backgroundColor: t.primarySoft }} />
      <View style={{ position: 'absolute', right: 40, top: 20, width: 120, height: 120, borderRadius: 60, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center', ...raisedShadow }}>
        <Icon name="heart" size={46} color={t.dark} />
      </View>
      <FloatCard icon="mic" title="Remembers" body="Every word the doctor said, on this phone" style={{ left: 0, top: 40 }} />
      <FloatCard blue icon="shield" title="Safeguard" body="Flags clashes between prescriptions" style={{ right: 0, bottom: 0 }} />
    </View>
  );
}

function Dots({ step }: { step: Step }) {
  const t = useTheme();
  return (
    <Row style={{ gap: 6 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? t.dark : t.mist }} />
      ))}
    </Row>
  );
}

export default function Onboarding() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
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

  return (
    <Screen top>
      <Row style={{ justifyContent: 'space-between', paddingTop: space.s }}>
        <Row>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="activity" size={18} color={t.dark} />
          </View>
          <T weight="700" size={17}>Aftercare</T>
        </Row>
        <Dots step={step} />
      </Row>

      {step === 0 && (
        <View style={{ gap: space.l, paddingTop: space.l }}>
          <View>
            <T size={40} weight="700" track={-0.04} style={{ lineHeight: 44 }}>Never forget</T>
            <Row style={{ gap: space.s }}>
              <T size={40} weight="700" track={-0.04} style={{ lineHeight: 44 }}>what the</T>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="activity" size={24} color={t.dark} />
              </View>
            </Row>
            <T size={40} weight="700" track={-0.04} style={{ lineHeight: 44 }}>doctor said.</T>
          </View>
          <Sub style={{ fontSize: 15, lineHeight: 21 }}>An AI memory of every visit that lives on your phone, answers offline, and catches medicine clashes.</Sub>
          <Stage />
          <GoBar label="Get started" onPress={() => setStep(1)} />
        </View>
      )}

      {step === 1 && (
        <View style={{ gap: space.m, paddingTop: space.xl }}>
          <T size={30} weight="700" track={-0.03}>Who looks after you?</T>
          <Sub style={{ fontSize: 15, lineHeight: 21 }}>Your family circle gets the medicine list and alerts — never your recordings. You can change this later.</Sub>
          <Field label="Family circle name" placeholder="e.g. Sharma family" value={family} onChangeText={setFamily} autoCapitalize="words" />
          <View style={{ height: space.xl }} />
          <GoBar label="Continue" onPress={() => setStep(2)} />
          <Button kind="ghost" title="Back" onPress={() => setStep(0)} />
        </View>
      )}

      {step === 2 && (
        <View style={{ gap: space.m, paddingTop: space.xl }}>
          <T size={30} weight="700" track={-0.03}>You’re all set</T>
          <Sub style={{ fontSize: 15, lineHeight: 21 }}>We’ll prepare the on-device AI now so your first visit is understood instantly, with or without internet.</Sub>
          {[
            { icon: 'cpu' as IconName, text: 'Understanding runs on this phone' },
            { icon: 'wifi-off' as IconName, text: 'Ask questions in airplane mode' },
            { icon: 'lock' as IconName, text: 'Recordings never leave the device' },
          ].map((x) => (
            <Row key={x.text} style={{ backgroundColor: t.card, borderRadius: radius.l, padding: space.m, gap: space.m }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={x.icon} size={16} color={t.dark} />
              </View>
              <T weight="600">{x.text}</T>
            </Row>
          ))}
          {failure ? <T color="bad">{failure}</T> : null}
          <View style={{ height: space.m }} />
          <GoBar label="Start" busy={busy} onPress={finish} />
          <Button kind="ghost" title="Back" onPress={() => setStep(1)} />
        </View>
      )}
      <View style={{ height: insets.bottom }} />
    </Screen>
  );
}
