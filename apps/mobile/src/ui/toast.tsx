import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { subscribePrivacyEvents, type PrivacyEvent } from '@/privacy';

import { T } from './kit';
import { space, useTheme } from './theme';

type Tone = 'good' | 'warn' | 'bad';
interface ToastMsg {
  id: number;
  text: string;
  tone: Tone;
}

const listeners = new Set<(m: ToastMsg) => void>();
let nextId = 1;

/** Shows a toast from anywhere in the app. */
export function toast(text: string, tone: Tone = 'good') {
  const m = { id: nextId++, text, tone };
  listeners.forEach((fn) => fn(m));
}

/** The Leak Check's verdicts, in words a person understands. */
export function describePrivacyEvent(e: PrivacyEvent): { text: string; tone: Tone } {
  if (e.type === 'blocked') return { text: `Blocked: ${e.reason ?? 'not safe to share'}`, tone: 'bad' };
  return { text: 'Shared as a place fact for the next rider', tone: 'good' };
}

/** Mount once at the root: shows toasts and turns Leak Check events into toasts. */
export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const show = (m: ToastMsg) => setMsg(m);
    listeners.add(show);
    const off = subscribePrivacyEvents((e) => {
      const d = describePrivacyEvent(e);
      toast(d.text, d.tone);
    });
    return () => {
      listeners.delete(show);
      off();
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const h = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => setMsg(null)), 3200);
    return () => clearTimeout(h);
  }, [msg, opacity]);

  if (!msg) return null;
  // good is near-black ink with an accent edge; warn and bad use the status colours
  const bg = { good: t.dark, warn: t.warn, bad: t.bad }[msg.tone];
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: space.l, right: space.l, bottom: insets.bottom + 84, opacity }}>
      <View style={{ backgroundColor: bg, flexDirection: 'row' }}>
        <View style={{ width: 4, backgroundColor: msg.tone === 'good' ? t.primary : 'rgba(255,255,255,0.5)' }} />
        <T size={14} weight="600" style={{ color: t.canvas, flex: 1, paddingHorizontal: space.l, paddingVertical: space.m }}>{msg.text}</T>
      </View>
    </Animated.View>
  );
}
