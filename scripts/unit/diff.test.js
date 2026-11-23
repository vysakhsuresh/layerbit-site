// Node unit tests for js/engines/diff.js. Run: node scripts/unit/diff.test.js
const D = require('../../js/engines/diff.js');
const assert = require('assert');
let n = 0; function t(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }

t('lineDiff basic', () => {
  const r = D.lineDiff('a\nb\nc\n', 'a\nB\nc\n');
  assert.deepStrictEqual(r.rows.map(x => x.type), ['eq', 'mod', 'eq']);
  assert.strictEqual(r.stats.modified, 1); assert.strictEqual(r.hunks.length, 1);
  assert.deepStrictEqual(r.rows[1].r.segs, [{ t: 'B', c: 'ins' }]);
});
t('lineDiff identical', () => { const r = D.lineDiff('x\ny', 'x\ny'); assert.strictEqual(r.hunks.length, 0); assert.strictEqual(r.stats.similarity, 100); });
t('lineDiff ignores CRLF by default', () => { const r = D.lineDiff('a\r\nb\r\n', 'a\nb\n'); assert.strictEqual(r.hunks.length, 0); });
t('lineDiff ignoreWhitespace / ignoreCase', () => {
  assert.strictEqual(D.lineDiff('x = 1', 'x  =  1   ', { ignoreWhitespace: true }).hunks.length, 0);
  assert.strictEqual(D.lineDiff('Hello', 'hello', { ignoreCase: true }).hunks.length, 0);
  assert.strictEqual(D.lineDiff('Hello', 'hello').hunks.length, 1);
});
t('lineDiff ins/del unequal counts', () => {
  const r = D.lineDiff('a\nb\n', 'a\nx\ny\nz\n');
  assert.deepStrictEqual(r.rows.map(x => x.type), ['eq', 'mod', 'ins', 'ins']);
});
t('lineDiff pairs replaced lines by similarity, not slot', () => {
  const a = 'x();\nmodule.exports = { calculateTotal };\n';
  const b = 'x();\nfunction round2(n) { return Math.round(n * 100) / 100; }\n\nmodule.exports = { calculateTotal, round2 };\n';
  const r = D.lineDiff(a, b);
  assert.deepStrictEqual(r.rows.map(x => x.type), ['eq', 'ins', 'ins', 'mod']);
  assert.strictEqual(r.rows[3].l.text, 'module.exports = { calculateTotal };');
});
t('lineDiff rewritten-in-place line still pairs', () => {
  const r = D.lineDiff('  let total = price + tax;\n', '  const finalTotal = basePrice;\n');
  assert.deepStrictEqual(r.rows.map(x => x.type), ['mod']);
});
t('lineDiff ignore options change the result', () => {
  const a = 'Hello  World\n', b = 'hello world\n';
  assert.strictEqual(D.lineDiff(a, b).hunks.length, 1);
  assert.strictEqual(D.lineDiff(a, b, { ignoreCase: true, ignoreWhitespace: true }).hunks.length, 0);
});
t('intraline char', () => {
  const s = D.intraline('getUserId()', 'getUserID()', 'char');
  assert.deepStrictEqual(s.b.filter(x => x.c === 'ins').map(x => x.t), ['D']);
});
t('foldContext', () => {
  const rows = []; for (let i = 0; i < 20; i++) rows.push({ type: 'eq' }); rows[10] = { type: 'mod' };
  const f = D.foldContext(rows, 2);
  assert.deepStrictEqual(f.map(x => x.type), ['skip', 'eq', 'eq', 'mod', 'eq', 'eq', 'skip']);
  assert.strictEqual(f[0].count, 8); assert.strictEqual(f[6].count, 7);
});
t('detectLang', () => {
  assert.strictEqual(D.detectLang('{"a": 1}'), 'json');
  assert.strictEqual(D.detectLang('SELECT a FROM b WHERE c = 1'), 'sql');
  assert.strictEqual(D.detectLang('const x = () => 1;'), 'js');
  assert.strictEqual(D.detectLang('name: x\nitems:\n  - a\n'), 'yaml');
  assert.strictEqual(D.detectLang('<root><a/></root>'), 'xml');
  assert.strictEqual(D.detectLang('def f():\n    return 1\n'), 'py');
  assert.strictEqual(D.detectLang('anything', 'x.sql'), 'sql');
  assert.strictEqual(D.detectLang('plain words here'), 'text');
});
t('tokenize json/js/sql', () => {
  assert.deepStrictEqual(D.tokenize('{"a": 12, "b": true}', 'json').map(x => x.c), ['key', 'num', 'key', 'kw']);
  const js = D.tokenize('const s = "x"; // c', 'js').map(x => x.c); assert.deepStrictEqual(js, ['kw', 'str', 'cmt']);
  const sql = D.tokenize("SELECT COUNT(*) FROM t WHERE x = 'y' -- note", 'sql').map(x => x.c); assert.deepStrictEqual(sql, ['kw', 'fn', 'kw', 'kw', 'str', 'cmt']);
});
t('renderLine merges change and token ranges, escapes html', () => {
  const html = D.renderLine('<b> "k": 1', [{ t: '<b> ', c: 'eq' }, { t: '"k": 1', c: 'ins' }], 'json');
  assert.ok(html.includes('&lt;b&gt;'), html); assert.ok(html.includes('word-added tk-key'), html); assert.ok(html.includes('word-added tk-num'), html);
});
t('unifiedPatch + applyPatch round trip', () => {
  const a = 'one\ntwo\nthree\n', b = 'one\n2\nthree\nfour\n';
  const p = D.unifiedPatch(a, b, 'a.txt', 'b.txt');
  assert.ok(p.startsWith('--- a.txt'), p);
  const r = D.applyPatch(a, p); assert.ok(r.ok, r.error); assert.strictEqual(r.text, b);
  const bad = D.applyPatch('totally different\n', p); assert.strictEqual(bad.ok, false); assert.ok(/does not apply/.test(bad.error));
  assert.strictEqual(D.applyPatch(a, 'not a patch').ok, false);
});
t('diff3 clean merge both sides', () => {
  const base = 'a\nb\nc\nd\ne\n', ours = 'A\nb\nc\nd\ne\n', theirs = 'a\nb\nc\nd\nE\n';
  const r = D.diff3(base, ours, theirs); assert.strictEqual(r.conflicts, 0); assert.strictEqual(r.merged, 'A\nb\nc\nd\nE\n');
});
t('diff3 conflict', () => {
  const r = D.diff3('a\nb\nc\n', 'a\nX\nc\n', 'a\nY\nc\n');
  assert.strictEqual(r.conflicts, 1); assert.ok(r.merged.includes('<<<<<<< ours\nX\n||||||| base\nb\n=======\nY\n>>>>>>> theirs'), r.merged);
});
t('diff3 identical change both sides is not a conflict', () => {
  const r = D.diff3('a\nb\nc\n', 'a\nX\nc\n', 'a\nX\nc\n'); assert.strictEqual(r.conflicts, 0); assert.strictEqual(r.merged, 'a\nX\nc\n');
});
t('diff3 insertions at different places', () => {
  const r = D.diff3('a\nb\nc\n', 'a\nb\nc\nd\n', 'z\na\nb\nc\n'); assert.strictEqual(r.conflicts, 0); assert.strictEqual(r.merged, 'z\na\nb\nc\nd\n');
});
t('diff3 one side deletes, other unchanged', () => {
  const r = D.diff3('a\nb\nc\n', 'a\nc\n', 'a\nb\nc\n'); assert.strictEqual(r.merged, 'a\nc\n');
});
t('structuralDiff', () => {
  const d = D.structuralDiff({ a: 1, b: { c: [1, 2] }, d: 'x' }, { b: { c: [1, 3, 4] }, a: 1, e: null, d: 2 });
  const byPath = Object.fromEntries(d.map(x => [x.path, x.type]));
  assert.deepStrictEqual(byPath, { '$.b.c[1]': 'changed', '$.b.c[2]': 'added', '$.d': 'type', '$.e': 'added' });
  assert.strictEqual(D.structuralDiff({ a: 1, b: 2 }, { b: 2, a: 1 }).length, 0, 'key order ignored');
});
t('structuralDiff keyed arrays', () => {
  const d = D.structuralDiff({ u: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }] }, { u: [{ id: 2, n: 'B' }, { id: 3, n: 'c' }] }, { arrays: 'key', keyField: 'id' });
  assert.deepStrictEqual(d.map(x => x.path + ':' + x.type).sort(), ['$.u[id=1]:removed', '$.u[id=2].n:changed', '$.u[id=3]:added']);
});
t('parseCsv quotes/newlines/BOM/delimiter', () => {
  const rows = D.parseCsv('﻿a,b\n1,"x, ""y""\nz"\n2,w\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['1', 'x, "y"\nz'], ['2', 'w']]);
  assert.strictEqual(D.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.deepStrictEqual(D.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
t('tableDiff keyed', () => {
  const r = D.tableDiff([['id', 'name', 'qty'], ['1', 'a', '5'], ['2', 'b', '6'], ['3', 'c', '7']], [['id', 'name', 'qty', 'new'], ['3', 'c', '7', ''], ['1', 'a', '9', ''], ['4', 'd', '1', '']], 0);
  assert.deepStrictEqual(r.removed.map(x => x.key), ['2']); assert.deepStrictEqual(r.added.map(x => x.key), ['4']);
  assert.deepStrictEqual(r.changed.map(x => x.key), ['1']); assert.deepStrictEqual(r.changed[0].cells.filter(c => c.col === 'qty')[0], { col: 'qty', old: '5', new: '9' });
  assert.deepStrictEqual(r.colsAdded, ['new']); assert.strictEqual(r.unchanged, 1);
});
t('readZip parses a stored zip', () => {
  // minimal zip with one stored entry "a.txt" containing "hi" (built from the spec)
  const zlib = require('zlib');
  const name = Buffer.from('a.txt'), data = Buffer.from('hi'), crc = zlib.crc32 ? zlib.crc32(data) : 0x9d5bbaa0;
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(2, 18); lh.writeUInt32LE(2, 22); lh.writeUInt16LE(5, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(2, 20); cd.writeUInt32LE(2, 24); cd.writeUInt16LE(5, 28); cd.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + 5, 12); eocd.writeUInt32LE(30 + 5 + 2, 16);
  const buf = Buffer.concat([lh, name, data, cd, name, eocd]);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  const entries = D.readZip(ab); assert.strictEqual(entries.length, 1); assert.strictEqual(entries[0].name, 'a.txt'); assert.strictEqual(entries[0].size, 2);
  return entries[0].read().then(u => assert.strictEqual(Buffer.from(u).toString(), 'hi'));
});

// ---- v4: bug 2, byte decoding
t('bug 2: Windows-1252 bytes decode losslessly and differ', () => {
  const a = D.decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xE9])), b = D.decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xE8]));
  assert.strictEqual(a.text, 'café'); assert.strictEqual(b.text, 'cafè');
  assert.strictEqual(a.encoding, 'Windows-1252');
  assert.strictEqual(D.lineDiff(a.text, b.text).hunks.length, 1);
});
t('bug 2: UTF-8 with and without BOM, UTF-16 LE/BE with BOM and without', () => {
  const enc = new TextEncoder();
  assert.deepStrictEqual(D.decodeBytes(enc.encode('héllo')), { text: 'héllo', encoding: 'UTF-8', bom: false });
  assert.deepStrictEqual(D.decodeBytes(new Uint8Array([0xEF, 0xBB, 0xBF, ...enc.encode('hi')])), { text: 'hi', encoding: 'UTF-8', bom: true });
  const le = [0xFF, 0xFE, 0x68, 0, 0xE9, 0], be = [0xFE, 0xFF, 0, 0x68, 0, 0xE9];
  assert.deepStrictEqual(D.decodeBytes(new Uint8Array(le)), { text: 'hé', encoding: 'UTF-16 LE', bom: true });
  assert.deepStrictEqual(D.decodeBytes(new Uint8Array(be)), { text: 'hé', encoding: 'UTF-16 BE', bom: true });
  const noBom = new Uint8Array([...'hello world'].flatMap(c => [c.charCodeAt(0), 0]));
  assert.deepStrictEqual(D.decodeBytes(noBom), { text: 'hello world', encoding: 'UTF-16 LE', bom: false });
  assert.deepStrictEqual(D.decodeBytes(new Uint8Array(0)), { text: '', encoding: 'UTF-8', bom: false });
});
t('bug 2: bytesEqual', () => {
  assert.ok(D.bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])));
  assert.ok(!D.bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])));
  assert.ok(!D.bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0])));
});

