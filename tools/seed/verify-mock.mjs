// Starts the mock server and checks its responses against the shared zod schemas, the same ones the phone
// uses to validate them. Run: node tools/seed/verify-mock.mjs
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { loadTs, root } from './_load.mjs';

const S = loadTs(join(root, 'packages/shared/src/index.ts'));
const PORT = 8799;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [join(root, 'tools/mock-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const call = async (method, path, { body, token } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const reg = await call('POST', '/v1/devices/register', { body: {} });
  check('register matches RegisterResponseSchema', S.RegisterResponseSchema.safeParse(reg.data).success);
  const token = reg.data.token;
  check('unknown token is 401', (await call('GET', '/v1/knowledge?group=IN&since=0', { token: 'nope' })).status === 401);

  const fact = (key, extra = {}) => ({ kind: 'place_fact', group: 'zone:demo', key, value: '4417', text: `Gate code 4417 at ${key}`, lat: 12.9352, lon: 77.6146, ...extra });
  const post = await call('POST', '/v1/contributions', { token, body: { facts: [fact('a-place:gate_code'), fact('REJECTME:gate_code'), fact('c-place:gate_code'), fact('a-place:gate_code')] } });
  check('contributions matches ContributionResponseSchema', S.ContributionResponseSchema.safeParse(post.data).success);
  check('accepted / rejected indexes', JSON.stringify(post.data.accepted) === '[0,2]' && post.data.rejected.length === 2, JSON.stringify(post.data));
  check('same fact twice from one device is a duplicate', post.data.rejected.some((r) => r.idx === 3 && r.reason === 'duplicate'));
  check('invalid payload is 400', (await call('POST', '/v1/contributions', { token, body: { facts: [{ kind: 'bad' }] } })).status === 400);

  const k1 = await call('GET', '/v1/knowledge?group=zone:demo&since=0&limit=500', { token });
  const parsed = S.KnowledgeResponseSchema.safeParse(k1.data);
  check('knowledge matches KnowledgeResponseSchema (384-d vectors)', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues[0]));
  check('seeded place facts are served', k1.data.points.length === 3 && k1.data.points.some((p) => p.key === 'demo-1:gate_code'));
  check('other groups are empty', (await call('GET', '/v1/knowledge?group=zone:other&since=0', { token })).data.points.length === 0);

  await call('POST', '/_admin/seed', { body: { n: 1200, group: 'zone:demo' } });
  let since = k1.data.next, total = 0, pages = 0;
  for (;;) {
    const r = await call('GET', `/v1/knowledge?group=zone:demo&since=${since}&limit=500`, { token });
    total += r.data.points.length + r.data.tombstones.length; pages++;
    since = r.data.next ?? since;
    if (r.data.points.length + r.data.tombstones.length < 500) break;
  }
  check('1200 seeded points page as 500 + 500 + 200', total === 1200 && pages === 3, `${total} in ${pages} pages`);

  await call('POST', '/_admin/reset', { body: {} });
  const t = await call('GET', `/v1/knowledge?group=zone:demo&since=${since}&limit=500`, { token });
  check('deleted points come back as tombstones (ids only)', t.data.tombstones.length === 500 && t.data.points.length === 0 && t.data.next > since);

  check('heartbeat', (await call('POST', '/v1/heartbeat', { token, body: { items: { sms: 3 }, pending: 1, blocked: 0 } })).status === 200);
  check('device deletion', (await call('DELETE', '/v1/devices/me', { token })).status === 200);
  check('token no longer valid after deletion', (await call('GET', '/v1/knowledge?group=IN&since=0', { token })).status === 401);
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
