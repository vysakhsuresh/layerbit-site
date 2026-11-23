// Node unit tests for js/engines/stream.js (needs Node 18+ for Blob).
// Run: node scripts/unit/stream.test.js
const assert = require('assert');
let S;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

const enc = s => new TextEncoder().encode(s);
async function collect(it) { const out = []; for await (const x of it) out.push(x); return out; }

t('chunks: reads a blob in slices with offsets and progress', async () => {
  const blob = new Blob([enc('abcdefghij')]);
  const seen = [];
  const parts = await collect(S.chunks(blob, { chunkSize: 4, onProgress: (done, total) => seen.push([done, total]) }));
  assert.deepStrictEqual(parts.map(p => [p.offset, new TextDecoder().decode(p.bytes)]), [[0, 'abcd'], [4, 'efgh'], [8, 'ij']]);
  assert.deepStrictEqual(seen, [[4, 10], [8, 10], [10, 10]]);
  assert.deepStrictEqual(await collect(S.chunks(new Blob([]))), []);
});
t('chunks: stops with an AbortError when the signal is aborted', async () => {
  const ac = new AbortController();
  const it = S.chunks(new Blob([new Uint8Array(100)]), { chunkSize: 10, signal: ac.signal });
  let n = 0;
  await assert.rejects(async () => { for await (const c of it) { n++; if (n === 2) ac.abort(); } }, e => e.name === 'AbortError');
  assert.strictEqual(n, 2);
});
t('lines: splits across chunk boundaries, CRLF and bare CR, and keeps a last line without a newline', async () => {
  const blob = new Blob([enc('one\r\ntwo\nthree\rfour')]);
  for (const size of [1, 2, 3, 5, 64]) {
    const ls = await collect(S.lines(blob, { chunkSize: size }));
    assert.deepStrictEqual(ls.map(l => [l.number, l.text]), [[1, 'one'], [2, 'two'], [3, 'three'], [4, 'four']], 'chunk size ' + size);
  }
  assert.deepStrictEqual((await collect(S.lines(new Blob([enc('a\n\nb\n')])))).map(l => l.text), ['a', '', 'b']);
});
t('lines: multi-byte characters split across chunks decode correctly', async () => {
  const ls = await collect(S.lines(new Blob([enc('café ☕\nx')]), { chunkSize: 1 }));
  assert.deepStrictEqual(ls.map(l => l.text), ['café ☕', 'x']);
});
t('lines: the encoding is detected from the start of the file (BOM, UTF-16, Windows-1252)', async () => {
  const w1252 = new Blob([new Uint8Array([0x63, 0x61, 0x66, 0xE9, 0x0A, 0x80])]);
  const r = S.lines(w1252, { chunkSize: 2 });
  assert.deepStrictEqual((await collect(r)).map(l => l.text), ['café', '€']);
  assert.strictEqual(r.encoding, 'windows-1252');
  const u16 = new Blob([new Uint8Array([0xFF, 0xFE, 0x68, 0, 0x0A, 0, 0x69, 0])]);
  assert.deepStrictEqual((await collect(S.lines(u16, { chunkSize: 3 }))).map(l => l.text), ['h', 'i']);
  const bom = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])]);
  assert.deepStrictEqual((await collect(S.lines(bom))).map(l => l.text), ['a']);
  assert.strictEqual(S.detectEncoding(enc('plain')), 'utf-8');
});
t('lines: a 5 MB file streams in small chunks with a bounded line count', async () => {
  const line = 'x'.repeat(99) + '\n', n = 50000;
  const blob = new Blob(Array(n).fill(line));
  let count = 0, last = 0;
  for await (const l of S.lines(blob, { chunkSize: 64 * 1024 })) { count++; last = l.number; if (l.text.length !== 99) throw new Error('bad line ' + l.number); }
  assert.strictEqual(count, n); assert.strictEqual(last, n);
});

t('lines: time grows linearly with the lines in a chunk (no quadratic queue; the Log Analyzer read 50 MB at 4 MB/s)', async () => {
  const run = async n => { const blob = new Blob(Array(n).fill('2026-11-23 09:00:00 INFO short line\n')); const t0 = Date.now(); let c = 0; for await (const l of S.lines(blob, { chunkSize: 64 << 20 })) c++; assert.strictEqual(c, n); return Math.max(1, Date.now() - t0); };

  const small = await run(100000), big = await run(400000);
  assert.ok(big / small < 7, `4x the lines took ${(big / small).toFixed(1)}x the time (${small} ms -> ${big} ms)`);
});

(async () => {
  let n = 0, failed = 0;
  try { S = require('../../js/engines/stream.js'); } catch (e) { console.error('FAIL loading js/engines/stream.js\n  ', e.message); process.exitCode = 1; return; }
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
  }
  if (!failed) console.log(`stream engine: ${n} unit tests passed`);
})();
