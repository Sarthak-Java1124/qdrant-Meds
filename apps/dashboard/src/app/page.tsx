'use client';

import Link from 'next/link';

import { Badge, Card, Empty, PageHeader, SectionTitle, Sparkline, Stat } from '@/components/ui';
import { deletionEffects, describeEvent, perMinute, timeAgo } from '@/lib/aggregate';
import { useNow, useOverview, useStats } from '@/lib/hooks';
import { useLive } from '@/lib/live';

export default function Overview() {
  const { data: s, error } = useStats();
  const { data: overview } = useOverview();
  const { events } = useLive();
  const now = useNow(5000);

  const series = perMinute(events, now, 30);
  const last30 = series.reduce((n, b) => n + b.count, 0);
  const published = s ? Object.values(s.knowledge).reduce((n, c) => n + c, 0) : 0;
  const effects = deletionEffects(events).slice(0, 4);
  const recent = events.filter((e) => e.type !== 'device_synced').slice(0, 8);

  return (
    <>
      <PageHeader eyebrow="Overview" title="The last 10 metres, learned." note="Counts and published place facts only. Never a rider's private notes." />
      {error ? <p className="mb-6 border-l-4 border-bad bg-bad-bg px-3 py-2 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p> : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat accent label="Stops today" value={overview?.stopsToday ?? '–'} hint="across all riders" />
        <Stat accent label="First-attempt success" value={overview ? `${overview.firstAttemptPct}%` : '–'} hint="delivered without a failed attempt first" />
        <Stat accent label="Avg. time at the door" value={overview ? `${overview.avgDoorSeconds}s` : '–'} hint="arrival to delivered/failed" />
        <Stat label="Registered devices" value={s?.devices ?? '–'} hint="random ids, no accounts" />
        <Stat label="Seen in the last 5 min" value={s?.activeDevices5m ?? '–'} />
        <Stat label="Published place facts" value={s ? published : '–'} hint={s ? `${s.contributionsToday} contributed today` : undefined} />
      </div>

      <SectionTitle right={<span className="font-mono text-[11px] text-muted">{`${last30} in the last 30 min`}</span>}>Live contributions per minute</SectionTitle>
      <Card>
        <Sparkline values={series.map((b) => b.count)} labelLeft="30 min ago" labelRight="now" />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Deletion effects</SectionTitle>
          <Card className="p-0">
            {effects.length ? (
              effects.map((d) => (
                <div key={`${d.ts}-${d.device}`} className="flex items-center justify-between border-b border-line px-5 py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-semibold">{`Device ${d.device} deleted`}</div>
                    <div className="text-xs text-muted">{`${d.removed} contributions removed · ${timeAgo(d.ts, now)}`}</div>
                  </div>
                  {d.unpublished ? <Badge tone="warn">{`${d.unpublished} unpublished`}</Badge> : <Badge>No facts affected</Badge>}
                </div>
              ))
            ) : (
              <Empty title="No deletions yet" hint="When a phone uses “Delete everything”, its place facts are withdrawn and show up here." />
            )}
          </Card>
        </div>
        <div>
          <SectionTitle right={<Link href="/activity" className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-lime-dark hover:underline">All activity</Link>}>Recent activity</SectionTitle>
          <Card className="p-0">
            {recent.length ? (
              recent.map((e) => {
                const d = describeEvent(e);
                return (
                  <div key={e.id} className="flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
                    <Badge tone={d.tone}>{d.label}</Badge>
                    <div className="min-w-0 flex-1 truncate text-xs text-muted">{d.detail}</div>
                    <div className="shrink-0 font-mono text-[10px] text-faint">{timeAgo(e.ts, now)}</div>
                  </div>
                );
              })
            ) : (
              <Empty title="Nothing yet" hint="Activity appears here live as riders sync." />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
