// Node unit tests for js/engines/tabular.js: nesting dotted headers,
// flattening, JSON Lines, column plans and the streaming CSV reader.
// Run: node scripts/unit/tabular.test.js
const assert = require('assert');
let T, C, L;
let n = 0, failed = 0;
function t(name, fn) {
  try {
    if (!T) { T = require('../../js/engines/tabular.js'); C = require('../../js/engines/csv.js'); L = require('../../js/engines/lossless-json.js'); }
    fn(); n++;
  } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
}
const plain = v => JSON.parse(L.stringify(v));

t('nest: dotted headers become nested objects, numeric parts become arrays', () => {
  const r = T.nest({ id: 1, 'user.name': 'Ada', 'user.address.city': 'Dubai', 'tags.0': 'a', 'tags.1': 'b' });
  assert.deepStrictEqual(r.value, { id: 1, user: { name: 'Ada', address: { city: 'Dubai' } }, tags: ['a', 'b'] });
  assert.deepStrictEqual(r.conflicts, []);
});
t('nest: a key that is both a value and a parent is reported and kept flat', () => {
  const r = T.nest({ a: 1, 'a.b': 2, c: 3 });
  assert.deepStrictEqual(r.value, { a: 1, 'a.b': 2, c: 3 });
  assert.deepStrictEqual(r.conflicts, ['a.b']);
});
t('nest: other separators, empty parts and __proto__ stay ordinary keys', () => {
  assert.deepStrictEqual(T.nest({ 'a/b': 1 }, '/').value, { a: { b: 1 } });
  assert.deepStrictEqual(T.nest({ 'a..b': 1, '.x': 2 }).value, { 'a..b': 1, '.x': 2 });
  const r = T.nest({ '__proto__.polluted': 'yes' }).value;
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(Object.keys(r)[0], '__proto__');
});
t('nest: sparse or non-zero-based numeric parts become object keys, not holes', () => {
  assert.deepStrictEqual(T.nest({ 'x.1': 'b', 'x.2': 'c' }).value, { x: { 1: 'b', 2: 'c' } });
  assert.deepStrictEqual(T.nest({ 'x.0': 'a', 'x.2': 'c' }).value, { x: { 0: 'a', 2: 'c' } });
});
t('flatten: nested objects and arrays become dotted keys; nest(flatten(x)) is x', () => {
  const x = { id: new L.LosslessNumber('12345678901234567890'), user: { name: 'Ada', roles: ['admin', 'dev'] }, empty: {}, none: [], n: null };
  const f = T.flatten(x);
  assert.deepStrictEqual(Object.keys(f), ['id', 'user.name', 'user.roles.0', 'user.roles.1', 'empty', 'none', 'n']);
  assert.strictEqual(f.id.value, '12345678901234567890');
  assert.deepStrictEqual(plain(T.nest(f).value), plain(x));
});
t('JSON Lines: blank lines skipped, errors carry their line, numbers stay exact', () => {
  const r = T.parseJSONL('{"a":1}\n\n{"a":12345678901234567890}\r\n{"a":\n[1,2]\n');
  assert.strictEqual(r.records.length, 3);
  assert.strictEqual(r.records[1].a.value, '12345678901234567890');
  assert.deepStrictEqual(plain(r.records[2]), [1, 2]);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].line, 4);
  assert.strictEqual(T.toJSONL([{ a: 1 }, { b: [1, 2] }]), '{"a":1}\n{"b":[1,2]}\n');
});
t('detectJSON: an array, an object, JSON Lines, and broken JSON stays JSON (for its error)', () => {
  assert.strictEqual(T.detectJSON('[{"a":1}]'), 'json');
  assert.strictEqual(T.detectJSON('{"a":1}'), 'json');
  assert.strictEqual(T.detectJSON('{"a":1}\n{"a":2}\n'), 'jsonl');
  assert.strictEqual(T.detectJSON('{"a":1,}'), 'json');
  assert.strictEqual(T.detectJSON('{"a":1}\n{"a":'), 'json');
});
t('unionKeys keeps first-seen order across records', () => {
  assert.deepStrictEqual(T.unionKeys([{ b: 1, a: 2 }, { a: 1, c: 3 }]), ['b', 'a', 'c']);
});
t('column plan: rename, drop and reorder survive new data; new columns are appended', () => {
  let plan = T.planFor(['id', 'name', 'email']);
  plan = T.movePlan(T.renamePlan(T.togglePlan(plan, 'email', false), 'name', 'full_name'), 'name', -1);
  assert.deepStrictEqual(T.applyPlan(['id', 'name', 'email'], plan), { names: ['full_name', 'id'], index: [1, 0] });
  const next = T.planFor(['id', 'name', 'email', 'phone'], plan);
  assert.deepStrictEqual(T.applyPlan(['id', 'name', 'email', 'phone'], next), { names: ['full_name', 'id', 'phone'], index: [1, 0, 3] });
  assert.deepStrictEqual(T.applyPlan(['name', 'id'], next), { names: ['full_name', 'id'], index: [0, 1] });
});
t('column plan: renaming two columns to one name keeps both (second gets a suffix)', () => {
  const plan = T.renamePlan(T.planFor(['a', 'b']), 'b', 'a');
  assert.deepStrictEqual(T.applyPlan(['a', 'b'], plan).names, ['a', 'a (2)']);
});

