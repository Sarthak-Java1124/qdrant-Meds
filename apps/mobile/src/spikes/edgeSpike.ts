import { Directory, Paths } from 'expo-file-system';
import { createBm25, createShard, loadShard } from 'react-native-qdrant-edge';

export type Log = (msg: string) => void;

// Spike A: Qdrant Edge on the phone. Every step is wrapped so one failure
// doesn't hide the rest. Run twice (kill the app in between) to prove persistence.
export async function edgeSpike(log: Log) {
  const dir = new Directory(Paths.document, 'spike_shard');
  const path = dir.uri.replace('file://', '').replace(/\/$/, '');
  // Qdrant Edge creates <path>/wal but not <path> itself, so the folder must exist first.
  // A populated `wal` subfolder means a shard was already created here.
  const existed = new Directory(dir, 'wal').exists;
  if (!dir.exists) dir.create({ idempotent: true });
  log(`shard path: ${path} (existed before: ${existed})`);

  const step = async <T>(name: string, fn: () => T | Promise<T>) => {
    try {
      const r = await fn();
      log(`OK   ${name}: ${r === undefined ? '' : JSON.stringify(r)}`);
      return r;
    } catch (e) {
      log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };

  const shard = existed
    ? loadShard(path)
    : createShard(path, {
        vectors: { d: { size: 4, distance: 'Cosine' } },
        sparse_vectors: { s: { modifier: 'idf' } },
      });

  await step('count on open (persistence check)', () => shard.count());

  await step('upsert', () =>
    shard.upsert([
      {
        id: 1,
        vector: { d: [0.1, 0.2, 0.3, 0.4], s: { indices: [11, 22], values: [1, 1] } },
        payload: { source: 'sms', ts: 1, t: 'food' },
      },
      {
        id: 2,
        vector: { d: [0.9, 0.1, 0.0, 0.1], s: { indices: [33, 44], values: [1, 1] } },
        payload: { source: 'chat', ts: 2, t: 'travel' },
      },
    ]),
  );

  await step('dense search (using:"d")', () =>
    shard.search({ vector: [0.1, 0.2, 0.3, 0.4], using: 'd', limit: 2, with_payload: true }),
  );

  await step('sparse search (using:"s")', () =>
    shard.search({ vector: { indices: [33], values: [1] }, using: 's', limit: 2, with_payload: true }),
  );

  await step('hybrid query fusion:rrf', () =>
    shard.query({
      prefetch: [
        { query: [0.1, 0.2, 0.3, 0.4], using: 'd', limit: 20 },
        { query: { indices: [33], values: [1] }, using: 's', limit: 20 },
      ],
      query: { fusion: 'rrf' },
      limit: 5,
      with_payload: true,
    }),
  );

  await step('createFieldIndex source/keyword', () => shard.createFieldIndex('source', 'keyword'));
  await step('createFieldIndex ts/integer', () => shard.createFieldIndex('ts', 'integer'));

  await step('filtered search source=sms', () =>
    shard.search({
      vector: [0.5, 0.5, 0.5, 0.5],
      using: 'd',
      limit: 5,
      with_payload: true,
      filter: { must: [{ key: 'source', match: { value: 'sms' } }] },
    }),
  );

  await step('filtered search source any [chat,journal]', () =>
    shard.search({
      vector: [0.5, 0.5, 0.5, 0.5],
      using: 'd',
      limit: 5,
      filter: { must: [{ key: 'source', match: { any: ['chat', 'journal'] } }] },
    }),
  );

  await step('scroll', () => shard.scroll({ limit: 10, with_payload: true }));
  await step('info', () => shard.info());
  await step('built-in bm25 embedQuery', () => {
    const bm25 = createBm25({ language: 'english' });
    const q = bm25.embedQuery('train ticket PNR 4521367890');
    bm25.close();
    return q;
  });
  await step('optimize', () => shard.optimize());
  await step('flush', () => shard.flush());
  await step('close', () => shard.close());

  const again = await step('reopen + count', () => loadShard(path).count());
  log(`RELOAD COUNT ${again} — kill the app and run again: "count on open" must be 2`);
}
