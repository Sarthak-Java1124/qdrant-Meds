import type { Source } from '@hive/shared';
import { useState } from 'react';
import { View } from 'react-native';

import { memoryClusters, type MemoryCluster } from '@/core/clusters';
import { crowdCounts, listCrowd } from '@/core/crowd';
import { getItemDetail, itemCounts, lastOptimize, listItems, searchMemory, type ItemDetail, type MemoryHit } from '@/core/memory';
import { optimizeIfNeeded, stats } from '@/core/shards';
import { clip, fmtDateTime, message, SOURCE_ICON } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { Button, Card, Chip, Divider, Empty, Field, ListRow, Row, Screen, SectionTitle, Segmented, Sheet, Sub, T } from '@/ui/kit';
import { toast } from '@/ui/toast';

type Mode = 'private' | 'crowd';

export default function MemoryScreen() {
  const [mode, setMode] = useState<Mode>('private');
  const [source, setSource] = useState<Source | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [cluster, setCluster] = useState<MemoryCluster | null>(null);

  const counts = useLoad(itemCounts);
  const items = useLoad(() => listItems(source, 40), [source]);
  const overview = useLoad(async () => ({ shards: stats(), crowd: crowdCounts(), crowdItems: listCrowd({ limit: 60 }), optimized: await lastOptimize() }));
  const clusters = useLoad(async () => memoryClusters());

  const search = async () => {
    const q = query.trim();
    if (!q) return setHits(null);
    setSearching(true);
    try {
      setHits(await searchMemory(q, source));
    } catch (e) {
      toast(message(e), 'bad');
    } finally {
      setSearching(false);
    }
  };

  const total = counts.data?.reduce((s, c) => s + c.total, 0) ?? 0;
  const rows = hits ? hits.map((h) => ({ item: h.item, score: h.score })) : (items.data ?? []).map((item) => ({ item, score: null as number | null }));
  const o = overview.data;

  return (
    <Screen>
      <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'private', label: `My notes (${total})` }, { value: 'crowd', label: `Zone pack (${o?.crowd.total ?? 0})` }]} />

      {mode === 'private' ? (
        <>
          <Card>
            <T weight="700">What is stored on this phone</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label={`All · ${total}`} selected={source === null} onPress={() => { setSource(null); setHits(null); }} />
              {counts.data?.map((c) => (
                <Chip key={c.source} label={`${c.source} · ${c.total}`} selected={source === c.source} onPress={() => { setSource(c.source); setHits(null); }} />
              ))}
            </Row>
            <Sub>{`Indexed for search: ${counts.data?.reduce((s, c) => s + (c.embedded ?? 0), 0) ?? 0} of ${total}`}</Sub>
          </Card>

          <Row>
            <View style={{ flex: 1 }}><Field placeholder="Search your memory" value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" /></View>
            <Button title="Search" onPress={search} busy={searching} />
          </Row>
          {hits ? <Sub>{`${hits.length} results by meaning and exact words`}</Sub> : null}

          <Card style={{ gap: 0 }}>
            {rows.length ? (
              rows.map(({ item, score }) => (
                <ListRow
                  key={item.id}
                  icon={SOURCE_ICON[item.source]}
                  title={clip(item.text, 90)}
                  subtitle={`${fmtDateTime(item.ts)}${score ? ` · match ${score.toFixed(2)}` : ''}${item.embedded ? '' : ' · not indexed yet'}`}
                  onPress={async () => setDetail(await getItemDetail(item.id))}
                />
              ))
            ) : (
              <Empty title={hits ? 'No matches' : 'Nothing stored yet'} hint="Notes you capture after a delivery appear here." />
            )}
          </Card>

          <SectionTitle>Memory Map</SectionTitle>
          <Card>
            <Sub>Themes found automatically across everything stored here — nothing is tagged by hand, and this never leaves the phone.</Sub>
            {clusters.data?.length ? (
              <Row style={{ flexWrap: 'wrap' }}>
                {clusters.data.map((c, i) => (
                  <Chip key={i} label={`${clip(c.label, 28)} · ${c.size}`} onPress={() => setCluster(c)} />
                ))}
              </Row>
            ) : (
              <Sub>Not enough stored yet to find a pattern. Keeps looking as you add more.</Sub>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <T weight="700">Zone pack — knowledge from other riders</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {Object.entries(o?.crowd.byKind ?? {}).map(([k, n]) => <Chip key={k} tone="good" label={`${k.replace('_', ' ')} · ${n}`} />)}
            </Row>
            <Sub>{Object.entries(o?.crowd.byGroup ?? {}).map(([g, n]) => `${g} (${n})`).join('  ·  ') || 'Nothing downloaded yet. Sync when online.'}</Sub>
          </Card>
          <SectionTitle>Newest</SectionTitle>
          <Card style={{ gap: 0 }}>
            {o?.crowdItems.length ? (
              o.crowdItems.map((c) => (
                <ListRow
                  key={String(c.id)}
                  icon="CRD"
                  title={c.payload.text}
                  subtitle={`${c.payload.group} · ${c.payload.status} · v${c.payload.version}`}
                />
              ))
            ) : (
              <Empty title="No zone pack yet" hint="Sync while online to receive what other riders have learned in this zone." />
            )}
          </Card>
        </>
      )}

      <SectionTitle>Storage</SectionTitle>
      <Card>
        <Sub>{`My notes: ${o?.shards.private.points ?? 0} points · Zone pack: ${o?.shards.crowd.points ?? 0} points`}</Sub>
        <Sub>{`Last optimised: private ${o?.optimized.private ? fmtDateTime(o.optimized.private) : 'never'}, crowd ${o?.optimized.crowd ? fmtDateTime(o.optimized.crowd) : 'never'}`}</Sub>
        <Sub>Optimising merges index segments to speed up search. It also runs automatically when the app goes to the background.</Sub>
        <Button
          small
          kind="soft"
          title="Optimise now"
          busy={optimizing}
          onPress={async () => {
            setOptimizing(true);
            await optimizeIfNeeded(true);
            setOptimizing(false);
            toast('Optimised');
            void overview.reload();
          }}
        />
      </Card>

      <Sheet visible={!!detail} title="Memory item" onClose={() => setDetail(null)}>
        {detail ? (
          <View style={{ gap: 10 }}>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label={detail.item.source} />
              <Chip tone={detail.item.embedded ? 'good' : 'warn'} label={detail.item.embedded ? 'indexed' : 'not indexed'} />
              <Chip label={`point ${detail.item.id}`} />
            </Row>
            <Sub>{fmtDateTime(detail.item.ts)}</Sub>
            <T selectable>{detail.item.text}</T>
            <Sub>Reference</Sub>
            <T size={12} color="sub" selectable>{detail.item.ext_id}</T>
            {Object.keys(detail.meta).length ? (
              <>
                <Sub>Extracted details</Sub>
                {Object.entries(detail.meta).map(([k, v]) => (
                  <T key={k} size={12} color="sub" selectable>{`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`}</T>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!cluster} title="A pattern in your memory" onClose={() => setCluster(null)}>
        {cluster ? (
          <View style={{ gap: 10 }}>
            <Sub>{`${cluster.size} items, found by meaning alone`}</Sub>
            {cluster.members.map((m, i) => (
              <View key={m.id} style={{ gap: 2 }}>
                {i ? <Divider /> : null}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Chip small label={m.source} />
                  <Sub>{fmtDateTime(m.ts)}</Sub>
                </Row>
                <T size={14}>{clip(m.text, 160)}</T>
              </View>
            ))}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
