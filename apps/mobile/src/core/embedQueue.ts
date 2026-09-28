import { sparseEncode, type Source } from '@hive/shared';

import { getDb, logEvent, type ItemRow } from './db';
import { embed, initEmbedder } from './embedder';
import { upsertPrivate, type PrivatePointInput } from './shards';

export interface EmbedJob {
  id: number;
  text: string;
  source: Source;
  ts: number;
  ref: string;
}

export interface EmbedProgress {
  done: number;
  total: number;
}

const BATCH = 16;
const queue: EmbedJob[] = [];
const listeners = new Set<(p: EmbedProgress) => void>();
let running: Promise<void> | null = null;
let done = 0;
let total = 0;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

const emit = () => listeners.forEach((fn) => fn({ done, total }));

export function subscribeEmbedProgress(fn: (p: EmbedProgress) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function markEmbedded(ids: number[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE items SET embedded = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

async function run() {
  await initEmbedder();
  while (queue.length) {
    const batch = queue.splice(0, BATCH);
    const points: PrivatePointInput[] = [];
    for (const job of batch) {
      try {
        points.push({
          id: job.id,
          dense: await embed(job.text),
          sparse: sparseEncode(job.text),
          payload: { source: job.source, text: job.text, ts: job.ts, ref: job.ref },
        });
      } catch (e) {
        // stays embedded=0 and is retried by requeueUnembedded()
        await logEvent('embed', 'error', `item ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      done++;
      await yieldToUi(); // keep the UI thread responsive between items
    }
    try {
      await upsertPrivate(points);
      await markEmbedded(points.map((p) => p.id));
    } catch (e) {
      await logEvent('embed', 'error', `upsert batch: ${e instanceof Error ? e.message : String(e)}`);
    }
    emit();
  }
}

function start() {
  let failed = false;
  running = run()
    .catch((e) => {
      failed = true;
      return logEvent('embed', 'error', `worker: ${e instanceof Error ? e.message : String(e)}`);
    })
    .finally(() => {
      running = null;
      // Restart only for items queued while the worker was finishing, never after a failure
      // (that would loop forever when e.g. the model can't load). A later enqueue retries.
      if (queue.length && !failed) return start();
      done = 0;
      total = 0;
      emit();
    });
}

/** Adds an item to the embedding queue and starts the worker if it is idle. */
export function enqueueEmbed(job: EmbedJob) {
  queue.push(job);
  total++;
  if (!running) start();
}

/** Resolves once the queue is empty and the worker is idle. */
export async function drainEmbedQueue() {
  while (running) await running;
}

/** Recovers from crashes: any item with embedded=0 goes back on the queue. */
export async function requeueUnembedded(limit = 5000) {
  const db = await getDb();
  const rows = await db.getAllAsync<ItemRow>('SELECT * FROM items WHERE embedded = 0 ORDER BY id LIMIT ?', [limit]);
  rows.forEach((r) => enqueueEmbed({ id: r.id, text: r.text, source: r.source, ts: r.ts, ref: r.ext_id }));
  return rows.length;
}
