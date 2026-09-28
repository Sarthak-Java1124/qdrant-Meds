import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { statusLabel, syncNow, useSyncStore } from '@/sync';

import { Icon, T } from './kit';
import { toast } from './toast';
import { radius, space, useTheme } from './theme';

/** The header pill: Offline / Syncing / N pending / Synced 2m ago. Tap to sync now. Pill-shaped, mono, tinted by state. */
export function SyncPill() {
  const t = useTheme();
  const { status, lastSyncAt, pendingCount } = useSyncStore();
  const label = statusLabel({ status, lastSyncAt, pendingCount });
  const tone =
    status === 'error' ? [t.badSoft, t.bad] : status === 'offline' || pendingCount > 0 ? [t.warnSoft, t.warn] : status === 'pushing' || status === 'pulling' ? [t.primarySoft, t.dark] : [t.goodSoft, t.good];

  const onPress = async () => {
    const r = await syncNow();
    if (r.skipped === 'offline') toast('You are offline. Everything still works on this phone.', 'warn');
    else if (r.error) toast(`Sync failed: ${r.error.slice(0, 80)}`, 'bad');
    else toast(r.pushed || r.pulled ? `Synced: sent ${r.pushed}, received ${r.pulled}` : 'Already up to date');
  };

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View style={{ backgroundColor: tone[0], borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 }}>
        <T weight="600" size={11} style={{ color: tone[1] }}>{label}</T>
      </View>
    </Pressable>
  );
}

function IconButton({ onPress, label, name }: { onPress: () => void; label: string; name: Parameters<typeof Icon>[0]['name'] }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.primarySoft : t.card, borderWidth: 1, borderColor: t.border })}>
      <Icon name={name} size={17} color={t.dark} />
    </Pressable>
  );
}

/** Sync pill + Privacy + Settings: the two screens that don't fit in the bottom bar. */
export function HeaderActions() {
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginRight: space.m }}>
      <SyncPill />
      <IconButton label="The Ledger" name="lock" onPress={() => router.push('/privacy' as never)} />
      <IconButton label="Settings" name="sliders" onPress={() => router.push('/settings' as never)} />
    </View>
  );
}
