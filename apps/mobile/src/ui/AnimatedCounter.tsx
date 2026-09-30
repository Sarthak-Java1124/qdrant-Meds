import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated } from 'react-native';

import { T } from './kit';

/**
 * A number that counts up to `value` on mount/change instead of just appearing — the other half of a
 * Remotion-style "kinetic" reveal alongside SpringIn's motion. Plain `Animated` (not Reanimated): a short,
 * infrequent JS-thread counter has no perf reason to reach for worklets, and it matches how the rest of the
 * app already animates (Card/Button/ThinkingDots/FadeIn).
 */
export function AnimatedCounter({ value, duration = 700, ...text }: { value: number; duration?: number } & Omit<ComponentProps<typeof T>, 'children'>) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    const run = Animated.timing(anim, { toValue: value, duration, useNativeDriver: false });
    run.start();
    return () => {
      anim.removeListener(id);
      run.stop();
    };
  }, [value, duration, anim]);

  return <T {...text}>{shown}</T>;
}
