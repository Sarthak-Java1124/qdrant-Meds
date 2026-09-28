import { useEffect, useRef, type ReactNode } from 'react';
import { Animated } from 'react-native';

/** A generic fade + slide-up entrance, once, on mount — used anywhere something new appears (a chat bubble,
 *  a reveal card) and should look like it arrived rather than just being suddenly there. */
export function FadeIn({ children, distance = 10 }: { children: ReactNode; distance?: number }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [v]);

  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
