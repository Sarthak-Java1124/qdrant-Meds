'use client';

import { useMemo, useState } from 'react';

import { Badge, Card, Empty, PageHeader, Segmented } from '@/components/ui';
import { describeEvent, EVENT_GROUPS } from '@/lib/aggregate';
import { useLive } from '@/lib/live';
import type { ServerEvent } from '@/lib/types';

export default function Activity() {
  const { events, state } = useLive();
  const [group, setGroup] = useState<string>('All');
  const [frozen, setFrozen] = useState<ServerEvent[] | null>(null);

  const source = frozen ?? events;
  const rows = useMemo(() => {
    const types = EVENT_GROUPS[group];
    return source.filter((e) => !types || types.length === 0 || types.includes(e.type)).slice(0, 200);
  }, [source, group]);

  return (
    <>
      <PageHeader
        eyebrow="Live activity"
        title="As it happens."
        note="Contributions, rejections, publications and deletions, streamed live."
        right={
          <div className="flex items-center gap-3">
            <Badge tone={state === 'live' ? 'good' : state === 'connecting' ? 'warn' : 'bad'}>{state === 'live' ? 'Streaming' : state}</Badge>
            <button
              onClick={() => setFrozen(frozen ? null : events)}
              className="border border-line-strong px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-lime-soft">
              {frozen ? 'Resume' : 'Pause'}
            </button>
          </div>
        }
      />
      <div className="mb-4">
        <Segmented<string> value={group} onChange={setGroup} options={Object.keys(EVENT_GROUPS).map((g) => ({ value: g, label: g }))} />
      </div>
      {frozen ? <p className="mb-3 font-mono text-[11px] text-warn">Paused: new events are still arriving in the background.</p> : null}

      <Card className="p-0">
        {rows.length ? (
          rows.map((e) => {
            const d = describeEvent(e);
            return (
              <div key={e.id} className="flex items-start gap-4 border-b border-line px-5 py-3 last:border-b-0">
                <span className="w-[72px] shrink-0 pt-0.5 font-mono text-[11px] text-faint">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
                <span className="w-32 shrink-0"><Badge tone={d.tone}>{d.label}</Badge></span>
                <span className="min-w-0 flex-1 break-words text-sm text-muted">{d.detail}</span>
              </div>
            );
          })
        ) : (
          <Empty title="No matching events" hint="Events appear here the moment a phone syncs, contributes, or is deleted." />
        )}
      </Card>
    </>
  );
}
