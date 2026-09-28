'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';

import { Badge, Card, Empty, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { timeAgo } from '@/lib/aggregate';
import { useNow, usePlaceMemory, usePlaceMemoryDetail } from '@/lib/hooks';
import type { FactStatus, PlaceFactRow, Slot } from '@/lib/types';

// Leaflet touches `window` at import time, so the map can only render on the client.
const PlaceMap = dynamic(() => import('@/components/PlaceMap').then((m) => m.PlaceMap), { ssr: false });

const STATUS_TONE: Record<FactStatus, 'good' | 'warn' | 'neutral'> = { verified: 'good', unverified: 'warn', superseded: 'neutral' };

function Timeline({ placeId }: { placeId: string }) {
  const { data, error, isFetching } = usePlaceMemoryDetail(placeId);
  const now = useNow(30_000);
  const [slotFilter, setSlotFilter] = useState<'all' | Slot>('all');

  const bySlot = useMemo(() => {
    const groups = new Map<Slot, PlaceFactRow[]>();
    for (const f of data?.facts ?? []) {
      if (slotFilter !== 'all' && f.slot !== slotFilter) continue;
      const arr = groups.get(f.slot) ?? [];
      arr.push(f);
      groups.set(f.slot, arr);
    }
    return groups;
  }, [data, slotFilter]);

  const slots = data ? Array.from(new Set(data.facts.map((f) => f.slot))) : [];

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Eyebrow>{`Place ${placeId}${isFetching ? ' · refreshing' : ''}`}</Eyebrow>
        {slots.length > 1 ? (
          <Segmented<'all' | Slot>
            value={slotFilter}
            onChange={setSlotFilter}
            options={[{ value: 'all', label: 'All' }, ...slots.map((s) => ({ value: s, label: s }))]}
          />
        ) : null}
      </div>
      {error ? <p className="text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p> : null}
      {[...bySlot.entries()].map(([slot, facts]) => (
        <div key={slot} className="mb-5 last:mb-0">
          <Eyebrow className="mb-2">{slot}</Eyebrow>
          <div className="space-y-2 border-l-2 border-line pl-4">
            {facts
              .slice()
              .sort((a, b) => a.observedAt - b.observedAt)
              .map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3">
                  <div className={f.status === 'superseded' ? 'text-sm text-muted line-through' : 'text-sm font-semibold'}>{f.text}</div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[10px] text-muted">{`${f.successes}✓ ${f.failures}✗ · ${timeAgo(f.lastSuccessAt ?? f.observedAt, now)}`}</span>
                    <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
      {!data?.facts.length ? <Empty title="No facts recorded here yet" /> : null}
    </Card>
  );
}

export default function PlaceMemory() {
  const { data, error, isFetching } = usePlaceMemory();
  const [selected, setSelected] = useState<string | null>(null);

  const places = data?.places ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Place Memory"
        title="What the zone has learned."
        note="Every marker is a stop. Green is verified by real deliveries, amber is unverified, grey is superseded."
        right={<span className="font-mono text-[11px] text-muted">{`${places.length} places${isFetching ? ' · refreshing' : ''}`}</span>}
      />
      {error ? <p className="mb-6 border-l-4 border-bad bg-bad-bg px-3 py-2 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p> : null}

      {places.length ? (
        <>
          <Card className="mb-6 p-0">
            <PlaceMap places={places} onSelect={setSelected} selectedId={selected} />
          </Card>
          {selected ? (
            <Timeline placeId={selected} />
          ) : (
            <Card>
              <Empty title="Click a marker" hint="Select a place on the map to see its full fact timeline." />
            </Card>
          )}
        </>
      ) : (
        <Card>
          <Empty title="Nothing learned yet" hint="Place facts appear here, with a marker on the map, as soon as a rider contributes one." />
        </Card>
      )}
    </>
  );
}
