import { useState } from 'react';
import { View } from 'react-native';

import { FAMILY } from '@/aftercare/data';
import { listAlerts, listMeds, memoryStats, queueMedSync, type MedRow } from '@/aftercare/engine';
import { syncNow } from '@/sync';
import { Button, Card, Chip, Eyebrow, Icon, PeachWash, Row, Screen, SectionTitle, Sub, T } from '@/ui/kit';
import { fmtDate } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { cardShadow, radius, raisedShadow, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

const DAY = 86_400_000;

function MedCard({ m, featured }: { m: MedRow; featured?: boolean }) {
  const t = useTheme();
  const active = m.status === 'active';
  const endsAt = m.duration_days ? m.ts + m.duration_days * DAY : null;
  const fg = featured ? '#fff' : t.dark;
  const sub = featured ? 'rgba(255,255,255,0.75)' : t.sub;
  return (
    <View style={[{ backgroundColor: featured ? t.dark : t.card, borderRadius: radius.l, padding: space.l, gap: space.s, opacity: active ? 1 : 0.6 }, featured ? raisedShadow : cardShadow]}>
      <Row style={{ gap: space.m }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: featured ? t.primary : t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={active ? 'plus-circle' : 'slash'} size={20} color={t.dark} />
        </View>
        <View style={{ flex: 1 }}>
          <T weight="700" size={17} style={[{ color: fg }, !active ? { textDecorationLine: 'line-through' } : null]}>{`${m.name} ${m.dose}`}</T>
          <T size={12} style={{ color: sub }}>{m.purpose || 'Medicine'}</T>
        </View>
        {featured ? (
          <View style={{ backgroundColor: t.primary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <T size={11} weight="700" style={{ color: t.dark }}>Next dose</T>
          </View>
        ) : (
          <Chip small tone={active ? 'good' : m.status === 'stopped' ? 'bad' : 'soft'} label={m.status} />
        )}
      </Row>
      {active ? (
        <View style={{ backgroundColor: featured ? 'rgba(255,255,255,0.14)' : t.surfaceAlt, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: 10, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Icon name="clock" size={13} color={fg} />
          <T size={13} weight="600" style={{ color: fg }}>{[m.freq, m.timing].filter(Boolean).join(' · ') || 'As directed'}</T>
        </View>
      ) : null}
      <T size={12} style={{ color: sub }}>{`${m.doctor} · ${fmtDate(m.ts)}${endsAt && active ? ` · ends ${fmtDate(endsAt)}` : ''}`}</T>
      {m.note ? (
        <Row>
          <Icon name={active ? 'check' : 'corner-down-right'} size={12} color={sub} />
          <T size={12} style={{ color: sub }}>{m.note}</T>
        </Row>
      ) : null}
    </View>
  );
}

/** The family member's phone: what the synced medicine list and conflict alert look like on the other side. */
function FamilyPreview({ meds, alertText }: { meds: MedRow[]; alertText: string | null }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 280, maxWidth: '100%', backgroundColor: t.dark, borderRadius: 40, padding: 8, ...raisedShadow }}>
        <View style={{ backgroundColor: t.bg, borderRadius: 32, overflow: 'hidden', paddingBottom: space.l }}>
          <PeachWash height={150} />

          <View style={{ position: 'absolute', top: 9, alignSelf: 'center', width: 64, height: 16, borderRadius: 8, backgroundColor: t.dark }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22, paddingTop: 11 }}>
            <T size={12} weight="600">9:41</T>
            <Row style={{ gap: 5 }}>
              <Icon name="wifi" size={12} color={t.dark} />
              <Icon name="battery" size={13} color={t.dark} />
            </Row>
          </View>

          <View style={{ paddingHorizontal: space.m, paddingTop: space.l, gap: space.m }}>
            <View style={{ gap: 2 }}>
              <T size={11} weight="600" color="sub">{`${FAMILY.name}’s family circle`}</T>
              <T size={20} weight="700" track={-0.02}>Papa’s medicines</T>
            </View>

            {alertText ? (
              <View style={{ backgroundColor: t.card, borderRadius: radius.m, padding: space.m, flexDirection: 'row', gap: space.s, ...cardShadow }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.badSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="alert-triangle" size={15} color={t.bad} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T size={12} weight="700" color="bad">Medicine conflict</T>
                    <T size={10} color="faint">now</T>
                  </Row>
                  <T size={11} color="sub" numberOfLines={3} style={{ lineHeight: 15 }}>{alertText}</T>
                </View>
              </View>
            ) : null}

            <View style={{ backgroundColor: t.card, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s, ...cardShadow }}>
              {meds.length ? (
                meds.map((m, i) => (
                  <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus-circle" size={13} color={t.dark} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <T size={12} weight="600" numberOfLines={1}>{`${m.name} ${m.dose}`.trim()}</T>
                      <T size={10} color="sub" numberOfLines={1}>{[m.freq, m.timing].filter(Boolean).join(' · ') || 'As directed'}</T>
                    </View>
                  </View>
                ))
              ) : (
                <T size={11} color="sub" style={{ paddingVertical: space.s }}>Nothing synced yet</T>
              )}
            </View>

            <Row style={{ justifyContent: 'center', gap: 5 }}>
              <Icon name="lock" size={10} color={t.faint} />
              <T size={10} color="faint">Only medicines and alerts are shared</T>
            </Row>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function MedsScreen() {
  const t = useTheme();
  const meds = useLoad(listMeds);
  const alerts = useLoad(listAlerts);
  const stats = useLoad(memoryStats);
  const [syncing, setSyncing] = useState(false);

  const all = meds.data ?? [];
  const active = all.filter((m) => m.status === 'active');
  const history = all.filter((m) => m.status !== 'active');
  const top = alerts.data?.[0];

  const sync = async () => {
    setSyncing(true);
    try {
      await queueMedSync();
      await syncNow();
      toast('Medicine list synced to family');
    } catch {
      toast('Offline: queued, will sync when connected', 'warn');
    } finally {
      setSyncing(false);
      void stats.reload();
    }
  };

  return (
    <Screen>
      {(alerts.data ?? []).map((a, i) => (
        <View key={i} style={{ backgroundColor: a.interaction.severity === 'high' ? t.badSoft : t.warnSoft, borderRadius: 14, padding: space.m, gap: 4 }}>
          <Row>
            <Icon name="alert-triangle" size={16} color={a.interaction.severity === 'high' ? t.bad : t.warn} />
            <T weight="700" color={a.interaction.severity === 'high' ? 'bad' : 'warn'}>{`${a.medA.name} + ${a.medB.name}`}</T>
          </Row>
          <T size={12}>{a.interaction.message}</T>
          <Sub>{`${a.medA.name}: ${a.medA.doctor} · ${a.medB.name}: ${a.medB.doctor}`}</Sub>
        </View>
      ))}

      <SectionTitle icon="activity">{`Taking now (${active.length})`}</SectionTitle>
      {active.length ? active.map((m, i) => <MedCard key={m.id} m={m} featured={i === 0} />) : <Sub>No medicines yet. Add a visit first.</Sub>}

      {history.length ? <SectionTitle icon="archive">Changed or stopped</SectionTitle> : null}
      {history.map((m) => (
        <MedCard key={m.id} m={m} />
      ))}

      <SectionTitle icon="users">Shared with family</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T weight="700">{`${FAMILY.name} (${FAMILY.relation})`}</T>
            <Sub>Gets the medicine list and conflict alerts only</Sub>
          </View>
          <Chip small tone={stats.data?.pending ? 'warn' : 'good'} label={stats.data?.pending ? `${stats.data.pending} queued` : 'in sync'} />
        </Row>
        <Row>
          <Icon name="lock" size={12} color={t.sub} />
          <Sub>Recordings, transcripts and your questions never leave this phone.</Sub>
        </Row>
        <Button title="Sync now" kind="soft" busy={syncing} onPress={sync} />
      </Card>
      <Eyebrow>{`How it looks on ${FAMILY.name}’s phone`}</Eyebrow>
      <FamilyPreview meds={active} alertText={top ? `${top.medA.name} + ${top.medB.name}: ${top.interaction.message}` : null} />

      <SectionTitle icon="cloud">Medicine knowledge</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T weight="600">Interaction database</T>
          <Chip small label="v2026.09" />
        </Row>
        <Sub>2,384 interaction pairs · updated from cloud 2 days ago · cached on this phone for offline checks</Sub>
      </Card>
    </Screen>
  );
}