process.on('beforeExit', () => { if (!process.exitCode) console.log(`diff engine: ${n} unit tests passed`); });

// ---- v4: bug 3, zip root folder
t('bug 3: a top folder is stripped only when every entry shares it', () => {
  assert.deepStrictEqual(D.stripCommonRoot(['proj/a.txt', 'proj/src/b.js']), ['a.txt', 'src/b.js']);
  assert.deepStrictEqual(D.stripCommonRoot(['src/app.js', 'lib/app.js']), ['src/app.js', 'lib/app.js']);
  assert.deepStrictEqual(D.stripCommonRoot(['readme.md', 'proj/a.txt']), ['readme.md', 'proj/a.txt']);
  assert.deepStrictEqual(D.stripCommonRoot(['only.txt']), ['only.txt']);
  assert.deepStrictEqual(D.stripCommonRoot([]), []);
});

// ---- v4: bug 4, quotes inside a field
t('bug 4: a quote that does not start a field is a literal character', () => {
  assert.deepStrictEqual(D.parseCsv('id,desc\n1,5" screen\n2,ok\n', ','), [['id', 'desc'], ['1', '5" screen'], ['2', 'ok']]);
  assert.deepStrictEqual(D.parseCsv('a,b\n"x, ""y""",z\n', ','), [['a', 'b'], ['x, "y"', 'z']]);
  assert.deepStrictEqual(D.parseCsv('a;b\n12" pipe;"multi\nline"\n', ';'), [['a', 'b'], ['12" pipe', 'multi\nline']]);
  assert.deepStrictEqual(D.parseCsv('a\n "lead"\n', ','), [['a'], [' "lead"']]);
});

