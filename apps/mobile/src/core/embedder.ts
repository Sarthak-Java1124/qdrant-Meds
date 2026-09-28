import { WordPiece } from '@hive/shared';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

const DIM = 384;

let session: InferenceSession | undefined;
let tok: WordPiece | undefined;

export async function initEmbedder() {
  if (session && tok) return;
  const [model] = await Asset.loadAsync(require('../../assets/models/model_quantized.onnx'));
  const [vocab] = await Asset.loadAsync(require('../../assets/models/vocab.txt'));
  session = await InferenceSession.create(model.localUri!.replace('file://', ''));
  tok = new WordPiece(new File(vocab.localUri!).textSync());
}

export function tokenize(text: string, maxLen = 128) {
  if (!tok) throw new Error('embedder not initialised');
  return tok.encode(text, maxLen);
}

let initializing: Promise<void> | null = null;

export async function embed(text: string, maxLen = 128): Promise<number[]> {
  // background sync and the Leak Check can be the first to need the model
  if (!session || !tok) await (initializing ??= initEmbedder().finally(() => (initializing = null)));
  if (!session || !tok) throw new Error('embedder not initialised');
  const { ids, mask } = tok.encode(text, maxLen);
  const n = ids.length;
  const big = (a: number[]) => BigInt64Array.from(a.map(BigInt));
  const out = await session.run({
    input_ids: new Tensor('int64', big(ids), [1, n]),
    attention_mask: new Tensor('int64', big(mask), [1, n]),
    token_type_ids: new Tensor('int64', new BigInt64Array(n), [1, n]),
  });
  const h = out['last_hidden_state'].data as Float32Array;
  const v = new Array<number>(DIM).fill(0);
  for (let t = 0; t < n; t++) for (let d = 0; d < DIM; d++) v[d] += h[t * DIM + d];
  for (let d = 0; d < DIM; d++) v[d] /= n; // mean pool
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm); // L2 normalise
}

export function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // vectors are already unit length
}
