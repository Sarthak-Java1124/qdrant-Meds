import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import { radius, useTheme } from './theme';

function Dot({ delay }: { delay: number }) {
  const t = useTheme();
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.delay(300),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);

  return (
    <Animated.View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: t.dark,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
      }}
    />
  );
}

/** The Ask tab's "it's thinking" state: three staggered bouncing dots in a bubble, so waiting for an answer
 *  actually looks like something is happening, instead of a static "Thinking…" line. */
export function ThinkingDots() {
  const t = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: radius.l, borderBottomLeftRadius: radius.s, paddingHorizontal: 16, paddingVertical: 14 }}>
      <Dot delay={0} />
      <Dot delay={120} />
      <Dot delay={240} />
    </View>
  );
}