// ---- v4: bug 5, key columns by name
t('bug 5: rows are keyed by header name in each file, so reordered columns still match', () => {
  const A = [['id', 'name', 'qty'], ['1', 'Widget', '5'], ['2', 'Gadget', '6']];
  const B = [['qty', 'id', 'name'], ['5', '1', 'Widget'], ['7', '2', 'Gadget']];
  const r = D.tableDiff(A, B, { keys: ['id'] });
  assert.strictEqual(r.added.length, 0); assert.strictEqual(r.removed.length, 0);
  assert.strictEqual(r.changed.length, 1); assert.deepStrictEqual(r.changed[0].cells, [{ col: 'qty', old: '6', new: '7' }]);
  assert.strictEqual(r.unchanged, 1); assert.strictEqual(r.keyName, 'id');
  // legacy numeric key (index into the original's header) maps to the name
  assert.strictEqual(D.tableDiff(A, B, 0).changed.length, 1);
  assert.throws(() => D.tableDiff(A, [['sku', 'qty']], { keys: ['id'] }), /Key column "id" is not in the modified file/);
});

// ---- v4: bug 6, duplicate keys and multisets
t('bug 6: duplicate keys in a table are reported and compared as a multiset', () => {
  const A = [['id', 'name'], ['1', 'a'], ['1', 'b'], ['2', 'c']], B = [['id', 'name'], ['1', 'a'], ['2', 'c']];
  const r = D.tableDiff(A, B, { keys: ['id'] });
  assert.deepStrictEqual(r.duplicates, [{ key: '1', a: 2, b: 1 }]);
  assert.strictEqual(r.removed.length, 1); assert.strictEqual(r.removed[0].row.name, 'b');
  assert.strictEqual(r.unchanged, 2);
  const r2 = D.tableDiff([['id', 'v'], ['1', 'x'], ['1', 'y']], [['id', 'v'], ['1', 'x'], ['1', 'z']], { keys: ['id'] });
  assert.strictEqual(r2.changed.length, 1); assert.deepStrictEqual(r2.changed[0].cells, [{ col: 'v', old: 'y', new: 'z' }]);
});
t('bug 6: duplicate key fields in JSON arrays are reported', () => {
  const d = D.structuralDiff({ u: [{ id: 1, n: 'a' }, { id: 1, n: 'b' }] }, { u: [{ id: 1, n: 'a' }] }, { arrays: 'key', keyField: 'id' });
  assert.ok(d.some(x => x.type === 'duplicate' && x.path === '$.u[id=1]' && x.countA === 2 && x.countB === 1), JSON.stringify(d));
  assert.ok(d.some(x => x.type === 'removed' && x.old && x.old.n === 'b'), JSON.stringify(d));
});
t('bug 6: "as sets" compares multisets, so [1,1,2] differs from [1,2]', () => {
  const d = D.structuralDiff([1, 1, 2], [1, 2], { arrays: 'set' });
  assert.strictEqual(d.length, 1); assert.strictEqual(d[0].type, 'removed'); assert.strictEqual(d[0].old, 1);
  assert.strictEqual(D.structuralDiff([2, 1, 1], [1, 2, 1], { arrays: 'set' }).length, 0);
});

// ---- v4: bug 7, duplicate header names
t('bug 7: repeated column names are made unique so every column is compared', () => {
  const r = D.tableDiff([['id', 'amount', 'amount'], ['1', '10', '20']], [['id', 'amount', 'amount'], ['1', '11', '20']], { keys: ['id'] });
  assert.deepStrictEqual(r.columns, ['id', 'amount', 'amount (2)']);
  assert.deepStrictEqual(r.changed[0].cells, [{ col: 'amount', old: '10', new: '11' }]);
  const r2 = D.tableDiff([['id', 'amount', 'amount'], ['1', '10', '20']], [['id', 'amount', 'amount'], ['1', '10', '21']], { keys: ['id'] });
  assert.deepStrictEqual(r2.changed[0].cells, [{ col: 'amount (2)', old: '20', new: '21' }]);
  assert.deepStrictEqual(D.uniqueHeaders(['a', 'a', 'a (2)', '', '']), ['a', 'a (3)', 'a (2)', '(column 4)', '(column 5)']);
});

