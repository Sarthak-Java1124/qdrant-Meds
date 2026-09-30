import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, T, type IconName } from '@/ui/kit';
import { HeaderActions } from '@/ui/HeaderActions';
import { raisedShadow, space, useTheme } from '@/ui/theme';

const TAB_ICON: Record<string, IconName> = { index: 'home', ask: 'search', meds: 'activity', memory: 'database' };
const TAB_LABEL: Record<string, string> = { index: 'Visits', ask: 'Ask', meds: 'Meds', memory: 'Memory' };

/** The slice of React Navigation's bottom-tab props this bar uses (the package is not a direct dependency). */
interface BarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

/**
 * The onboarding's espresso pill, floating above the canvas: inactive tabs are a quiet light icon, the active
 * one grows into a peach pill holding icon + label. It sits in the layout (not over it) and pads by the bottom
 * inset, so screens never scroll underneath it and it clears Android's gesture bar.
 */
function FloatingTabBar({ state, navigation }: BarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (typing) return null; // the Ask input needs the room; the bar returns as soon as the keyboard closes
  return (
    <View style={{ backgroundColor: t.bg, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: Math.max(insets.bottom, space.m) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.dark, borderRadius: 999, padding: 6, gap: 4, ...raisedShadow, shadowColor: t.primary }}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const onPress = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={TAB_LABEL[route.name]}
              accessibilityState={{ selected: focused }}
              style={({ pressed }) => ({
                flex: focused ? 2 : 1,
                height: 52,
                borderRadius: 26,
                backgroundColor: focused ? t.primary : 'transparent',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                opacity: pressed && !focused ? 0.6 : 1,
              })}>
              <Icon name={TAB_ICON[route.name]} size={20} color={focused ? t.dark : 'rgba(255,255,255,0.72)'} />
              {focused ? <T size={14} weight="700" style={{ color: t.dark }}>{TAB_LABEL[route.name]}</T> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Four tabs: Visits (home, with its own greeting header), Ask, Meds and Memory. Privacy and Settings sit in
 * the header as round icon buttons.
 */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...(props as unknown as BarProps)} />}
      screenOptions={{
        headerRight: () => <HeaderActions />,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: t.wash },
        headerTitleStyle: { fontFamily: 'Geist-Bold', color: t.dark, fontSize: 24, letterSpacing: -0.6 },
        headerTitleAlign: 'left',
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Visits', headerShown: false }} />
      <Tabs.Screen name="ask" options={{ title: 'Ask' }} />
      <Tabs.Screen name="meds" options={{ title: 'Medicines' }} />
      <Tabs.Screen name="memory" options={{ title: 'Memory' }} />
    </Tabs>
  );
}
