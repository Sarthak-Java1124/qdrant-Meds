import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { deleteEverything } from '@/app-state/deleteEverything';
import { getZone, setZone } from '@/core/groups';
import { getSetting, setSetting } from '@/core/db';
import { refreshContacts } from '@/core/names';
import { pendingCount } from '@/privacy';
import { loadDemoRoute } from '@/lastmeter/route';
import { getApiBase, isForcedOffline, syncNow } from '@/sync';
import { ago } from '@/sync/statusLabel';
import { message } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { Button, Card, Chip, Divider, Field, H2, Row, Screen, SectionTitle, Sheet, Sub, SwitchRow, T } from '@/ui/kit';
import { ZonePicker } from '@/ui/pickers';
import { space } from '@/ui/theme';
import { toast } from '@/ui/toast';

export default function SettingsScreen() {
  const router = useRouter();
  const [zoneOpen, setZoneOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState('');

  const d = useLoad(async () => ({
    contacts: (await getSetting('src_contacts', '0')) === '1',
    zone: await getZone(),
    offline: await isForcedOffline(),
    shareStats: (await getSetting('share_stats', '0')) === '1',
    lastSync: await getSetting('last_sync_at'),
    pending: await pendingCount(),
    api: await getApiBase(),
    apiOverride: (await getSetting('api_base', '')) ?? '',
  }));
  const v = d.data;

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    try {
      const out = await fn();
      if (out) toast(out);
    } catch (e) {
      toast(message(e), 'bad');
    } finally {
      setBusy(null);
      void d.reload();
    }
  };

  const doDelete = async () => {
    setBusy('delete');
    try {
      const r = await deleteEverything();
      setDeleteOpen(false);
      setConfirm('');
      toast(r.serverDeleted ? 'Everything was deleted, here and on the server' : 'Deleted from this phone. Server deletion will run when you are back online.', 'good');
      router.replace('/onboarding' as never);
    } catch (e) {
      toast(message(e), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <SectionTitle>Zone</SectionTitle>
      <Card>
        <Sub>Riders in the same zone share what they learn about its stops. Changing this re-downloads the zone pack.</Sub>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label={v?.zone ? `Zone: ${v.zone}` : 'Choose a zone'} selected={!!v?.zone} onPress={() => setZoneOpen(true)} />
        </Row>
      </Card>

      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <SwitchRow
          label="Contacts"
          hint="Used only to catch a customer's name in a note before it leaves this phone. Never uploaded."
          value={!!v?.contacts}
          onValueChange={async (on) => {
            if (on && (await refreshContacts()) === 0) return toast('Permission was not granted, so this stays off', 'warn');
            await setSetting('src_contacts', on ? '1' : '0');
            void d.reload();
          }}
        />
      </Card>

      <SectionTitle>Sync</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between', gap: space.m }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="600" numberOfLines={1}>{v?.lastSync ? `Last synced ${ago(Number(v.lastSync))}` : 'Not synced yet'}</T>
            <Sub>{`${v?.pending ?? 0} waiting to send`}</Sub>
          </View>
          <Button small title="Sync now" busy={busy === 'sync'} onPress={() => run('sync', async () => { const r = await syncNow(); return r.skipped === 'offline' ? 'You are offline' : r.error ? `Sync failed: ${r.error.slice(0, 80)}` : `Sent ${r.pushed}, received ${r.pulled}`; })} />
        </Row>
        <Divider />
        <SwitchRow label="Force offline" hint="Stops all syncing, even with a connection. Handy for demos." value={!!v?.offline} onValueChange={async (on) => { await setSetting('force_offline', on ? '1' : '0'); void d.reload(); }} />
        <Divider />
        <SwitchRow label="Share anonymous usage counts" hint="Item counts per source and queue sizes. Never any content." value={!!v?.shareStats} onValueChange={async (on) => { await setSetting('share_stats', on ? '1' : '0'); void d.reload(); }} />
        <Divider />
        <Field label={`Server address (currently ${v?.api ?? '…'})`} placeholder="Leave empty for the automatic address" autoCapitalize="none" autoCorrect={false} defaultValue={v?.apiOverride} key={`a-${v?.apiOverride ?? ''}`} onEndEditing={async (e) => { await setSetting('api_base', e.nativeEvent.text.trim()); void d.reload(); }} />
      </Card>

      <SectionTitle>Demo</SectionTitle>
      <Card>
        <Sub>Reloads today's demo stops for the current zone and clears their progress. Handy between rehearsals.</Sub>
        <Button small kind="soft" title="Reload demo route" busy={busy === 'route'} onPress={() => run('route', async () => { const r = await loadDemoRoute(); return `Loaded ${r.stops.length} stops for ${r.zone}`; })} />
      </Card>

      <SectionTitle>More</SectionTitle>
      <Card style={{ gap: 0 }}>
        <Button kind="ghost" title="Diagnostics" onPress={() => router.push('/diagnostics' as never)} />
        <Button kind="ghost" title="Developer tests" onPress={() => router.push('/dev' as never)} />
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      <Card style={{ borderColor: '#DC2626' }}>
        <H2>Delete everything</H2>
        <Sub>Removes everything this phone knows and deletes what it contributed on the server.</Sub>
        <Button kind="danger" title="Delete everything…" onPress={() => setDeleteOpen(true)} />
      </Card>

      <ZonePicker visible={zoneOpen} current={v?.zone ?? undefined} onClose={() => setZoneOpen(false)} onPick={async (z) => { setZoneOpen(false); await setZone(z); void d.reload(); }} />

      <Sheet visible={deleteOpen} title="Delete everything?" onClose={() => setDeleteOpen(false)}>
        <T>This cannot be undone. Your notes, receipts and the zone pack on this phone will be erased, and the app will start over.</T>
        <Sub>If you are offline, the server-side deletion is queued and runs the next time you connect. The local wipe happens immediately.</Sub>
        <Field label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
        <Button kind="danger" title="Delete everything" disabled={confirm !== 'DELETE'} busy={busy === 'delete'} onPress={doDelete} />
      </Sheet>
    </Screen>
  );
}