// ---- streaming reader: must agree with LBCsv.parse however the text is split
const MESSY = [
  'a,b,c\n1,2,3\n4,5,6\n',
  '﻿id;name\r\n1;"Smith; Jane"\r\n2;"multi\r\nline"\r\n',
  'sku,desc,price\n1,5" screen,1.50\n2,"say ""hi""",9\n\n\n3,x,1\n',
  'h\nA\n\nB\n\n\n',
  'a,b\n"unclosed,1\n2,3\n',
  'a,b\r1,2\r3\r4,5,6\r',
  'a|b\n"x""",y\n"",\n',
  'x,y\n"a"b,c\n"q\rr",s\n'
];
function streamAll(text, size, delimiter) {
  const r = T.csvReader({ delimiter });
  const rows = [];
  for (let i = 0; i < text.length; i += size) { const got = r.push(text.slice(i, i + size)); if (got.header) rows.push(got.header); rows.push(...got.rows); }
  const last = r.end(); if (last.header) rows.push(last.header); rows.push(...last.rows);
  return { rows, issues: r.issues, delimiter: r.delimiter };
}
t('stream reader: same rows and issues as the in-memory parser at every split size', () => {
  for (const text of MESSY) {
    const want = C.parse(text);
    for (const size of [1, 2, 3, 5, 7, 64, 100000]) {
      const got = streamAll(text, size);
      assert.deepStrictEqual(got.rows, want.rows, JSON.stringify(text) + ' split ' + size);
      assert.deepStrictEqual(got.issues.map(x => x.line + ':' + x.message), want.issues.map(x => x.line + ':' + x.message), 'issues ' + JSON.stringify(text) + ' split ' + size);
      assert.strictEqual(got.delimiter, want.delimiter);
    }
  }
});
t('stream reader: a random 5,000-row file with quotes and newlines, random slices', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const vals = ['plain', 'with, comma', 'with "quote"', 'multi\nline', '', '0012', '5" x', 'é ü 中'];
  const lines = ['id,text,note'];
  for (let i = 0; i < 5000; i++) lines.push([i, vals[Math.floor(rnd() * vals.length)], vals[Math.floor(rnd() * vals.length)]].map(v => C.cell(String(v))).join(','));
  const text = lines.join('\r\n') + '\r\n', want = C.parse(text);
  const r = T.csvReader({}), rows = [];
  let i = 0; while (i < text.length) { const k = 1 + Math.floor(rnd() * 4000); const g = r.push(text.slice(i, i + k)); if (g.header) rows.push(g.header); rows.push(...g.rows); i += k; }
  const g = r.end(); rows.push(...g.rows);
  assert.strictEqual(rows.length, want.rows.length);
  assert.deepStrictEqual(rows, want.rows);
});

// ---- records: the same conversion the page and the Worker use
t('records: types per column, never changing a value; nesting; plan', () => {
  const rows = C.parse('id,zip,user.name,user.age,active\n1,00123,Ada,36,true\n2,94107,Bob,,no\n').rows;
  const conv = T.recordConverter(rows[0], { infer: true, types: { active: 'boolean' }, nest: true });
  const recs = rows.slice(1).map(conv.convert);
  assert.deepStrictEqual(plain(recs), [{ id: 1, zip: '00123', user: { name: 'Ada', age: 36 }, active: true }, { id: 2, zip: 94107, user: { name: 'Bob', age: '' }, active: false }]);
  const conv2 = T.recordConverter(rows[0], { infer: false, plan: T.togglePlan(T.planFor(rows[0]), 'zip', false) });
  assert.deepStrictEqual(plain(conv2.convert(rows[1])), { id: '1', 'user.name': 'Ada', 'user.age': '36', active: 'true' });
});
t('records: JSON text of a whole conversion equals the in-memory pretty print', () => {
  const rows = C.parse('a,b\n1,x\n2,"y\nz"\n').rows;
  const conv = T.recordConverter(rows[0], { infer: true });
  const recs = rows.slice(1).map(conv.convert);
  const w = T.jsonWriter('json');
  const text = w.begin() + recs.map((r, i) => w.record(r, i)).join('') + w.end(recs.length);
  assert.strictEqual(text, L.stringify(recs, 4));
  assert.strictEqual(w.end(0), '[]');
  const jl = T.jsonWriter('jsonl');
  assert.strictEqual(jl.begin() + recs.map((r, i) => jl.record(r, i)).join('') + jl.end(2), T.toJSONL(recs));
});

t('csvRow: the escape rule of the CSV writer, formulas guarded when asked', () => {
  assert.strictEqual(T.csvRow(['a,b', 'say "hi"', 'x\ny', null, new L.LosslessNumber('12345678901234567890'), { k: 1 }, true]), '"a,b","say ""hi""","x\ny",,12345678901234567890,"{""k"":1}",true');
  assert.strictEqual(T.csvRow(['=1+1', '-5', '@x'], true), "'=1+1,-5,'@x");
  assert.strictEqual(T.csvRow(['=1+1'], false), '=1+1');
});

console.log(`${n} passed, ${failed} failed`);
