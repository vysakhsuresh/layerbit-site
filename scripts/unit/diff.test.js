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
