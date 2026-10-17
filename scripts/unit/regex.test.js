// Node unit tests for js/engines/regex.js. Run: node scripts/unit/regex.test.js
const R = require('../../js/engines/regex.js');
const assert = require('assert');
let n = 0; function t(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL', name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n')); process.exitCode = 1; } }

t('parse basic structure', () => {
  const a = R.parse('^(?<y>\\d{4})-(\\d{2})(?:x|y)*$');
  assert.strictEqual(a.type, 'seq'); assert.strictEqual(a.groupCount, 2); assert.deepStrictEqual(a.names, ['y']);
  assert.strictEqual(a.items[0].type, 'anchor'); assert.strictEqual(a.items[1].type, 'group'); assert.strictEqual(a.items[1].name, 'y');
  assert.strictEqual(a.items[1].body.items[0].type, 'quant'); assert.strictEqual(a.items[1].body.items[0].min, 4);
  assert.strictEqual(a.items[4].type, 'quant'); assert.strictEqual(a.items[4].child.capture, false); assert.strictEqual(a.items[4].child.body.type, 'alt');
});
t('parse classes, escapes, lookaround, backrefs, lazy', () => {
  const a = R.parse('[a-z\\d_-]+?(?<=x)(?!y)\\1\\k<n>(?<n>.)\\u0041\\p{L}', 'u');
  assert.strictEqual(a.items[0].type, 'quant'); assert.strictEqual(a.items[0].lazy, true);
  const cls = a.items[0].child; assert.strictEqual(cls.type, 'class'); assert.deepStrictEqual(cls.items.map(x => x.type), ['range', 'set', 'char', 'char']);
  assert.strictEqual(a.items[1].type, 'look'); assert.strictEqual(a.items[1].ahead, false); assert.strictEqual(a.items[2].negative, true);
  assert.strictEqual(a.items[3].type, 'backref'); assert.strictEqual(a.items[3].index, 1); assert.strictEqual(a.items[4].name, 'n');
  assert.strictEqual(a.items[6].value, 'A'); assert.strictEqual(a.items[7].type, 'prop');
});
t('parse errors mirror the engine', () => {
  for (const bad of ['(unclosed', 'a**', '[z-a]', '*a', 'a)', '(?<n>a)(?<n>b)', '[abc']) assert.throws(() => R.parse(bad), bad);
  for (const good of ['a{2,}', 'a{,2}', '{', '}', 'a-b', '[-a]', '[a-]', '\\/', '(?i:x)']) assert.doesNotThrow(() => R.parse(good), good);
});
t('explain produces readable tree', () => {
  const e = R.explain(R.parse('(?<year>\\d{4})-\\d{2}'));
  assert.strictEqual(e[0].label, 'Named group <year>'); assert.ok(e[0].children[0].desc.includes('exactly 4 times'));
  assert.strictEqual(e[1].label, '-'); assert.ok(e[2].desc.includes('exactly 2'));
  assert.ok(R.explain(R.parse('a|b'))[0].label === 'Alternation');
});
t('railroad renders svg with nodes', () => {
  const svg = R.railroad(R.parse('^(ab|c)+\\d?$'));
  assert.ok(svg.startsWith('<svg'), svg.slice(0, 20)); assert.ok(svg.includes('rr-term')); assert.ok(svg.includes('group 1')); assert.ok(svg.includes('rr-anchor'));
  assert.ok(R.railroad(R.parse('')).includes('<svg'));
});
t('analyze flags classic ReDoS patterns', () => {
  const sev = p => R.analyze(R.parse(p), p).severity;
  assert.strictEqual(sev('^(a+)+$'), 'high');
  assert.strictEqual(sev('^(\\w|\\d)*$'), 'high');
  assert.strictEqual(sev('^(\\w+\\s?)+$'), 'high');
  assert.strictEqual(sev('^\\w+@\\w+\\.\\w+$'), 'none');
  assert.strictEqual(sev('\\d+\\.\\d+'), 'none');
  assert.strictEqual(sev('^\\d+\\w+$'), 'medium');
  assert.strictEqual(sev('^(?:ab|cd)+$'), 'none');
  const f = R.analyze(R.parse('(a+)+'), '(a+)+').findings[0]; assert.strictEqual(f.kind, 'nested'); assert.ok(f.advice);
});
t('codegen for every language with caveats', () => {
  const p = '(?<y>\\d{4})-(?<=x)\\d', f = 'gi';
  R.LANGS.forEach(l => { const r = R.codegen(p, f, l, 'x2026-1'); assert.ok(r.code.length > 20, l); });
  assert.ok(R.codegen(p, f, 'python').code.includes('(?P<y>')); assert.ok(R.codegen(p, f, 'python').code.includes('re.IGNORECASE'));
  assert.ok(R.codegen(p, f, 'go').caveats.some(c => /lookbehind/.test(c)));
  assert.ok(R.codegen('a/b', 'g', 'javascript').code.includes('/a\\/b/g'));
  assert.ok(R.codegen('a"b', 'g', 'csharp').code.includes('@"a""b"'));
});
t('runTests', () => {
  const r = R.runTests('(\\d+)-(?<b>\\w+)', 'g', [{ input: '12-ab', expect: 'match' }, { input: 'zz', expect: 'nomatch' }, { input: '12-ab', expect: 'full' }, { input: 'x12-ab', expect: 'full' }, { input: '12-ab', expect: 'match', group: 'b', value: 'ab' }, { input: '12-ab', expect: 'match', group: '1', value: '13' }]);
  assert.deepStrictEqual(r.map(x => x.ok), [true, true, true, false, true, false]);
  assert.strictEqual(R.runTests('(', 'g', [{ input: 'a', expect: 'match' }])[0].ok, false);
});
t('synthesize infers a shape pattern', () => {
  const c = R.synthesize(['AB-1234', 'XY-98', 'QQ-7'], ['AB1234', 'ab-12', '12-AB']);
  assert.ok(c.length >= 3); const best = c[0]; assert.ok(best.ok, JSON.stringify(c.slice(0, 2)));
  const re = new RegExp(best.pattern); assert.ok(re.test('ZZ-55')); assert.ok(!re.test('zz-55'));
  const c2 = R.synthesize(['support@layerbit.co.in', 'a.b@x.org'], ['nope']);
  assert.ok(c2.some(x => x.ok), JSON.stringify(c2));
  assert.deepStrictEqual(R.synthesize([], []), []);
});
console.log(`regex engine: ${n} unit tests passed`);
