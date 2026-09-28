// Checks the Leak Check's text logic offline: entity scan (phone, VPA, amount, account, PNR, reference, URL,
// name). (Similarity gates need the embedding model, so those are tested on the phone.)
//
// NOTE: the old "generalizer" (doubt -> anonymized tip: generalize/shortenToGeneral/clip in a
// privacy/generalize.ts) was Hive's Ask/doubt-sharing feature. It was removed, not hidden, in the LastMeter
// pivot -- there is no doubt-sharing flow any more, so those tests were deleted along with it. `clip` still
// exists, but as a plain ellipsis-truncate for list previews (src/ui/format.ts), a different, simpler concern.
//
// Run: node tools/seed/verify-privacy.mjs
import { app, loadTs, mock } from './_load.mjs';

// the phone's own contacts are set per test; scanEntities only ever checks these, not imported-chat names
// (that concept, and the skipNames business exemption that went with it, left with the WhatsApp/SMS sources)
let contacts = new Set();
const nameTokens = (n) => n.toLowerCase().split(/[^\p{L}]+/u).filter((t) => t.length >= 3);
mock('@/core/names', {
  nameTokens,
  getContactNames: async () => contacts,
});

const { scanEntities } = loadTs(app('privacy/entities.ts'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const type = async (t, opts) => (await scanEntities(t, opts))?.type ?? null;

// --- Gate 1: entity scan ---
check('phone number', (await type('call me on 9876543210 tonight')) === 'phone');
check('+91 phone', (await type('reach +91 98765 43210')) !== null || (await type('reach +91-9876543210')) === 'phone');
check('VPA', (await type('pay rahul@ybl for the chai')) === 'vpa');
check('email is not mistaken for a VPA', (await type('write to priya.k@gmail.com')) === 'email');
check('amount (Rs)', (await type('paid Rs 450 for lunch')) === 'amount');
check('amount (rupee sign, commas)', (await type('cost ₹1,200.50 in total')) === 'amount');
check('account number', (await type('debited from A/c XX1234')) === 'account');
check('PNR', (await type('my PNR 4521367890 is confirmed')) === 'pnr');
check('long reference number', (await type('ref 123456789012 done')) === 'reference');
check('URL', (await type('see https://example.com/x')) === 'url');
check('clean text with no name-shaped run passes', (await type('great filter coffee and quiet seating near the gate')) === null);
check('a capitalized two-word run is flagged as a conservative backstop, even over a place name', (await type('Blue Tokai near Amber Fort has good coffee')) === 'name');

contacts = new Set(['sharma', 'rahul']);
check('contact name detected', (await type('ask Rahul about the notes')) === 'name');
check('non-contact lowercase mention is not flagged', (await type('ask priya about the notes')) === null);

process.exit(failed ? 1 : 0);
