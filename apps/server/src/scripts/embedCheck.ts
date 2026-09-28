import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config';
import { createOnnxEmbed } from '../embed/onnx';

// Testing checklist B: prints what the server's embedder produces so it can be compared with the phone.
// On the phone, Spike B logs "vector[0..4]" for 'I paid for groceries'; those four numbers must match.
const serverDir = fileURLToPath(new URL('../..', import.meta.url));
const embed = await createOnnxEmbed(resolve(serverDir, loadConfig({}).modelDir));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

await embed('warm up');
const time = async (t: string) => {
  const t0 = performance.now();
  const v = await embed(t);
  return { v, ms: performance.now() - t0 };
};

const a = await time('I paid for groceries');
const b = await time('bought vegetables');
const c = await time('quantum chromodynamics lecture notes');
console.log(`vector[0..4] for "I paid for groceries": ${a.v.slice(0, 4).map((x) => x.toFixed(4)).join(', ')}`);
console.log(`norm ${Math.hypot(...a.v).toFixed(6)}, dim ${a.v.length}`);
console.log(`related   ${dot(a.v, b.v).toFixed(3)} (phone needs >= 0.5)`);
console.log(`unrelated ${dot(a.v, c.v).toFixed(3)} (phone needs < 0.3)`);
console.log(`latency   ${a.ms.toFixed(1)} ms per sentence`);

console.log('\nsimilarity between doubt paraphrases (tune DOUBT_SIM from these):');
const doubts = ['Why is BCNF stricter than 3NF?', 'BCNF vs 3NF, which is stricter and why', 'explain the difference between BCNF and 3NF', 'how does hashing work in database indexes'];
const vs = await Promise.all(doubts.map((d) => embed(d)));
for (let i = 1; i < doubts.length; i++) console.log(`  ${dot(vs[0], vs[i]).toFixed(3)}  "${doubts[0]}" vs "${doubts[i]}"`);