// ---- v4: bug 8, numbers beyond 2^53
t('bug 8: JSON numbers are compared by their exact digits', () => {
  const P = D.parseJsonLossless;
  const d = D.structuralDiff(P('{"id": 9007199254740993, "n": [1]}'), P('{"id": 9007199254740992, "n": [1]}'));
  assert.strictEqual(d.length, 1); assert.strictEqual(d[0].path, '$.id');
  assert.strictEqual(D.stringifyLossless(d[0].old), '9007199254740993'); assert.strictEqual(D.stringifyLossless(d[0].new), '9007199254740992');
  assert.strictEqual(D.structuralDiff(P('{"a": 1.0, "b": 1e2, "c": -0.50}'), P('{"a": 1, "b": 100, "c": -0.5}')).length, 0);
  assert.strictEqual(D.structuralDiff(P('[12345678901234567890]'), P('[12345678901234567891]'), { arrays: 'set' }).length, 2);
  assert.strictEqual(D.structuralDiff(P('{"a": 1}'), P('{"a": "1"}'))[0].type, 'type');
  assert.strictEqual(D.canonicalJson(P('{"b": 9007199254740993, "a": "x"}')), '{\n  "a": "x",\n  "b": 9007199254740993\n}');
  assert.deepStrictEqual(D.stringifyLossless(P('{"s":"a\\"b\\u00e9","t":true,"u":null,"v":[]}')), '{"s":"a\\"bé","t":true,"u":null,"v":[]}');
  assert.throws(() => P('{"a": 1,}'), /JSON/);
  assert.throws(() => P('[01]'), /JSON/);
});

// ---- v4: bug 9, large and unrelated inputs
const rng = seed => () => (seed = (seed * 1103515245 + 12345) >>> 0) % 1000000007;
t('bug 9: two similar 20,000-line files align quickly', () => {
  const r = rng(7), a = Array.from({ length: 20000 }, (_, i) => `line ${i} ${r()}`);
  const b = a.slice(); for (let i = 0; i < b.length; i += 7) b[i] = 'changed ' + i;
  const t0 = Date.now(), res = D.lineDiff(a.join('\n'), b.join('\n'));
  assert.ok(Date.now() - t0 < 8000, 'took ' + (Date.now() - t0) + ' ms');
  assert.ok(!res.tooDifferent);
  assert.strictEqual(res.stats.modified, Math.ceil(20000 / 7)); assert.strictEqual(res.stats.added + res.stats.removed, 0);
});
t('bug 9: unrelated large files stop at the work limit with a summary', () => {
  const r1 = rng(1), r2 = rng(2);
  const a = Array.from({ length: 20000 }, () => 'a' + r1()).concat(['shared']), b = Array.from({ length: 20000 }, () => 'b' + r2()).concat(['shared']);
  const t0 = Date.now(), res = D.lineDiff(a.join('\n'), b.join('\n'));
  assert.ok(Date.now() - t0 < 8000, 'took ' + (Date.now() - t0) + ' ms');
  assert.strictEqual(res.tooDifferent, true);
  assert.deepStrictEqual(res.summary, { linesA: 20001, linesB: 20001, onlyA: 20000, onlyB: 20000, common: 1 });
  assert.strictEqual(res.rows.length, 0);
  // with no limit the same input still produces a full answer
  const full = D.lineDiff('x\ny\n', 'p\nq\n', { workLimit: Infinity });
  assert.ok(!full.tooDifferent);
});
t('bug 9: the new aligner finds a minimal alignment on random edits', () => {
  for (let s = 1; s <= 300; s++) {
    const r = rng(s), a = Array.from({ length: r() % 40 }, () => String(r() % 6)), b = a.slice();
    for (let e = r() % 8; e > 0; e--) { const p = r() % (b.length + 1); if (r() % 2 && b.length) b.splice(p % b.length, 1); else b.splice(p, 0, String(r() % 6)); }
    const res = D.lineDiff(a.join('\n'), b.join('\n'), { granularity: 'none' });
    const L = res.rows.filter(x => x.l).map(x => x.l.text), R = res.rows.filter(x => x.r).map(x => x.r.text);
    assert.deepStrictEqual(L, a); assert.deepStrictEqual(R, b);
    res.rows.filter(x => x.type === 'eq').forEach(x => assert.strictEqual(x.l.text, x.r.text));
    // number of eq rows equals the LCS length (dynamic programming check)
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    assert.strictEqual(res.stats.unchanged, dp[0][0], 'seed ' + s);
  }
});

// ---- v4: bug 12, multi-file patches and fuzz
const MULTI = '--- a/one.txt\n+++ b/one.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+BETA\n--- a/two.txt\n+++ b/two.txt\n@@ -1,1 +1,2 @@\n gamma\n+delta\n';
t('bug 12: every file in a patch is listed', () => {
  const f = D.parsePatchFiles(MULTI);
  assert.deepStrictEqual(f.map(x => [x.name, x.hunks.length]), [['one.txt', 1], ['two.txt', 1]]);
  assert.deepStrictEqual(D.parsePatchFiles('garbage').length, 0);
});
t('bug 12: each file applies on its own', () => {
  const [one, two] = D.parsePatchFiles(MULTI);
  assert.deepStrictEqual(D.applyPatchFile('alpha\nbeta\n', one), { ok: true, text: 'alpha\nBETA\n', fuzzy: false, mismatches: [], hunks: 1 });
  assert.strictEqual(D.applyPatchFile('gamma\n', two).text, 'gamma\ndelta\n');
  const unrelated = D.applyPatchFile('nothing alike\n', two);
  assert.ok(!unrelated.ok || unrelated.fuzzy, 'unrelated file applied silently');
  assert.deepStrictEqual(unrelated.mismatches, [{ hunk: 1, line: 1, expected: 'gamma', actual: 'nothing alike' }]);
});
t('bug 12: a fuzzy apply lists exactly the context lines that did not match', () => {
  const patch = D.unifiedPatch('one\ntwo\nthree\nfour\nfive\n', 'one\ntwo\nTHREE\nfour\nfive\n', 'f', 'f');
  const [file] = D.parsePatchFiles(patch);
  const r = D.applyPatchFile('one\nTWO\nthree\nfour\nfive\n', file);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.fuzzy, true);
  assert.strictEqual(r.text, 'one\nTWO\nTHREE\nfour\nfive\n');
  assert.deepStrictEqual(r.mismatches, [{ hunk: 1, line: 2, expected: 'two', actual: 'TWO' }]);
});

