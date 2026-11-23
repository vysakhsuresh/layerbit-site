// Node unit tests for js/engines/hashx.js: checksum files (sha256sum, md5sum,
// BSD style), algorithm detection, relative paths and set comparison.
// Run: node scripts/unit/hashx.test.js
const assert = require('assert');
let H;
let n = 0, failed = 0;
function t(name, fn) { try { if (!H) H = require('../../js/engines/hashx.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
const A = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

t('parseSums: GNU text and binary markers, BSD tags, comments, CRLF, escaped names', () => {
  const r = H.parseSums(`# release 1.2\r\n${A}  dist/app.tar.gz\r\n${A.toUpperCase()} *setup.exe\nSHA256 (notes v2.txt) = ${A}\nMD5 (old.bin) = 900150983cd24fb0d6963f7d28e17f72\n\\${A}  dir/new\\nline.txt\nnot a checksum line\n`);
  assert.deepStrictEqual(r.entries.map(e => [e.path, e.alg, e.digest]), [
    ['dist/app.tar.gz', 'SHA-256', A], ['setup.exe', 'SHA-256', A], ['notes v2.txt', 'SHA-256', A],
    ['old.bin', 'MD5', '900150983cd24fb0d6963f7d28e17f72'], ['dir/new\nline.txt', 'SHA-256', A]]);
  assert.deepStrictEqual(r.errors.map(e => e.line), [7]);
});
t('parseSums: the file name decides between algorithms of the same length', () => {
  const sha3 = '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532';
  assert.strictEqual(H.parseSums(`${sha3}  a`, 'SHA3-256SUMS').entries[0].alg, 'SHA3-256');
  assert.strictEqual(H.parseSums(`${sha3}  a`, 'file.sha256').entries[0].alg, 'SHA-256');
  assert.strictEqual(H.parseSums('a9993e364706816aba3e25717850c26c9cd0d89d  a').entries[0].alg, 'SHA-1');
  assert.strictEqual(H.algForLength(128, 'b2sums'), 'BLAKE2b-512');
  assert.strictEqual(H.algForLength(128, ''), 'SHA-512');
});
t('formatSums: sha256sum style with escaping, BSD style', () => {
  assert.strictEqual(H.formatSums([{ path: 'a b.txt', digest: A }, { path: 'x\\y\nz', digest: A }], 'SHA-256'), `${A}  a b.txt\n\\${A}  x\\\\y\\nz\n`);
  assert.strictEqual(H.formatSums([{ path: 'a', digest: A }], 'SHA-256', 'bsd'), `SHA256 (a) = ${A}\n`);
});
t('relPaths: the common top folder is dropped, Windows separators normalised', () => {
  assert.deepStrictEqual(H.relPaths(['proj/a.txt', 'proj/src/b.js']), ['a.txt', 'src/b.js']);
  assert.deepStrictEqual(H.relPaths(['a.txt', 'b.txt']), ['a.txt', 'b.txt']);
  assert.deepStrictEqual(H.relPaths(['x\\y\\z.txt', 'x\\w.txt']), ['y/z.txt', 'w.txt']);
});
t('compareSets: same, different, only in one side; sorted by path', () => {
  const r = H.compareSets([{ path: 'a', digest: '1' }, { path: 'b', digest: '2' }, { path: 'c', digest: '3' }], [{ path: 'b', digest: '2' }, { path: 'a', digest: '9' }, { path: 'd', digest: '4' }]);
  assert.deepStrictEqual(r.map(x => x.path + ':' + x.status), ['a:different', 'b:same', 'c:onlyA', 'd:onlyB']);
});
t('checkSums: OK, FAILED and missing, matching by path then by name', () => {
  const entries = H.parseSums(`${A}  dist/app.bin\n${A}  other.bin\n${A}  gone.bin\n`).entries;
  const files = [{ path: 'release/dist/app.bin', digest: A }, { path: 'other.bin', digest: '00' }];
  const r = H.checkSums(entries, files);
  assert.deepStrictEqual(r.map(x => x.path + ':' + x.status), ['dist/app.bin:OK', 'other.bin:FAILED', 'gone.bin:MISSING']);
});

console.log(`${n} passed, ${failed} failed`);
