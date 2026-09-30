import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

const SPRING = { damping: 16, stiffness: 160, mass: 0.6 } as const;

/**
 * A choreographed, spring-driven entrance — like a Remotion composition's sequenced reveal, but running live
 * in the app via Reanimated instead of pre-rendered: fades in, rises up and settles with a slight overshoot
 * bounce rather than easing in linearly. `delay` staggers a group of these into a cascade. Distinct from the
 * plainer `FadeIn` (linear `Animated` timing, no bounce) — reach for this where the extra physics earns its
 * place, `FadeIn` where a quieter arrival is more appropriate.
 */
export function SpringIn({ children, delay = 0, distance = 22, fromScale = 0.94, style }: { children: ReactNode; delay?: number; distance?: number; fromScale?: number; style?: StyleProp<ViewStyle> }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withSpring(1, SPRING));
  }, [delay, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }, { scale: fromScale + (1 - fromScale) * progress.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
