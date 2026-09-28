'use client';

import { Badge, Card, Empty, Eyebrow, PageHeader, SectionTitle, Stat } from '@/components/ui';
import { describeEvent, timeAgo } from '@/lib/aggregate';
import { useNow, useSafety } from '@/lib/hooks';
import { useLive } from '@/lib/live';

const REASONS: Record<string, string> = {
  pii: 'Contained a phone number, name, amount, account number, email or similar. Blocked even though the phone had already checked (a gate code is allowed through).',
  rate_limited: 'The device went over its daily contribution cap.',
  duplicate: 'The same fact had already been received from that device.',
  invalid: 'Malformed: an unknown kind, a bad zone, or text over the length limit.',
};

export default function Safety() {
  const { data, error } = useSafety();
  const { events } = useLive();
  const now = useNow(10_000);

  const rejected = Object.entries(data?.rejected24h ?? {}).sort((a, b) => b[1] - a[1]);
  const totalRejected = rejected.reduce((n, [, c]) => n + c, 0);
  const max = Math.max(1, ...rejected.map(([, c]) => c));
  const recent = events.filter((e) => e.type === 'rejected').slice(0, 10);

  return (
    <>
      <PageHeader eyebrow="Safety" title="What was kept out." note="The last 24 hours of rejected contributions." />
      {error ? <p className="mb-6 border-l-4 border-bad bg-bad-bg px-3 py-2 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat accent label="Contributions rejected" value={data ? totalRejected : '–'} hint="never reached the zone pack" />
      </div>

      <SectionTitle>Rejections by reason</SectionTitle>
      <Card className="space-y-5">
        {rejected.length ? (
          rejected.map(([reason, count]) => (
            <div key={reason} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Badge tone="bad">{reason.replace('_', ' ')}</Badge>
                <span className="font-mono text-sm font-bold">{count}</span>
              </div>
              <div className="h-1.5 bg-line">
                <div className="h-1.5 bg-bad" style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <div className="text-xs text-muted">{REASONS[reason] ?? 'Rejected by a server rule.'}</div>
            </div>
          ))
        ) : (
          <Empty title="Nothing rejected in the last 24 hours" hint="Facts with personal details, over-eager devices and duplicates are turned away and counted here." />
        )}
      </Card>

      <SectionTitle>How this is kept honest</SectionTitle>
      <Card>
        <ul className="grid gap-x-8 gap-y-2 text-sm text-muted md:grid-cols-2">
          <li>Every fact is published immediately as unverified — trust is earned by outcomes, not votes.</li>
          <li>A fact only becomes verified once real deliveries confirm it.</li>
          <li>A stale or wrong value is superseded once outcomes contradict it, not argued about.</li>
          <li>The server re-embeds every fact itself and never trusts a vector from a phone.</li>
          <li>Personal details are rejected server-side too, as a second line of defence.</li>
          <li>A daily cap per device, and an optional minimum device age before a fact counts.</li>
        </ul>
      </Card>

      <SectionTitle>Latest</SectionTitle>
      <Card className="p-0">
        {recent.length ? (
          recent.map((e) => {
            const d = describeEvent(e);
            return (
              <div key={e.id} className="flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
                <Badge tone={d.tone}>{d.label}</Badge>
                <div className="min-w-0 flex-1 text-sm text-muted">{d.detail}</div>
                <Eyebrow>{timeAgo(e.ts, now)}</Eyebrow>
              </div>
            );
          })
        ) : (
          <Empty title="Quiet" hint="Rejections appear here live." />
        )}
      </Card>
    </>
  );
}