// ---- v4: bug 14, line endings and the final newline
t('bug 14: line-ending and final-newline differences are reported', () => {
  assert.deepStrictEqual(D.textFacts('a\r\nb\r\n'), { eol: 'CRLF', finalNewline: true });
  assert.deepStrictEqual(D.textFacts('a\nb'), { eol: 'LF', finalNewline: false });
  assert.deepStrictEqual(D.textFacts('a\r\nb\nc'), { eol: 'mixed', finalNewline: false });
  assert.deepStrictEqual(D.textFacts('one line'), { eol: 'none', finalNewline: false });
  const r = D.lineDiff('a\r\nb\r\n', 'a\nb\n');
  assert.strictEqual(r.hunks.length, 0);
  assert.deepStrictEqual(r.notes, ['Line endings differ: the original uses CRLF (Windows), the modified file uses LF (Unix and macOS).']);
  assert.deepStrictEqual(D.lineDiff('a\nb', 'a\nb\n').notes, ['No newline at end of file in the original.']);
  assert.deepStrictEqual(D.lineDiff('a\nb\n', 'a\nb\n').notes, []);
});

// ---- v4: bug 15, ignore blank lines
t('bug 15: with ignoreBlank, blank lines are left out of the comparison entirely', () => {
  const r = D.lineDiff('a\nb\n', 'a\n\n\nb\n', { ignoreBlank: true });
  assert.strictEqual(r.hunks.length, 0); assert.strictEqual(r.stats.added, 0);
  assert.deepStrictEqual(r.rows.map(x => [x.type, x.l && x.l.n, x.r && x.r.n]), [['eq', 1, 1], ['blank', null, 2], ['blank', null, 3], ['eq', 2, 4]]);
  const r2 = D.lineDiff('a\n\nb\nc\n', 'a\nb\n\nC\n', { ignoreBlank: true });
  assert.strictEqual(r2.hunks.length, 1); assert.strictEqual(r2.stats.modified, 1);
  assert.deepStrictEqual(r2.rows.filter(x => x.type !== 'blank').map(x => x.type), ['eq', 'eq', 'mod']);
  // blank lines on both sides at the same place still pair up
  assert.deepStrictEqual(D.lineDiff('a\n\nb\n', 'a\n\nb\n', { ignoreBlank: true }).rows.map(x => x.type), ['eq', 'eq', 'eq']);
  // without the option a blank line is a change
  assert.strictEqual(D.lineDiff('a\nb\n', 'a\n\nb\n').hunks.length, 1);
});

// ---- v4: bug 16, invisible characters
t('bug 16: show whitespace labels NBSP, zero-width, BOM and bidi characters', () => {
  const h = D.renderLine('a b​c‍d﻿e‮f⁦g', null, 'text', true);
  ['NBSP', 'ZWSP', 'ZWJ', 'BOM', 'RLO', 'LRI'].forEach(lbl => assert.ok(h.includes('>' + lbl + '<'), lbl + ' missing in ' + h));
  assert.ok(/title="U\+00A0 no-break space"/.test(h), h);
  assert.ok(!/[ ​‍﻿‮⁦]/.test(h), 'raw invisible character left in the output');
  // without show whitespace, plain text is untouched...
  assert.strictEqual(D.renderLine('a b', null, 'text', false), 'a b');
  // ...but an invisible character inside a change is always marked
  const seg = D.intraline('ab', 'a​b', 'char');
  assert.ok(D.renderLine('a​b', seg.b, 'text', false).includes('>ZWSP<'));
});

