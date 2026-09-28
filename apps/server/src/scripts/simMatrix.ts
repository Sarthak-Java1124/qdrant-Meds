import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config';
import { createOnnxEmbed } from '../embed/onnx';

// Prints the cosine similarity matrix for the texts given as arguments (or a default set of BCNF doubts),
// to choose DOUBT_SIM / TIP_SIM from real numbers.  Usage: tsx src/scripts/simMatrix.ts "text a" "text b" ...
const serverDir = fileURLToPath(new URL('../..', import.meta.url));
const embed = await createOnnxEmbed(resolve(serverDir, loadConfig({}).modelDir));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

const texts = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      'Why is BCNF stricter than 3NF?',
      'BCNF vs 3NF, which is stricter and why',
      'explain the difference between BCNF and 3NF',
      'What makes BCNF a stronger normal form than 3NF?',
      'Is BCNF stricter than third normal form? why',
      'How does hashing work in database indexes?',
    ];
const vs = await Promise.all(texts.map((t) => embed(t)));
console.log('       ' + texts.map((_, i) => String(i).padStart(6)).join(''));
vs.forEach((a, i) => console.log(`${String(i).padStart(3)}    ` + vs.map((b) => dot(a, b).toFixed(2).padStart(6)).join('') + `   ${texts[i]}`));
