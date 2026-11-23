// Node unit tests for js/engines/batch.js and js/engines/zip.js.
// Run: node scripts/unit/batch.test.js
const assert = require('assert');
const zlib = require('zlib');
let B, Z;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

t('run: processes every item with at most `concurrency` at once, keeping input order', async () => {
  let live = 0, peak = 0;
  const seen = [];
  const res = await B.run([5, 1, 4, 2, 3], async (x, i) => { live++; peak = Math.max(peak, live); await sleep(x * 3); live--; return x * 10; },
    { concurrency: 2, onProgress: (done, total) => seen.push(done + '/' + total) });
  assert.deepStrictEqual(res.map(r => r.value), [50, 10, 40, 20, 30]);
  assert.ok(res.every(r => r.ok && typeof r.ms === 'number'));
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(seen, ['1/5', '2/5', '3/5', '4/5', '5/5']);
});
t('run: one failing item is reported and the rest still run', async () => {
  const res = await B.run(['a', 'bad', 'c'], async x => { if (x === 'bad') throw new Error('cannot read'); return x.toUpperCase(); });
  assert.deepStrictEqual(res.map(r => [r.ok, r.ok ? r.value : r.error]), [[true, 'A'], [false, 'cannot read'], [true, 'C']]);
});
t('run: an aborted batch stops starting new items and rejects with AbortError', async () => {
  const ac = new AbortController();
  let started = 0;
  await assert.rejects(B.run([1, 2, 3, 4, 5, 6], async () => { started++; if (started === 2) ac.abort(); await sleep(5); }, { concurrency: 1, signal: ac.signal }), e => e.name === 'AbortError');
  assert.ok(started <= 3, 'kept starting items after abort: ' + started);
});
t('report: CSV and HTML state the title, options and date; cells are escaped and formula-safe', async () => {
  const res = [{ item: { path: 'a/b.txt' }, ok: true, value: { hash: '=1+1' }, ms: 3 }, { item: { path: '<x>.bin' }, ok: false, error: 'unreadable', ms: 1 }];
  const rep = B.report(res, { title: 'Folder hashes', options: 'SHA-256; ignored: .git', generated: '2026-11-23T10:00:00.000Z',
    columns: [{ label: 'Path', get: r => r.item.path }, { label: 'SHA-256', get: r => r.ok ? r.value.hash : '' }] });
  const lines = rep.csv.split('\r\n');
  assert.deepStrictEqual(lines.slice(0, 3), ['Report,Folder hashes', 'Generated,2026-11-23T10:00:00.000Z', 'Options,SHA-256; ignored: .git']);
  assert.ok(lines.includes('Path,SHA-256,Status'), rep.csv);
  assert.ok(lines.includes("a/b.txt,'=1+1,ok"), rep.csv);
  assert.ok(lines.includes('<x>.bin,,error: unreadable'), rep.csv);
  assert.ok(rep.html.includes('&lt;x&gt;.bin') && !rep.html.includes('<x>'), 'HTML not escaped');
  assert.ok(rep.html.includes('Folder hashes') && rep.html.includes('SHA-256; ignored: .git') && rep.html.includes('2026-11-23T10:00:00.000Z'));
});
t('zip: a stored zip of many files is valid (CRC, sizes, UTF-8 names) and round-trips', async () => {
  const files = [{ name: 'report.csv', data: 'a,b\r\n1,2\r\n' }, { name: 'résumé/ü.txt', data: new Uint8Array([0, 1, 2, 255]) }, { name: 'empty.txt', data: '' }];
  const u8 = Z.zipStore(files);
  const out = Z.unzipStored(u8);
  assert.deepStrictEqual(Object.keys(out), ['report.csv', 'résumé/ü.txt', 'empty.txt']);
  assert.strictEqual(new TextDecoder().decode(out['report.csv'].data), 'a,b\r\n1,2\r\n');
  assert.deepStrictEqual(Array.from(out['résumé/ü.txt'].data), [0, 1, 2, 255]);
  if (zlib.crc32) Object.values(out).forEach(f => assert.strictEqual(f.crc, zlib.crc32(f.data)));
  assert.strictEqual(Z.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

(async () => {
  let n = 0, failed = 0;
  try { B = require('../../js/engines/batch.js'); Z = require('../../js/engines/zip.js'); } catch (e) { console.error('FAIL loading batch/zip engines\n  ', e.message); process.exitCode = 1; return; }
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
  }
  if (!failed) console.log(`batch and zip engines: ${n} unit tests passed`);
})();
