import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

/** A generic fade + slide-up entrance, once, on mount — used anywhere something new appears (a chat bubble,
 *  a reveal card) and should look like it arrived rather than just being suddenly there. `delay` staggers a
 *  group of these (a list of sections appearing one after another instead of all at once). `style` is for
 *  layout only (e.g. `gap` when wrapping more than one stacked child) — never overwrite `opacity`/`transform`. */
export function FadeIn({ children, distance = 10, delay = 0, style }: { children: ReactNode; distance?: number; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 260, delay, useNativeDriver: true }).start();
  }, [v, delay]);

  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}
