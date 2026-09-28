'use client';

import { Badge, Card, Empty, Eyebrow, PageHeader } from '@/components/ui';
import { timeAgo } from '@/lib/aggregate';
import { useDevices, useNow } from '@/lib/hooks';

export default function Devices() {
  const { data, error } = useDevices();
  const now = useNow(10_000);
  const devices = data?.devices ?? [];

  return (
    <>
      <PageHeader eyebrow="Devices" title="Anonymous by design." note={data?.note ?? 'The cloud cannot see private memory by design; use the in-app Memory Inspector.'} />
      {error ? <p className="mb-4 border-l-4 border-bad bg-bad-bg px-3 py-2 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p> : null}

      <Card className="overflow-x-auto p-0">
        {devices.length ? (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-line-strong">
                {['Device', 'Joined', 'Last seen', 'Items by source', 'Pending', 'Blocked'].map((h) => (
                  <th key={h} className="px-4 py-3"><Eyebrow>{h}</Eyebrow></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const recent = now - d.last_seen < 5 * 60_000;
                const items = d.stats?.items ? Object.entries(d.stats.items) : [];
                return (
                  <tr key={d.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-bold">{d.id}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{timeAgo(d.created_at, now)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 ${recent ? 'bg-lime' : 'bg-line-strong'}`} />
                        <span className="text-xs text-muted">{timeAgo(d.last_seen, now)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {items.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {items.map(([source, n]) => <Badge key={source}>{`${source} ${n}`}</Badge>)}
                        </div>
                      ) : (
                        <span className="text-xs text-faint">not shared (opt-in)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono">{d.stats?.pending ?? '–'}</td>
                    <td className="px-4 py-3 font-mono">{d.stats?.blocked ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty title="No devices yet" hint="A phone appears here the first time it syncs. Only a short random id is shown." />
        )}
      </Card>
      <p className="mt-4 max-w-2xl text-xs text-muted">
        Counts come from the optional anonymous usage setting on each phone. They are numbers only: no messages, no merchants, no amounts, no names. Device ids are random and cannot be traced to a person.
      </p>
    </>
  );
}
