'use client';

import { Badge, Card, Empty, Eyebrow, PageHeader } from '@/components/ui';
import { timeAgo } from '@/lib/aggregate';
import { useConflicts, useNow } from '@/lib/hooks';

export default function Conflicts() {
  const { data, error } = useConflicts();
  const now = useNow(30_000);

  const resolved = data?.resolved ?? [];
  const open = data?.open ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Conflicts"
        title="Old code vs. new code."
        note="When two riders disagree about the same place, outcomes settle it — not a dispatcher."
      />
      {error ? <p className="mb-6 border-l-4 border-bad bg-bad-bg px-3 py-2 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p> : null}

      <Eyebrow className="mb-3">Open — waiting on more outcomes</Eyebrow>
      {open.length ? (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          {open.map((c) => (
            <Card key={`${c.placeId}|${c.slot}`} className="space-y-3 border-l-4 border-l-warn">
              <div className="min-w-0">
                <Eyebrow>{`${c.slot} · place ${c.placeId}`}</Eyebrow>
              </div>
              <div className="space-y-1.5">
                {c.values.map((v) => (
                  <div key={v.value} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-semibold">{v.value}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">{`${Math.round(v.confidence * 100)}% · ${v.successes}✓ ${v.failures}✗`}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="mb-8">
          <Empty title="No open conflicts" hint="A conflict appears here when two live values exist for the same place and slot, before outcomes have settled which one wins." />
        </Card>
      )}

      <Eyebrow className="mb-3">Resolved</Eyebrow>
      <Card className="p-0">
        {resolved.length ? (
          resolved.map((c) => (
            <div key={`${c.placeId}|${c.slot}|${c.resolvedAt}`} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="text-muted">{`${c.slot} · place ${c.placeId} · `}</span>
                  <span className="font-semibold line-through">{c.fromValue}</span>
                  <span className="text-muted"> → </span>
                  <span className="font-semibold">{c.toValue}</span>
                </div>
                <div className="text-xs text-muted">{`settled by ${c.settledByOutcomes} outcome${c.settledByOutcomes === 1 ? '' : 's'} · ${timeAgo(c.resolvedAt, now)}`}</div>
              </div>
              <Badge tone="good">Resolved</Badge>
            </div>
          ))
        ) : (
          <Empty title="Nothing resolved yet" hint="Once a conflict settles, it moves here with the old and new value." />
        )}
      </Card>
    </>
  );
}
