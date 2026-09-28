import { cosine, embed, initEmbedder, tokenize } from '@/core/embedder';

import type { Log } from './edgeSpike';

async function timed(text: string) {
  const t0 = Date.now();
  const v = await embed(text);
  return { v, ms: Date.now() - t0 };
}

// Spike B: on-device MiniLM embeddings. Pass: related >= 0.5, unrelated < 0.3, < 150 ms each.
export async function embedSpike(log: Log) {
  const t0 = Date.now();
  await initEmbedder();
  log(`init ${Date.now() - t0} ms`);

  const enc = tokenize('hello world');
  log(`tokens "hello world": ${JSON.stringify(enc.ids)} (expect 101 ... 102)`);
  log(`tokens unknown: ${JSON.stringify(tokenize('zzqxjkv').ids)} (expect 101,100,102)`);

  await embed('warm up'); // first run is slower
  const a = await timed('I paid for groceries');
  const b = await timed('bought vegetables');
  const c = await timed('quantum chromodynamics lecture notes');
  const related = cosine(a.v, b.v);
  const unrelated = cosine(a.v, c.v);
  log(`related   ${related.toFixed(3)} (need >= 0.5) ${related >= 0.5 ? 'PASS' : 'FAIL'}`);
  log(`unrelated ${unrelated.toFixed(3)} (need < 0.3) ${unrelated < 0.3 ? 'PASS' : 'FAIL'}`);

  const runs = [];
  for (let i = 0; i < 10; i++) runs.push((await timed('Rs 450 debited at Swiggy on UPI')).ms);
  const avg = runs.reduce((x, y) => x + y, 0) / runs.length;
  log(`latency avg ${avg.toFixed(0)} ms, max ${Math.max(...runs)} ms (need < 150) ${avg < 150 ? 'PASS' : 'FAIL'}`);
  log(`vector[0..4]: ${a.v.slice(0, 4).map((x) => x.toFixed(4)).join(', ')} (compare with server later)`);
}
