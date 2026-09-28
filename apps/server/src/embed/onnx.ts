import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EMBED_DIM, WordPiece } from '@hive/shared';
import * as ort from 'onnxruntime-node';

import type { Embed } from './types';

/**
 * The same MiniLM-L6-v2 model, tokenizer and pooling as the phone (mean pool over tokens, L2 normalise), so
 * a sentence embeds to the same vector on both sides. Only the runtime differs (onnxruntime-node vs -react-native).
 */
export async function createOnnxEmbed(modelDir: string): Promise<Embed> {
  const session = await ort.InferenceSession.create(join(modelDir, 'model_quantized.onnx'));
  const tok = new WordPiece(readFileSync(join(modelDir, 'vocab.txt'), 'utf8'));

  return async (text) => {
    const { ids, mask } = tok.encode(text, 128);
    const n = ids.length;
    const big = (a: number[]) => BigInt64Array.from(a.map(BigInt));
    const out = await session.run({
      input_ids: new ort.Tensor('int64', big(ids), [1, n]),
      attention_mask: new ort.Tensor('int64', big(mask), [1, n]),
      token_type_ids: new ort.Tensor('int64', new BigInt64Array(n), [1, n]),
    });
    const h = out['last_hidden_state'].data as Float32Array;
    const v = new Array<number>(EMBED_DIM).fill(0);
    for (let t = 0; t < n; t++) for (let d = 0; d < EMBED_DIM; d++) v[d] += h[t * EMBED_DIM + d];
    for (let d = 0; d < EMBED_DIM; d++) v[d] /= n;
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  };
}
