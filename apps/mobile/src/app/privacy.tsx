import { useState } from 'react';
import { View } from 'react-native';

import { blockedLog, pendingCount } from '@/privacy';
import { debugTamperReceipt, ledgerStats, listReceipts, shareReceipts, verifyLedger, type Receipt } from '@/privacy/receipts';
import { getIdentity } from '@/sync';
import { clip, fmtDateTime, message } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { Button, Card, Chip, Divider, Empty, H2, Row, Screen, SectionTitle, Sheet, Stat, Sub, T } from '@/ui/kit';
import { toast } from '@/ui/toast';

const KIND: Record<string, string> = { place_fact: 'Place fact' };

function ReceiptCard({ r }: { r: Receipt }) {
  const [open, setOpen] = useState(false);
  return (
    <Card onPress={() => setOpen(!open)}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T weight="700">{`Receipt #${r.id}`}</T>
          <Sub>{`${fmtDateTime(r.ts)} · ${r.sent.length} shared · ${r.blocked.length} blocked or rewritten`}</Sub>
        </View>
        <T color="primary">{open ? '▲' : '▼'}</T>
      </Row>
      {open ? (
        <View style={{ gap: 8 }}>
          <Divider />
          <Sub>Exactly what left this phone</Sub>
          {r.sent.length ? r.sent.map((f, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Chip small tone="good" label={`${KIND[f.kind] ?? f.kind} · ${f.group}`} />
              <T size={13} selectable>{f.text}</T>
            </View>
          )) : <Sub>Nothing (only checks were recorded).</Sub>}
          {r.blocked.length ? <Sub>Stopped by the privacy check</Sub> : null}
          {r.blocked.map((b, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Chip small tone={b.action === 'block' ? 'bad' : b.action === 'rewrite' ? 'warn' : 'soft'} label={`${b.action === 'server_rejected' ? 'server rejected' : b.action} · ${KIND[b.kind] ?? b.kind}`} />
              <T size={13} color="sub">{b.reason}</T>
              {b.fact ? <T size={12} color="faint" selectable>{`It had already been sent: "${b.fact.text}"`}</T> : null}
            </View>
          ))}
          <T size={10} color="faint" selectable>{`hash ${r.hash.slice(0, 24)}…  prev ${r.prev_hash.slice(0, 12)}…`}</T>
        </View>
      ) : null}
    </Card>
  );
}