// ---- v4: bug 17, row order aligned with an LCS
t('bug 17: by row order, an inserted row is one added row, not 50,000 changes', () => {
  const head = [['id', 'v']], body = Array.from({ length: 50000 }, (_, i) => [String(i), 'v' + i]);
  const t0 = Date.now(), r = D.tableDiff(head.concat(body), head.concat([['new', 'x']], body), { keys: [] });
  assert.ok(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
  assert.strictEqual(r.added.length, 1); assert.strictEqual(r.changed.length, 0); assert.strictEqual(r.removed.length, 0); assert.strictEqual(r.unchanged, 50000);
  assert.strictEqual(r.added[0].row.id, 'new');
  const r2 = D.tableDiff([['a'], ['1'], ['2'], ['3']], [['a'], ['1'], ['two'], ['3']], { keys: [] });
  assert.strictEqual(r2.changed.length, 1); assert.deepStrictEqual(r2.changed[0].cells, [{ col: 'a', old: '2', new: 'two' }]);
  assert.strictEqual(r2.changed[0].key, 'row 2');
});

// ---- v4: bug 20, expanding one fold
t('bug 20: foldContext can keep chosen folds open', () => {
  const a = Array.from({ length: 60 }, (_, i) => 'l' + i), b = a.slice(); b[20] = 'X'; b[45] = 'Y';
  const rows = D.lineDiff(a.join('\n'), b.join('\n')).rows;
  const folded = D.foldContext(rows, 2);
  const skips = folded.filter(r => r.type === 'skip');
  assert.strictEqual(skips.length, 3);
  const open1 = D.foldContext(rows, 2, [skips[1].from]);
  assert.strictEqual(open1.filter(r => r.type === 'skip').length, 2);
  assert.deepStrictEqual(open1.filter(r => r.type === 'skip').map(r => r.from), [skips[0].from, skips[2].from]);
  assert.strictEqual(open1.length, folded.length - 1 + skips[1].count);
});

// ---- v4 feature 21: folder compare
t('feature 21: ignore filters', () => {
  const ign = D.compileIgnore(D.DEFAULT_IGNORE);
  ['.git/config', 'src/node_modules/x/y.js', 'bin/app.dll', 'proj/obj/Debug/a.o', '.vs/settings', 'logs/run.log', 'a/.DS_Store', 'Thumbs.db'].forEach(p => assert.ok(ign(p), p));
  ['src/app.js', 'binary.txt', 'object.cs', 'catalog.txt', 'README.md'].forEach(p => assert.ok(!ign(p), p));
  const custom = D.compileIgnore(['dist/', 'docs/*.pdf', '*.min.js']);
  assert.ok(custom('dist/a.js') && custom('docs/x.pdf') && custom('lib/jquery.min.js'));
  assert.ok(!custom('src/dist.js') && !custom('docs/sub/x.pdf') && !custom('docs/x.md'));
});
t('feature 21: folder diff by size, date and content', () => {
  const A = [{ path: 'a.txt', size: 3, mtime: 1000, hash: 'h1' }, { path: 'dir/b.txt', size: 5, mtime: 1000, hash: 'h2' }, { path: 'gone.txt', size: 1, mtime: 0 }];
  const B = [{ path: 'a.txt', size: 3, mtime: 9000, hash: 'h1' }, { path: 'dir/b.txt', size: 5, mtime: 1000, hash: 'hX' }, { path: 'new.txt', size: 2, mtime: 0 }];
  const st = rows => Object.fromEntries(rows.map(r => [r.path, r.status]));
  assert.deepStrictEqual(st(D.folderDiff(A, B, 'content')), { 'a.txt': 'same', 'dir/b.txt': 'modified', 'gone.txt': 'removed', 'new.txt': 'added' });
  assert.deepStrictEqual(st(D.folderDiff(A, B, 'size')), { 'a.txt': 'same', 'dir/b.txt': 'same', 'gone.txt': 'removed', 'new.txt': 'added' });
  const byDate = D.folderDiff(A, B, 'date');
  assert.strictEqual(st(byDate)['a.txt'], 'modified'); assert.strictEqual(byDate.find(r => r.path === 'a.txt').newer, 'b');
  assert.strictEqual(st(byDate)['dir/b.txt'], 'same');
  // equal sizes without hashes are reported as needing a hash, never guessed
  const pend = D.folderDiff([{ path: 'x', size: 4 }], [{ path: 'x', size: 4 }], 'content');
  assert.strictEqual(pend[0].status, 'pending');
  assert.strictEqual(D.folderDiff([{ path: 'x', size: 4 }], [{ path: 'x', size: 5 }], 'content')[0].status, 'modified');
  assert.strictEqual(D.folderDiff([{ path: 'x', size: 4, crc: 7 }], [{ path: 'x', size: 4, crc: 7 }], 'content')[0].status, 'same');
});
t('feature 21: tree with per-folder counts, hide identical and status filter', () => {
  const rows = D.folderDiff(
    [{ path: 'src/a.js', size: 1, hash: 'x' }, { path: 'src/lib/b.js', size: 1, hash: 'x' }, { path: 'README', size: 1, hash: 'r' }],
    [{ path: 'src/a.js', size: 1, hash: 'y' }, { path: 'src/lib/b.js', size: 1, hash: 'x' }, { path: 'src/c.js', size: 1, hash: 'c' }, { path: 'README', size: 1, hash: 'r' }], 'content');
  const tree = D.buildTree(rows);
  assert.deepStrictEqual(tree.counts, { added: 1, removed: 0, modified: 1, same: 2, pending: 0 });
  const src = tree.children.find(c => c.name === 'src');
  assert.deepStrictEqual(src.counts, { added: 1, removed: 0, modified: 1, same: 1, pending: 0 });
  const all = D.flattenTree(tree, new Set(['src', 'src/lib']), {});
  assert.deepStrictEqual(all.map(x => '  '.repeat(x.depth) + x.node.name), ['src', '  lib', '    b.js', '  a.js', '  c.js', 'README']);
  const changed = D.flattenTree(tree, new Set(['src', 'src/lib']), { hideIdentical: true });
  assert.deepStrictEqual(changed.map(x => x.node.name), ['src', 'a.js', 'c.js']);
  assert.deepStrictEqual(D.flattenTree(tree, new Set(['src']), { status: 'added' }).map(x => x.node.name), ['src', 'c.js']);
  assert.deepStrictEqual(D.flattenTree(tree, new Set(), {}).map(x => x.node.name), ['src', 'README']);
});
t('feature 21: folder report as CSV states the options and date', () => {
  const rows = D.folderDiff([{ path: 'a,b.txt', size: 1, mtime: Date.UTC(2026, 0, 1), hash: 'x' }], [{ path: 'a,b.txt', size: 2, mtime: Date.UTC(2026, 0, 2), hash: 'y' }], 'content');
  const csv = D.folderCsv(rows, { by: 'content (SHA-256)', ignore: ['.git'], generated: '2026-11-23T10:00:00Z', left: 'v1', right: 'v2' });
  assert.ok(csv.startsWith('Report,Layerbit folder comparison\r\nGenerated,2026-11-23T10:00:00Z\r\nLeft,v1\r\nRight,v2\r\nCompared by,content (SHA-256)\r\nIgnored,.git\r\n\r\nPath,Status,Size left,Size right,Modified left,Modified right\r\n'), csv);
  assert.ok(csv.includes('"a,b.txt",modified,1,2,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z'), csv);
});
t('feature 21: zip entries carry their modified time', () => {
  // DOS date 2026-11-23 (year 46, month 11, day 23) time 10:30:20 (seconds/2 = 10)
  const date = (46 << 9) | (11 << 5) | 23, time = (10 << 11) | (30 << 5) | 10;
  assert.strictEqual(D.dosTime(date, time), new Date(2026, 10, 23, 10, 30, 20).getTime());
});

// ---- v4 feature 22: workbook sheets
t('feature 22: sheets pair by name; renamed-looking, added and removed are listed', () => {
  const S = (name, rows) => ({ name, rows });
  const A = [S('Orders', [['id', 'qty'], ['1', '5']]), S('Customers', [['id', 'name'], ['1', 'Ann']]), S('Old', [['x'], ['1']]), S('Notes', [['n'], ['hi']])];
  const B = [S('Orders', [['id', 'qty'], ['1', '6']]), S('Clients', [['id', 'name'], ['1', 'Ann']]), S('Notes', [['n'], ['hi']]), S('Extra', [['z'], ['9']])];
  const p = D.pairSheets(A, B);
  assert.deepStrictEqual(p.pairs.map(x => [x.a, x.b, !!x.renamed]), [['Orders', 'Orders', false], ['Customers', 'Clients', true], ['Notes', 'Notes', false]]);
  assert.deepStrictEqual(p.removed, ['Old']); assert.deepStrictEqual(p.added, ['Extra']);
  // a sheet with different headers is not called a rename
  assert.deepStrictEqual(D.pairSheets([S('A', [['p', 'q']])], [S('B', [['r', 's']])]), { pairs: [], added: ['B'], removed: ['A'] });
});

// ---- v4 feature 23: table options
t('feature 23: composite keys, ignored columns and the per-column summary', () => {
  const A = [['region', 'sku', 'qty', 'note', 'updated'], ['UAE', '1', '5', 'a', 't1'], ['KSA', '1', '7', 'b', 't1'], ['UAE', '2', '9', 'c', 't1']];
  const B = [['sku', 'region', 'qty', 'note', 'updated'], ['1', 'KSA', '8', 'b', 't2'], ['1', 'UAE', '5', 'A', 't2'], ['2', 'UAE', '9', 'c', 't2']];
  const r = D.tableDiff(A, B, { keys: ['region', 'sku'], ignore: ['updated'] });
  assert.strictEqual(r.keyName, 'region + sku'); assert.strictEqual(r.changed.length, 2); assert.strictEqual(r.unchanged, 1);
  assert.deepStrictEqual(r.colChanges, { qty: 1, note: 1 });
  assert.ok(r.changed.every(c => c.cells.every(x => x.col !== 'updated')));
});
t('feature 23: trim, ignore case and empty = null', () => {
  const A = [['id', 'v', 'w'], ['1', ' Apple ', ''], ['2', 'x', 'NULL']], B = [['id', 'v', 'w'], ['1', 'apple', ''], ['2', 'x', '']];
  assert.strictEqual(D.tableDiff(A, B, { keys: ['id'] }).changed.length, 2);
  assert.strictEqual(D.tableDiff(A, B, { keys: ['id'], trim: true, ignoreCase: true }).changed.length, 1);
  assert.strictEqual(D.tableDiff(A, B, { keys: ['id'], trim: true, ignoreCase: true, emptyNull: true }).changed.length, 0);
  // keys are normalised by the same options
  assert.strictEqual(D.tableDiff([['id', 'v'], [' A1', '1']], [['id', 'v'], ['a1', '1']], { keys: ['id'], trim: true, ignoreCase: true }).unchanged, 1);
});
t('feature 23: numbers: 1.0 = 1, absolute and percentage tolerance, long numbers stay exact', () => {
  const A = [['id', 'n'], ['1', '1.0'], ['2', '100'], ['3', '12345678901234567890'], ['4', '0012']], B = [['id', 'n'], ['1', '1'], ['2', '100.4'], ['3', '12345678901234567891'], ['4', '12']];
  const keys = { keys: ['id'] };
  assert.strictEqual(D.tableDiff(A, B, keys).changed.length, 4);
  const num = D.tableDiff(A, B, Object.assign({ numeric: true }, keys));
  assert.deepStrictEqual(num.changed.map(c => c.key), ['2', '3']);  // 1.0 = 1 and 0012 = 12; long numbers compared digit by digit
  assert.deepStrictEqual(D.tableDiff(A, B, Object.assign({ tolAbs: 0.5 }, keys)).changed.map(c => c.key), ['3']);
  assert.deepStrictEqual(D.tableDiff(A, B, Object.assign({ tolPct: 0.5 }, keys)).changed.map(c => c.key), ['3']);
  assert.deepStrictEqual(D.tableDiff(A, B, Object.assign({ tolPct: 0.1 }, keys)).changed.map(c => c.key), ['2', '3']);
});
t('feature 23: dates in different formats compare equal when asked', () => {
  const A = [['id', 'd'], ['1', '2026-11-05'], ['2', '05/11/2026'], ['3', '2026-11-05 14:30'], ['4', '31/12/2026']];
  const B = [['id', 'd'], ['1', '5 Nov 2026'], ['2', '2026-11-05'], ['3', '05.11.2026 2:30 PM'], ['4', '2026-12-30']];
  assert.strictEqual(D.tableDiff(A, B, { keys: ['id'] }).changed.length, 4);
  assert.deepStrictEqual(D.tableDiff(A, B, { keys: ['id'], dates: true }).changed.map(c => c.key), ['4']);
  // month-first reading when asked
  assert.strictEqual(D.tableDiff([['d'], ['11/05/2026']], [['d'], ['2026-11-05']], { dates: true, dayFirst: false }).changed.length, 0);
  assert.strictEqual(D.normaliseDate('2026-02-30'), null);
});
t('feature 24: byteRanges finds differing runs, merges across chunk boundaries and counts the tail', () => {
  const a = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), b = Uint8Array.from([1, 9, 9, 4, 5, 6, 0, 0, 0, 0]);
  const ranges = []; let n = 0;
  // scanned in three uneven chunks, the way the page streams big files
  [[0, 2], [2, 7], [7, 10]].forEach(([s, e]) => { n += D.byteRanges(a.subarray(s, e), b.subarray(s, e), s, ranges); });
  assert.deepStrictEqual(ranges.map(r => [r[0], r[1]]), [[1, 3], [6, 10]]);
  assert.strictEqual(n, 6);  // 2 changed + 2 changed + 2 bytes only on the right
  // identical and empty inputs
  const r2 = []; assert.strictEqual(D.byteRanges(a, a.slice(), 0, r2), 0); assert.strictEqual(r2.length, 0);
  const r3 = []; assert.strictEqual(D.byteRanges(new Uint8Array(0), Uint8Array.from([0]), 0, r3), 1); assert.deepStrictEqual(r3.map(r => [r[0], r[1]]), [[0, 1]]);
  // a cap on stored ranges keeps the byte count exact and says so
  const x = new Uint8Array(100), y = new Uint8Array(100); for (let i = 0; i < 100; i += 2) y[i] = 1;
  const capped = []; assert.strictEqual(D.byteRanges(x, y, 0, capped, 10), 50);
  assert.strictEqual(capped.length, 10); assert.strictEqual(capped.truncated, true);
});
t('feature 24: parseOffset reads hex and decimal offsets and rejects junk', () => {
  assert.strictEqual(D.parseOffset('0x1F'), 31);
  assert.strictEqual(D.parseOffset('1fh'), 31);
  assert.strictEqual(D.parseOffset('  4096 '), 4096);
  assert.strictEqual(D.parseOffset('1,048,576'), 1048576);
  assert.strictEqual(D.parseOffset('00FF'), 255);       // hex digits without a prefix read as hex
  assert.strictEqual(D.parseOffset('0010'), 10);        // digits only read as decimal
  assert.strictEqual(D.parseOffset('0x'), null);
  assert.strictEqual(D.parseOffset('-5'), null);
  assert.strictEqual(D.parseOffset('xyz'), null);
  assert.strictEqual(D.parseOffset(''), null);
});
t('feature 24: hexOffset pads to the width the file needs', () => {
  assert.strictEqual(D.hexOffset(31, 100), '0000001F');
  assert.strictEqual(D.hexOffset(0x123456789, 0x200000000), '123456789');
  assert.strictEqual(D.asciiByte(65), 'A'); assert.strictEqual(D.asciiByte(0), '.'); assert.strictEqual(D.asciiByte(200), '.');
});
t('feature 25: imageFormat sniffs PNG, JPEG, GIF, WebP, BMP and SVG by their bytes, not the name', () => {
  const b = a => Uint8Array.from(a), enc = s => new TextEncoder().encode(s);
  assert.strictEqual(D.imageFormat(b([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0]), 'x.jpg'), 'PNG');
  assert.strictEqual(D.imageFormat(b([0xFF, 0xD8, 0xFF, 0xE0, 0]), 'photo.png'), 'JPEG');
  assert.strictEqual(D.imageFormat(enc('GIF89a....'), 'a.gif'), 'GIF');
  assert.strictEqual(D.imageFormat(enc('RIFF\0\0\0\0WEBPVP8 '), 'a'), 'WebP');
  assert.strictEqual(D.imageFormat(enc('BM\0\0\0\0'), 'a.bmp'), 'BMP');
  assert.strictEqual(D.imageFormat(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'icon'), 'SVG');
  assert.strictEqual(D.imageFormat(enc('﻿<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg/>'), 'logo.svg'), 'SVG');
  assert.strictEqual(D.imageFormat(enc('hello'), 'notes.txt'), null);
  assert.strictEqual(D.imageFormat(new Uint8Array(0), 'empty.png'), null);
});
t('feature 25: pixelDiff counts changed pixels with a tolerance and draws a difference image', () => {
  const W = 10, H = 10, mk = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] == null ? 255 : c[3]; } return d; };
  const a = mk(W, H, () => [200, 0, 0]);
  // 2x2 block clearly different, a 4x1 strip off by 3 levels
  const b = mk(W, H, (x, y) => x < 2 && y < 2 ? [0, 0, 255] : y === 9 && x < 4 ? [203, 0, 0] : [200, 0, 0]);
  const out = new Uint8ClampedArray(W * H * 4);
  const r0 = D.pixelDiff(a, W, H, b, W, H, 0, out);
  assert.strictEqual(r0.changed, 8); assert.strictEqual(r0.total, 100); assert.strictEqual(r0.percent, 8);
  assert.deepStrictEqual(r0.bbox, [0, 0, 3, 9]);
  assert.deepStrictEqual(Array.from(out.subarray(0, 4)), [255, 0, 160, 255]);      // changed pixel marked
  assert.notDeepStrictEqual(Array.from(out.subarray(4 * 55, 4 * 55 + 4)), [255, 0, 160, 255]);
  const r5 = D.pixelDiff(a, W, H, b, W, H, 5);
  assert.strictEqual(r5.changed, 4); assert.deepStrictEqual(r5.bbox, [0, 0, 1, 1]);
  // identical images, and fully transparent pixels whatever their colour
  assert.strictEqual(D.pixelDiff(a, W, H, a.slice(), W, H, 0).changed, 0);
  const t1 = mk(2, 1, () => [1, 2, 3, 0]), t2 = mk(2, 1, () => [9, 9, 9, 0]);
  assert.strictEqual(D.pixelDiff(t1, 2, 1, t2, 2, 1, 0).changed, 0);
  assert.strictEqual(D.pixelDiff(a, W, H, a.slice(), W, H, 0).bbox, null);
});
t('feature 25: pixelDiff with different dimensions compares the union and counts the uncovered area', () => {
  const a = new Uint8ClampedArray(4 * 2 * 4).fill(255), b = new Uint8ClampedArray(2 * 4 * 4).fill(255);
  const r = D.pixelDiff(a, 4, 2, b, 2, 4, 0);
  assert.strictEqual(r.width, 4); assert.strictEqual(r.height, 4); assert.strictEqual(r.total, 16);
  // covered by both: 2x2 same; covered by one only: 4 + 4 = 8 changed; covered by neither: 4, same
  assert.strictEqual(r.changed, 8); assert.strictEqual(r.percent, 50);
});
