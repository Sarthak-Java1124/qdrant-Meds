# react-native-qdrant-edge API notes (Spike A)

Source: package README, v0.4.0 (rust-dd/react-native-qdrant-edge). Peer dep: `react-native-nitro-modules`.
Status: **documented, not yet verified on device** — update each line after running Spike A.
Prebuilt binaries: Android arm64 + x86_64, iOS arm64 + simulator. No Rust toolchain needed. All calls are **synchronous** (JSI/Nitro).

## Differences from the masterplan snippets

| Masterplan | Actual |
| --- | --- |
| `sparse_vectors: { s: { modifier: 'Idf' } }` | `modifier: 'idf'` (lowercase) |
| `search({ vector: { name: 'd', vector: [...] } })` | `search({ vector: [...], using: 'd' })` |
| sparse search shape unknown | `search({ vector: { indices, values }, using: 's' })` |
| hybrid via own RRF only | built-in `query({ prefetch: [...], query: { fusion: 'rrf' } })` exists; own RRF still fine |
| snapshots unknown | `unpackSnapshot`, `snapshotManifest`, `recoverPartialSnapshot` exist → Phase 10.9 is possible |
| `FS.documentDirectory` | Expo SDK 57: `Paths.document` / `new File(...)`; legacy at `expo-file-system/legacy` |

## Storage size

Qdrant Edge preallocates sparse files (two 4 MiB WAL files, mmap'd storage). `expo-file-system`'s
`Directory.size` reports the *apparent* size (~129 MB for a 6-point shard). Real disk use measured with
`adb shell run-as com.sarthak.hive du -k files/private` was ~281 KB. Use `du` for the Phase 17 size check.

## Lifecycle

**Verified on device:** `createShard(path)` fails with `failed to create WAL directory ... No such file or directory`
unless `path` already exists. Create the folder first (`new Directory(...).create({ idempotent: true })`).
A shard exists when `<path>/wal` exists. Use that to choose `loadShard` vs `createShard`.

```ts
import { createShard, loadShard, mobileWalDefaults } from 'react-native-qdrant-edge'
const shard = createShard(path, config)   // path without file://
const shard = loadShard(path, config?)
shard.flush()      // persist, throws on failure
shard.optimize()   // merge segments + build HNSW
shard.info()       // { points_count, segments_count, indexed_vectors_count, payload_schema }
shard.close()      // flush + release
```

Config: `vectors: { name: { size, distance: 'Cosine'|'Euclid'|'Dot'|'Manhattan', on_disk? } }`
(default unnamed vector key is `''`), `sparse_vectors: { name: { modifier: 'idf' } }`,
`on_disk_payload`, `hnsw_config`, `optimizers`, `wal_options` (use `mobileWalDefaults()`), `max_search_threads`.

## Types worth knowing (from lib/types.d.ts)

- `ScoredPoint.id` is a **string** even when the point ID was a number; `scroll().next_offset` is a string too. `src/core/shards.ts` converts numeric strings back to numbers.
- `count(filter?)` takes a plain filter object (or nothing).
- `SparseVectorParams.modifier` is `'none' | 'idf'`.
- `optimizers.prevent_unoptimized: true` makes new points invisible to search until `optimize()`. We leave it off.
- Sparse `{ indices, values }` goes in the named-vector map on upsert: `vector: { d: [...], s: { indices, values } }`.

## Points

```ts
shard.upsert([{ id: 1, vector: { d: [...], s: { indices: [42, 7], values: [1, 1] } }, payload: {...} }])
// single default vector: vector: [..]   |  id: u64 number or UUID string
shard.deletePoints([1, 'uuid'])
shard.retrieve([1], { withPayload: true, withVector: false })
shard.scroll({ limit, with_payload, order_by?: { key, direction }, filter? })  // -> { points, next_offset }
shard.count(filter?)
shard.facet({ key, limit, filter?, exact? })   // -> { hits: [{ value, count }] }
shard.setPayload(id, {...}) / overwritePayload / deletePayload(id, keys) / clearPayload({ filter })
shard.createFieldIndex('source', 'keyword')    // keyword|integer|float|geo|text|bool|datetime
shard.deleteFieldIndex('source')
```

## Search

```ts
shard.search({ vector, using: 'd', limit, offset, with_payload, with_vector, score_threshold, filter, params })
shard.search({ vector: { indices, values }, using: 's', limit })      // sparse
shard.query({ prefetch: [{ query, using, limit }, ...], query: { fusion: 'rrf' | 'dbsf', k?, weights? }, limit, with_payload })
shard.queryGroups({ query, group_by, limit, group_size })
shard.searchMatrix({ sample, limit, using, filter })                  // on-device clustering/dedup
```

Built-in BM25: `const bm25 = createBm25({ language: 'english' }); bm25.embedQuery('text'); bm25.close()`.
We use our own hashed sparse encoder in `@hive/shared` so device and server match exactly.

Filter: `{ must, should, must_not, min_should }` with conditions
`{ key, match: { value } | { any: [...] } | { text } | { prefix } }`, `{ key, range: { gte, lte, gt, lt } }`,
`{ has_id }`, `{ is_empty }`, `{ is_null }`.

## Snapshots (for Phase 10.9 bootstrap)

```ts
unpackSnapshot('/path/snapshot.tar', '/tmp/unpacked')
const current = shard.snapshotManifest()
recoverPartialSnapshot(shard.path, current, '/tmp/unpacked', incomingManifest)
```

## Errors

`asQdrantError(err)` → `{ operation, cause }`.

## Verified on device

- [ ] createShard / loadShard / count survives restart
- [ ] dense search with `using`
- [ ] sparse search
- [ ] hybrid `query` with `fusion: 'rrf'`
- [ ] field indexes + filtered search (`match.value`, `match.any`)
- [ ] scroll / info / optimize / flush / close
- [ ] `createBm25` works (not required)
