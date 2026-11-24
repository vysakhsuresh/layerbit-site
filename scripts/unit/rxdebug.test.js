// Node unit tests for js/engines/rxdebug.js: the traced matcher must find the
// same first match and groups as the real JavaScript engine.
// Run: node scripts/unit/rxdebug.test.js
const assert = require('assert');
const R = require('../../js/engines/regex.js'), D = require('../../js/engines/rxdebug.js');
let n = 0, failed = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
function same(p, f, text) {
  const native = new RegExp(p, f).exec(text), r = D.trace(R.parse(p, f), f, text);
  assert.ok(!r.stopped, `${p} stopped`);
  if (!native) { assert.strictEqual(r.match, null, `/${p}/${f} on ${JSON.stringify(text)}: native finds nothing`); return r; }
  assert.ok(r.match, `/${p}/${f} on ${JSON.stringify(text)}: native matched ${JSON.stringify(native[0])}`);
  assert.deepStrictEqual([r.match.start, r.match.end], [native.index, native.index + native[0].length], `/${p}/${f} span`);
  for (let g = 1; g < native.length; g++) {
    const span = r.match.groups[g], v = span ? text.slice(span[0], span[1]) : undefined;
    assert.strictEqual(v, native[g], `/${p}/${f} group ${g}`);
  }
  return r;
}
t('agrees with the JavaScript engine on 40 patterns', () => {
  const cases = [
    ['^(a|ab)c$', '', 'abc'], ['(a+)+b', '', 'aaab'], ['(\\d{2,3}?)(\\d+)', '', '12345'], ['\\b\\w+@\\w+\\.com\\b', '', 'mail ada@x.com now'],
    ['(?<y>\\d{4})-(?<m>\\d\\d)', '', 'on 2026-11-24'], ['(a)|(b)', '', 'b'], ['(a*)*b', '', 'aab'], ['(a|b)*c', '', 'ababc'],
    ['x(?=y)', '', 'xz xy'], ['(?<=\\$)\\d+', '', 'cost $42'], ['(?<!\\$)\\b\\d+', '', '$5 7'], ['a(?!b)', '', 'ab ac'],
    ['(\\w)\\1', '', 'abccd'], ['(?<q>["\'])(.*?)\\k<q>', '', 'say "hi" now'], ['^foo$', 'm', 'x\nfoo\ny'], ['a.c', 's', 'a\nc'],
    ['a.c', '', 'a\nc abc'], ['HELLO', 'i', 'say hello'], ['[^aeiou\\s]+', '', 'aei xyz'], ['[a-f\\d]+', 'i', 'zz C0FFEE!'],
    ['\\Bcat\\B', '', 'concatenate'], ['(?:ab){2,}', '', 'abababx'], ['a{2}', '', 'a aa'], ['(a?){3}b', '', 'aab'],
    ['^(?:(\\d+)\\.)*(\\d+)$', '', '10.20.30'], ['(x)?y', '', 'y'], ['(.*)-(.*)', '', 'a-b-c'], ['(.*?)-(.*)', '', 'a-b-c'],
    ['[\\]\\[]+', '', 'a[]]b'], ['\\p{L}+', 'u', '123 éclair'], ['^$', '', ''], ['', '', 'abc'], ['(a|)+b', '', 'aab'],
    ['(?:a|b)+?c', '', 'abc'], ['\\d+(?:\\.\\d+)?%', '', 'up 12.5% today'], ['^[A-Z][a-z]+(?: [A-Z][a-z]+)*$', '', 'Ada Lovelace'],
    ['(\\d)(?:(\\d)|x)', '', '1x'], ['([a-z])\\1+', 'i', 'aAa b'], ['.+?', 's', '\n'], ['(?<a>.)(?<b>.)\\k<b>\\k<a>', '', 'xabba']
  ];
  cases.forEach(([p, f, s]) => same(p, f, s));
});
t('records backtracking and stops runaway patterns at the step limit', () => {
  const r = same('^(a|ab)c$', '', 'abc');
  assert.ok(r.backtracks >= 1 && r.steps.some(s => s.kind === 'backtrack'));
  assert.strictEqual(r.steps[r.steps.length - 1].kind, 'success');
  const slow = D.trace(R.parse('^(a+)+$', ''), '', 'a'.repeat(30) + 'b', { maxSteps: 20000 });
  assert.ok(slow.stopped && slow.steps.length === 20000);
});
t('every step points into the pattern and the text', () => {
  const p = '(?<w>\\w+)\\s\\k<w>', r = D.trace(R.parse(p, ''), '', 'the the end');
  r.steps.filter(s => s.kind === 'try').forEach(s => { assert.ok(s.start >= 0 && s.end <= p.length && s.end > s.start); assert.ok(s.pos >= 0 && s.pos <= 11); });
});

console.log(`${n} passed, ${failed} failed`);
