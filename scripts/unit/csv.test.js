// Node unit tests for js/engines/csv.js, the one CSV parser every tool uses.
// Run: node scripts/unit/csv.test.js
const assert = require('assert');
let C;
let n = 0, failed = 0;
function t(name, fn) { try { if (!C) C = require('../../js/engines/csv.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }

t('A2: a quote that does not start a field is a literal character (Excel behaviour)', () => {
  const r = C.parse('sku,desc,price\n1,5" screen,1.50\n2,stand,9.99\n');
  assert.deepStrictEqual(r.rows, [['sku', 'desc', 'price'], ['1', '5" screen', '1.50'], ['2', 'stand', '9.99']]);
  assert.deepStrictEqual(r.issues, []);
});
t('A2: quoted fields keep delimiters, newlines and doubled quotes', () => {
  const r = C.parse('a,b\n"x, y","line1\nline2"\n"say ""hi""",z\n');
  assert.deepStrictEqual(r.rows, [['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', 'z']]);
});
t('A2: CRLF, bare CR and a BOM', () => {
  assert.deepStrictEqual(C.parse('﻿a,b\r\n1,2\r\n').rows, [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(C.parse('a,b\r1,2\r3,4').rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepStrictEqual(C.parse('a,b\r\n"x\r\ny",2\r\n').rows, [['a', 'b'], ['x\r\ny', '2']]);
});
t('A2: delimiter detection ignores delimiters inside quotes', () => {
  assert.strictEqual(C.detectDelimiter('name;note\n"a, b, c";x\n"d, e, f";y\n'), ';');
  assert.strictEqual(C.detectDelimiter('a\tb\tc\n1\t2\t3\n'), '\t');
  assert.strictEqual(C.detectDelimiter('a|b\n1|2\n'), '|');
  assert.strictEqual(C.detectDelimiter('id,desc\n1,5" screen; large\n2,stand; small\n'), ',');
  assert.strictEqual(C.parse('name;note\n"a, b";x\n').delimiter, ';');
});
t('A2: duplicate header names are made unique', () => {
  assert.deepStrictEqual(C.uniqueHeaders(['id', 'amount', 'amount', '', 'amount']), ['id', 'amount', 'amount (2)', '(column 4)', 'amount (3)']);
  assert.deepStrictEqual(C.uniqueHeaders(['a', 'a', 'a (2)']), ['a', 'a (3)', 'a (2)']);
});
t('A2: a single-column file keeps rows whose value is empty', () => {
  assert.deepStrictEqual(C.parse('email\na@x.com\n\nb@x.com\n').rows, [['email'], ['a@x.com'], [''], ['b@x.com']]);
  // in a multi-column file a blank line is not a row
  assert.deepStrictEqual(C.parse('a,b\n1,2\n\n3,4\n').rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
  // a trailing newline never adds a row
  assert.deepStrictEqual(C.parse('email\nx\n').rows, [['email'], ['x']]);
});
t('A2: rows with the wrong number of columns are reported with their line', () => {
  const r = C.parse('a,b,c\n1,2,3\n4,5\n6,7,8,9\n');
  assert.deepStrictEqual(r.issues.map(i => [i.line, i.expected, i.got]), [[3, 3, 2], [4, 3, 4]]);
  // a quoted newline does not shift the reported line numbers of later rows
  const q = C.parse('a,b\n"x\ny",1\n2\n');
  assert.deepStrictEqual(q.issues.map(i => i.line), [4]);
});
t('A2: an unclosed quote is reported instead of silently swallowing the file', () => {
  const r = C.parse('a,b\n"open,1\n2,3\n');
  assert.ok(r.issues.some(i => /quote/i.test(i.message) && i.line === 2), JSON.stringify(r.issues));
});
t('A2: an explicit delimiter wins, and "\\t" means tab', () => {
  assert.deepStrictEqual(C.parse('a;b,c\n1;2,3', { delimiter: ',' }).rows, [['a;b', 'c'], ['1;2', '3']]);
  assert.deepStrictEqual(C.parse('a\tb\n1\t2', { delimiter: '\\t' }).rows, [['a', 'b'], ['1', '2']]);
});
t('A2: parseRows returns plain rows, and empty input is empty', () => {
  assert.deepStrictEqual(C.parseRows('x,y\n1,2'), [['x', 'y'], ['1', '2']]);
  assert.deepStrictEqual(C.parseRows(''), []);
  assert.deepStrictEqual(C.parse('  \n').rows, []);
});
t('A2: writing quotes fields that need it and round-trips', () => {
  const rows = [['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', '']];
  const text = C.stringify(rows);
  assert.strictEqual(text, 'a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",\r\n');
  assert.deepStrictEqual(C.parse(text).rows, rows);
  assert.strictEqual(C.stringify([['a;b', 'c']], { delimiter: ';' }), '"a;b";c\r\n');
});

process.on('beforeExit', () => { if (!failed) console.log(`csv engine: ${n} unit tests passed`); });
