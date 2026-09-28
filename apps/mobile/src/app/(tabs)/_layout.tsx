import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/ui/kit';
import { HeaderActions } from '@/ui/HeaderActions';
import { useTheme } from '@/ui/theme';

const BAR_CONTENT_HEIGHT = 60;
const TAB_ICON: Record<string, IconName> = { index: 'home', ask: 'search', meds: 'activity', memory: 'database' };

/**
 * Four tabs: Visits (home, with its own greeting header), Ask, Meds and Memory. Privacy and Settings sit in
 * the header as round icon buttons. The bar pads by the bottom inset so it clears Android's gesture/nav bar.
 */
export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tab = (name: string) => ({
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <View style={{ width: 56, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? t.primary : 'transparent' }}>
        <Icon name={TAB_ICON[name]} size={20} color={color as string} />
      </View>
    ),
  });
  return (
    <Tabs
      screenOptions={{
        headerRight: () => <HeaderActions />,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: t.bg },
        headerTitleStyle: { fontFamily: 'Geist-Bold', color: t.dark, fontSize: 24, letterSpacing: -0.6 },
        headerTitleAlign: 'left',
        sceneStyle: { backgroundColor: t.bg },
        tabBarStyle: {
          backgroundColor: t.card,
          borderTopWidth: 0,
          height: BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 4,
          paddingTop: 8,
          elevation: 12,
          shadowColor: '#000000',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarIconStyle: { width: 56, height: 30 },
        tabBarActiveTintColor: t.dark,
        tabBarInactiveTintColor: t.faint,
        tabBarLabelStyle: { fontFamily: 'Geist-SemiBold', fontSize: 11, marginTop: 2 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Visits', headerShown: false, ...tab('index') }} />
      <Tabs.Screen name="ask" options={{ title: 'Ask', ...tab('ask') }} />
      <Tabs.Screen name="meds" options={{ title: 'Medicines', ...tab('meds') }} />
      <Tabs.Screen name="memory" options={{ title: 'Memory', ...tab('memory') }} />
    </Tabs>
  );
}
