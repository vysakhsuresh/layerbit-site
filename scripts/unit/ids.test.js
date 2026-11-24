// Unit tests for js/engines/ids.js and the vendored sqids. Run: node scripts/unit/ids.test.js
const I = require('../../js/engines/ids.js');
const nodeCrypto = require('crypto');
globalThis.self = globalThis;
const Sqids = require('../../js/vendor/sqids.min.js');
const assert = require('assert');
let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
const fixed = b => n => Uint8Array.from({ length: n }, (_, i) => b[i % b.length]);

t('UUID v1 and v6: RFC 9562 layout, timestamp, random multicast node, ordering', () => {
  const ms = Date.UTC(2026, 10, 24, 12, 0, 0);
  const a = I.uuid1({ ms, random: fixed([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]) });
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const id = I.identify(a);
  assert.strictEqual(id.kind, 'uuid-v1'); assert.strictEqual(id.ms, ms);
  assert.strictEqual(parseInt(a.slice(24, 26), 16) & 1, 1, 'multicast bit set: not a MAC address');
  const six = [I.uuid6({ ms }), I.uuid6({ ms }), I.uuid6({ ms: ms + 1 })];
  six.forEach(u => assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab]/));
  assert.deepStrictEqual(six.slice().sort(), six, 'v6 sorts by time');
  assert.strictEqual(I.identify(six[0]).ms, ms);
  // RFC 9562 appendix A.5 test vector: v6 1EC9414C-232A-6B00-B3C8-9F6BDECED846 = 2022-02-22T19:22:22Z
  assert.strictEqual(new Date(I.identify('1EC9414C-232A-6B00-B3C8-9F6BDECED846').ms).toISOString(), '2022-02-22T19:22:22.000Z');
  assert.strictEqual(new Date(I.identify('C232AB00-9414-11EC-B3C8-9F6BDECED846').ms).toISOString(), '2022-02-22T19:22:22.000Z');
});
t('NanoID: default size and alphabet, custom alphabet, no bias', () => {
  const id = I.nanoid();
  assert.match(id, /^[A-Za-z0-9_-]{21}$/);
  assert.match(I.nanoid({ size: 10, alphabet: '0123456789abcdef' }), /^[0-9a-f]{10}$/);
  const counts = {}; for (let i = 0; i < 3000; i++) for (const c of I.nanoid({ size: 10, alphabet: 'abc' })) counts[c] = (counts[c] || 0) + 1;
  Object.values(counts).forEach(n => assert.ok(Math.abs(n - 10000) < 600, 'biased: ' + JSON.stringify(counts)));
  assert.throws(() => I.nanoid({ alphabet: 'aa' }), /repeated/);
});
t('KSUID: segmentio reference value and round trip', () => {
  const p = I.parseKsuid('0ujtsYcgvSTl8PAuAdqWYSMnLOv');
  assert.strictEqual(new Date(p.ms).toISOString(), '2017-10-10T04:00:47.000Z');
  assert.strictEqual(p.payload.toUpperCase(), 'B5A1CD34B5F99D1154FB6853345C9735');
  const ms = Date.UTC(2026, 0, 1);
  const k = I.ksuid({ ms, random: () => Uint8Array.from(Buffer.from('B5A1CD34B5F99D1154FB6853345C9735', 'hex')) });
  assert.strictEqual(k.length, 27); assert.strictEqual(I.parseKsuid(k).ms, ms);
  assert.strictEqual(I.parseKsuid('aWgEPTl1tmebfsQzFP4bxwgy80V').payload, 'f'.repeat(32), 'the largest KSUID');
  assert.strictEqual(I.parseKsuid('zzzzzzzzzzzzzzzzzzzzzzzzzzz'), null, 'over 160 bits');
});
t('CUID2: shape, uniqueness, length option', async () => {
  const hash = async s => nodeCrypto.createHash('sha3-512').update(s).digest('hex');
  const ids = new Set();
  for (let i = 0; i < 200; i++) { const c = await I.cuid2({ hash }); assert.match(c, /^[a-z][0-9a-z]{23}$/); ids.add(c); }
  assert.strictEqual(ids.size, 200);
  assert.match(await I.cuid2({ hash, length: 10 }), /^[a-z][0-9a-z]{9}$/);
  await assert.rejects(I.cuid2({}), /SHA3-512/);
});
t('Snowflake: Discord reference id, Twitter epoch, generation', () => {
  const d = I.parseSnowflake('175928847299117063', I.EPOCHS.discord);
  assert.strictEqual(new Date(d.ms).toISOString(), '2016-04-30T11:18:25.796Z');
  assert.deepStrictEqual([d.datacenter, d.machine, d.sequence], [1, 0, 7]);
  const ms = Date.UTC(2026, 10, 24);
  const s = I.snowflake({ ms, worker: 513, sequence: 9 });
  const p = I.parseSnowflake(s);
  assert.deepStrictEqual([p.ms, p.worker, p.sequence], [ms, 513, 9]);
  assert.throws(() => I.snowflake({ worker: 2000 }), /0 to 1023/);
});
t('Sqids (vendored): spec examples', () => {
  const s = new Sqids();
  assert.strictEqual(s.encode([1, 2, 3]), '86Rf07');
  assert.deepStrictEqual(s.decode('86Rf07'), [1, 2, 3]);
  assert.strictEqual(new Sqids({ minLength: 10 }).encode([1, 2, 3]), '86Rf07xd4z');
  assert.strictEqual(new Sqids({ alphabet: 'FxnXM1kBN6cuhsAvjW3Co7l2RePyY8DwaU04Tzt9fHQrqSVKdpimLGIJOgb5ZE' }).encode([1, 2, 3]), 'B4aajs');
});
t('identify and validate a mixed list, with duplicates and an expected kind', () => {
  const lines = ['018f4a6c-9e3b-7c4d-8a2e-1f3b5c7d9e0f', '{C56A4180-65AA-42EC-A945-5FD21DEC0538}', '01ARZ3NDEKTSV4RRFFQ69G5FAV', '0ujtsYcgvSTl8PAuAdqWYSMnLOv',
    '175928847299117063', 'c56a4180-65aa-42ec-a945-5fd21dec0538', '018f4a6c-9e3b-7c4d-ca2e-1f3b5c7d9e0f', 'hello', '', 'V1StGXR8_Z5jdHi6B-myT'];
  const r = I.validate(lines);
  assert.deepStrictEqual(r.rows.map(x => x.kind), ['uuid-v7', 'uuid-v4', 'ulid', 'ksuid', 'snowflake', 'uuid-v4', 'uuid', 'unknown', 'nanoid']);
  assert.deepStrictEqual(r.rows.map(x => x.valid), [true, true, true, true, true, true, false, false, true]);
  assert.strictEqual(r.rows[5].duplicateOf, 2, 'braced uppercase and canonical are the same UUID');
  assert.match(r.rows[6].detail, /variant/);
  assert.deepStrictEqual([r.counts.total, r.counts.valid, r.counts.invalid, r.counts.duplicates], [9, 7, 2, 1]);
  const v7 = I.validate(lines.slice(0, 3), { expect: 'uuid-v7' });
  assert.deepStrictEqual(v7.rows.map(x => x.valid), [true, false, false]);
  assert.match(v7.rows[1].detail, /expected uuid-v7, found uuid-v4/);
  assert.strictEqual(new Date(I.identify('018f4a6c-9e3b-7c4d-8a2e-1f3b5c7d9e0f').ms).toISOString(), '2024-05-05T20:23:03.483Z');
});

(async () => {
  for (const [name, fn] of queue) { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
  console.log(`ids: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
