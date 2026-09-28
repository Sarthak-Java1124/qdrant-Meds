import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app';
import { loadConfig } from './config';
import { Crowd } from './crowd';
import { createOnnxEmbed } from './embed/onnx';
import { EventBus } from './events';
import { SqliteMeta } from './meta/sqlite';
import { MemoryStore } from './store/memory';
import { QdrantStore } from './store/qdrant';

const serverDir = fileURLToPath(new URL('..', import.meta.url));

try {
  process.loadEnvFile(resolve(serverDir, '.env'));
} catch {
  // .env is optional
}

const config = loadConfig();
const modelDir = resolve(serverDir, config.modelDir);
for (const f of ['model_quantized.onnx', 'vocab.txt']) {
  if (!existsSync(resolve(modelDir, f))) {
    console.error(`Missing ${f} in ${modelDir}. Put the MiniLM model files there (see models/) or set MODEL_DIR.`);
    process.exit(1);
  }
}

const meta = new SqliteMeta(resolve(config.dbPath));
const store = config.store === 'memory' ? new MemoryStore() : new QdrantStore(config.qdrantUrl);
try {
  await store.init();
} catch (e) {
  console.error(`Could not initialise the ${config.store} store${config.store === 'qdrant' ? ` at ${config.qdrantUrl}. Is Qdrant running? (docker run -p 6333:6333 qdrant/qdrant, or STORE=memory)` : ''}`);
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const embed = await createOnnxEmbed(modelDir);
const bus = new EventBus(meta);
const crowd = new Crowd({ store, meta, embed, config, bus });
const app = buildApp({ config, crowd, meta, store, bus });

if (config.adminKey === 'dev-admin-key') console.warn('ADMIN_KEY is the default. Fine for a local demo; change it otherwise.');
if (config.store === 'memory') console.warn('STORE=memory: contributions and knowledge are lost when the server stops.');

await app.listen({ port: config.port, host: config.host });
console.log(`LastMeter server on http://${config.host}:${config.port}  (store=${config.store}, dailyCap=${config.dailyCap})`);
