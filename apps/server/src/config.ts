import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  STORE: z.enum(['qdrant', 'memory']).default('qdrant'),
  QDRANT_URL: z.string().default('http://localhost:6333'),
  DAILY_CAP: z.coerce.number().int().min(1).default(50),
  REGISTER_PER_HOUR: z.coerce.number().int().min(1).default(30),
  ADMIN_KEY: z.string().min(1).default('dev-admin-key'),
  DB_PATH: z.string().default('./server.db'),
  MODEL_DIR: z.string().default('../../models'),
});

export interface Config {
  port: number;
  host: string;
  store: 'qdrant' | 'memory';
  qdrantUrl: string;
  dailyCap: number;
  registerPerHour: number;
  adminKey: string;
  dbPath: string;
  modelDir: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = Env.parse(env);
  return {
    port: e.PORT,
    host: e.HOST,
    store: e.STORE,
    qdrantUrl: e.QDRANT_URL,
    dailyCap: e.DAILY_CAP,
    registerPerHour: e.REGISTER_PER_HOUR,
    adminKey: e.ADMIN_KEY,
    dbPath: e.DB_PATH,
    modelDir: e.MODEL_DIR,
  };
}

/** Test-friendly defaults with optional overrides. */
export function testConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig({}), store: 'memory', dbPath: ':memory:', ...over };
}
