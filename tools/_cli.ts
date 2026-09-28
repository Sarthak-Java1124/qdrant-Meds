// Shared bits for the demo tools (riders.ts, reset.ts). Plain Node: no dependencies, only erasable TypeScript, so
// `node tools/riders.ts` runs directly on Node 22.18+ without tsx.

export type Flags = Record<string, string | true>;

/** `--name value`, `--name=value` and bare `--flag`. Anything else is a positional argument and is rejected. */
export function parseFlags(argv: string[], known: Record<string, string>): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`Unexpected argument "${a}". Try --help.`);
    const [name, inline] = a.slice(2).split(/=(.*)/s);
    if (!(name in known)) fail(`Unknown option --${name}. Try --help.`);
    const takesValue = !known[name].startsWith('(flag)');
    if (!takesValue) flags[name] = true;
    else if (inline !== undefined) flags[name] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else fail(`--${name} needs a value.`);
  }
  return flags;
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function num(flags: Flags, name: string, fallback: number, min = 0, max = Infinity) {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) fail(`--${name} must be a number between ${min} and ${max === Infinity ? 'infinity' : max}.`);
  return n;
}

export const str = (flags: Flags, name: string, fallback: string) => (typeof flags[name] === 'string' ? (flags[name] as string) : fallback);

export const helpText = (usage: string, known: Record<string, string>) =>
  `${usage}\n\nOptions:\n${Object.entries(known).map(([k, v]) => `  --${k.padEnd(12)} ${v.replace('(flag) ', '')}`).join('\n')}\n`;

export interface Api {
  server: string;
  get<T = any>(path: string, opts?: { token?: string; admin?: boolean }): Promise<{ status: number; data: T }>;
  post<T = any>(path: string, body: unknown, opts?: { token?: string; admin?: boolean }): Promise<{ status: number; data: T }>;
}

export function makeApi(server: string, adminKey: string): Api {
  const base = server.replace(/\/$/, '');
  const call = async (method: string, path: string, body: unknown, opts: { token?: string; admin?: boolean } = {}) => {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.admin ? { 'x-admin-key': adminKey } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      fail(`Cannot reach the server at ${base} (${e instanceof Error ? e.message : e}). Is it running? Use --server to point elsewhere.`);
    }
    return { status: res.status, data: (await res.json().catch(() => null)) as any };
  };
  return {
    server: base,
    get: (path, opts) => call('GET', path, undefined, opts),
    post: (path, body, opts) => call('POST', path, body, opts),
  };
}

/** Deterministic PRNG, so a rehearsal can be repeated exactly with the same --seed. */
export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
