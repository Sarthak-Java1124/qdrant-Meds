import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from './kit';
import { radius, space, useTheme } from './theme';

function IconButton({ onPress, label, name }: { onPress: () => void; label: string; name: Parameters<typeof Icon>[0]['name'] }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.primarySoft : t.card, borderWidth: 1, borderColor: t.border })}>
      <Icon name={name} size={17} color={t.dark} />
    </Pressable>
  );
}

/** Privacy + Settings: the two screens that don't fit in the bottom bar. */
export function HeaderActions() {
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginRight: space.m }}>
      <IconButton label="The Ledger" name="lock" onPress={() => router.push('/privacy' as never)} />
      <IconButton label="Settings" name="sliders" onPress={() => router.push('/settings' as never)} />
    </View>
  );
}
