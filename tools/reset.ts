// Wipes the demo server between rehearsals: both Qdrant collections (contributions + knowledge), the devices, the daily
// caps, the outcomes log and the activity log. The phone's own "Reset demo" only clears the phone; this clears the
// cloud side.
//
//   node tools/reset.ts --yes            hard: drop everything
//   node tools/reset.ts --soft --yes     soft: first withdraw every published fact (tombstones), so phones that already
//                                        downloaded them remove them on their next sync, then wipe the rest
//
// The knowledge version counter is never reset, so a phone that synced before the reset can still receive new knowledge.
import { fail, helpText, makeApi, parseFlags, str } from './_cli.ts';

const KNOWN = {
  server: 'server URL (default http://127.0.0.1:8787)',
  'admin-key': 'admin key (default dev-admin-key, or $ADMIN_KEY)',
  soft: '(flag) withdraw published facts as tombstones instead of dropping them',
  yes: '(flag) actually do it; without this the tool only shows what would be wiped',
  help: '(flag) show this help',
};

const flags = parseFlags(process.argv.slice(2), KNOWN);
if (flags.help) {
  console.log(helpText('Usage: node tools/reset.ts [--soft] --yes [--server URL] [--admin-key KEY]', KNOWN));
  process.exit(0);
}

const api = makeApi(str(flags, 'server', 'http://127.0.0.1:8787'), str(flags, 'admin-key', process.env.ADMIN_KEY ?? 'dev-admin-key'));
const mode = flags.soft ? 'soft' : 'hard';

const stats = await api.get('/v1/admin/stats', { admin: true });
if (stats.status === 401) fail('The admin key was refused (401). Pass --admin-key.');
if (stats.status !== 200) fail(`Unexpected ${stats.status} from ${api.server}/v1/admin/stats`);
console.log(`${api.server}: ${stats.data.devices} devices, ${stats.data.contributionsToday} contributions today, ${stats.data.knowledge} published facts, ${stats.data.tombstones} tombstones`);

if (!flags.yes) {
  console.log(`\nDry run. This would ${mode === 'soft' ? 'withdraw the published facts as tombstones, then delete' : 'delete'} all of the above. Add --yes to do it.`);
  process.exit(0);
}

const res = await api.post('/v1/admin/reset', { mode }, { admin: true });
if (res.status === 404) fail('This server has no /v1/admin/reset. Restart it from the current code (apps/server).');
if (res.status !== 200) fail(`Reset failed: ${res.status} ${JSON.stringify(res.data)}`);
console.log(`Reset (${res.data.mode}): removed ${res.data.devices} devices${mode === 'soft' ? `, withdrew ${res.data.withdrawn} published facts` : ''}.`);

const after = await api.get('/v1/admin/stats', { admin: true });
console.log(`Now: ${after.data.devices} devices, ${after.data.contributionsToday} contributions today, ${after.data.knowledge} published, ${after.data.tombstones} tombstones, version ${after.data.version}.`);
console.log('\nOn the phone: Settings -> Reset demo (or `adb shell pm clear com.sarthak.hive` for a truly fresh install), then reconnect.');
