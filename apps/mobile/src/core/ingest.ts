import type { Source } from '@hive/shared';

import { getDb, logEvent } from './db';
import { enqueueEmbed } from './embedQueue';

export interface IngestInput {
  source: Source;
  /** Stable per-record id, e.g. `sms:<id>` or `shot:<assetId>`. Makes re-ingestion idempotent. */
  extId: string;
  text: string;
  ts: number;
  meta?: Record<string, unknown>;
}

export interface IngestedItem extends IngestInput {
  id: number;
}

type ItemHook = (item: IngestedItem) => Promise<void> | void;

const parsers = new Map<Source, ItemHook>();

/** A source registers its structured parse here, if it needs one beyond the plain `items` row. */
export function registerParser(source: Source, parse: ItemHook) {
  parsers.set(source, parse);
}

/**
 * Events the Splitter reacts to. Anything that could lead to a shared fact must go through one of
 * these; nothing else may enqueue outbound data. LastMeter has exactly one: a captured rider note.
 */
export interface SplitterHooks {
  onItem?(item: IngestedItem): Promise<void> | void;
}

let splitterImpl: SplitterHooks = {};

/** The privacy layer registers the real Splitter here. Until then every event is a no-op. */
export function registerSplitter(impl: SplitterHooks) {
  splitterImpl = impl;
}

export const splitterHooks = {
  onItem: (item: IngestedItem) => splitterImpl.onItem?.(item),
};

async function safely(label: string, item: IngestedItem, fn: ItemHook | undefined | null) {
  if (!fn) return;
  try {
    await fn(item);
  } catch (e) {
    await logEvent(label, 'error', `${item.extId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The one entry point every source calls:
 * 1. insert into `items` (skipped if ext_id already exists)
 * 2. source-specific structured parse
 * 3. embed + upsert into the private shard (queued, batched)
 * 4. Splitter hook, which may enqueue shareable facts
 *
 * Returns null when the record was empty or already ingested.
 */
export async function ingest(input: IngestInput): Promise<IngestedItem | null> {
  const text = input.text.trim();
  if (!text) return null;

  const db = await getDb();
  const res = await db.runAsync(
    'INSERT OR IGNORE INTO items (source, ext_id, text, ts, meta, embedded) VALUES (?, ?, ?, ?, ?, 0)',
    [input.source, input.extId, text, input.ts, input.meta ? JSON.stringify(input.meta) : null],
  );
  if (res.changes === 0) return null;

  const item: IngestedItem = { ...input, text, id: res.lastInsertRowId };
  await safely(`parse:${item.source}`, item, parsers.get(item.source));
  enqueueEmbed({ id: item.id, text, source: item.source, ts: item.ts, ref: item.extId });
  await safely('splitter', item, splitterHooks.onItem);
  return item;
}

export async function ingestMany(inputs: IngestInput[], onProgress?: (done: number, total: number) => void) {
  let inserted = 0;
  for (let i = 0; i < inputs.length; i++) {
    if (await ingest(inputs[i])) inserted++;
    onProgress?.(i + 1, inputs.length);
  }
  return inserted;
}