export default function PrivacyScreen() {
  const data = useLoad(async () => ({
    stats: await ledgerStats(),
    receipts: await listReceipts(50),
    blocked: await blockedLog(50),
    pending: await pendingCount(),
    identity: await getIdentity(),
  }));
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'verify' | 'export' | null>(null);
  const [tamperOpen, setTamperOpen] = useState(false);
  const [tampering, setTampering] = useState<number | null>(null);
  const d = data.data;

  const runVerify = async () => {
    setBusy('verify');
    try {
      const broken = await verifyLedger();
      setVerify(broken === null ? { ok: true, text: 'Verified. The ledger is intact: every receipt matches the one before it.' } : { ok: false, text: `Broken. Receipt #${broken} was changed after it was written.` });
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    setBusy('export');
    try {
      const out = await shareReceipts();
      toast(`Exported ${out.count} receipts${out.chainValid ? '' : ' (chain broken!)'}`, out.chainValid ? 'good' : 'bad');
    } catch (e) {
      toast(message(e), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const runTamper = async (id: number) => {
    setTampering(id);
    try {
      await debugTamperReceipt(id);
      setVerify(null);
      setTamperOpen(false);
      toast(`Receipt #${id} was quietly edited. Now tap "Verify integrity" below and watch it get caught.`, 'warn');
    } finally {
      setTampering(null);
    }
  };

  return (
    <Screen>
      <Card>
        <T mono upper size={10} weight="700" track={0.2} color="primary">The only thing the world knows about you</T>
        {d?.identity ? (
          <T mono selectable weight="700" size={18}>{d.identity.deviceId}</T>
        ) : (
          <T weight="600" color="sub">Not generated yet</T>
        )}
        <Sub>
          {d?.identity
            ? 'A random id and a random token, generated on this phone. No name, no email, no phone number, ever.'
            : 'Generated the moment this phone first talks to the server. Sync once online to see it.'}
        </Sub>
      </Card>

      <Card>
        <T weight="700">Is this record trustworthy?</T>
        <Sub>Each receipt is linked to the one before it by a hash, so editing or deleting any receipt breaks the chain and shows up here.</Sub>
        <Row>
          <Button title="Verify integrity" onPress={runVerify} busy={busy === 'verify'} />
          <Button kind="soft" title="Export JSON" onPress={runExport} busy={busy === 'export'} />
        </Row>
        {verify ? <T color={verify.ok ? 'good' : 'bad'} weight="600">{verify.text}</T> : null}
        {d && d.receipts.length > 0 ? (
          <>
            <Divider />
            <Sub>Don't take our word for it. Tamper with your own record and watch the check catch it.</Sub>
            <View style={{ alignItems: 'flex-start' }}>
              <Button small kind="ghost" title="Prove it to yourself" onPress={() => setTamperOpen(true)} />
            </View>
          </>
        ) : null}
      </Card>

      <Card>
        <H2>What has this app shared about me?</H2>
        <Row style={{ justifyContent: 'space-between' }}>
          {[
            [d?.stats.factsShared ?? 0, 'facts shared'],
            [d?.stats.factsBlocked ?? 0, 'blocked'],
            [d?.stats.factsRewritten ?? 0, 'rewritten'],
          ].map(([n, label]) => (
            <View key={String(label)} style={{ alignItems: 'center', flex: 1 }}>
              <Stat size={30}>{String(n)}</Stat>
              <Sub>{String(label)}</Sub>
            </View>
          ))}
        </Row>
        <Row style={{ justifyContent: 'space-between', backgroundColor: undefined }}>
          <T weight="600">Personal details shared</T>
          <Chip tone={(d?.stats.personalDetailsShared ?? 0) === 0 ? 'good' : 'bad'} label={String(d?.stats.personalDetailsShared ?? 0)} />
        </Row>
        <Sub>Counted by re-scanning every fact that was ever sent for amounts, phone numbers, UPI IDs, emails, account numbers and names. It is not assumed.</Sub>
        {d && d.pending > 0 ? <Sub>{`${d.pending} more facts passed the check and are waiting to sync.`}</Sub> : null}
      </Card>

      <SectionTitle>Receipts</SectionTitle>
      {d?.receipts.length ? d.receipts.map((r) => <ReceiptCard key={r.id} r={r} />) : (
        <Card><Empty title="Nothing has left this phone yet" hint="When you confirm a merchant category or share a doubt or tip, a receipt of exactly what was sent appears here." /></Card>
      )}

      <SectionTitle>Blocked on this phone</SectionTitle>
      <Card>
        {d?.blocked.length ? d.blocked.map((b, i) => (
          <View key={b.id} style={{ gap: 3 }}>
            {i ? <Divider /> : null}
            <Row style={{ justifyContent: 'space-between' }}>
              <Chip small tone={b.action === 'block' ? 'bad' : 'warn'} label={`${b.action === 'block' ? 'Blocked' : 'Rewritten'} · ${KIND[b.kind] ?? b.kind}`} />
              <Sub>{fmtDateTime(b.ts)}</Sub>
            </Row>
            <T size={13} weight="600">{b.reason}</T>
            <T size={12} color="faint">{`Only visible here: "${clip(b.text, 140)}"`}</T>
          </View>
        )) : <Sub>Nothing has been blocked.</Sub>}
      </Card>

      <Sheet visible={tamperOpen} title="Prove it to yourself" onClose={() => setTamperOpen(false)}>
        <Sub>Pick a receipt below. We'll quietly edit it, the way a compromised server or a bug might, without recomputing its hash. Then close this, tap "Verify integrity" and watch it name the exact one.</Sub>
        {d?.receipts.map((r) => (
          <Button
            key={r.id}
            kind="soft"
            title={`Tamper with Receipt #${r.id}`}
            busy={tampering === r.id}
            disabled={tampering !== null && tampering !== r.id}
            onPress={() => runTamper(r.id)}
          />
        ))}
      </Sheet>
    </Screen>
  );
}
