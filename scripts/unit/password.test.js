// Unit tests for js/engines/password.js. Run: node scripts/unit/password.test.js
const P = require('../../js/engines/password.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
t('length and sets', () => {
  for (let i = 0; i < 200; i++) { const p = P.generate({ length: 12 }); assert.strictEqual(p.length, 12); assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^a-zA-Z0-9]/.test(p), p); }
  assert.ok(/^\d{8}$/.test(P.generate({ length: 8, lower: false, upper: false, symbols: false })));
});
t('exclusions and no repeats', () => {
  for (let i = 0; i < 200; i++) { const p = P.generate({ length: 30, excludeAmbiguous: true, exclude: 'xyz' }); assert.ok(!/[Il1O0oxyz|`'"]/.test(p), p); }
  const p = P.generate({ length: 26, upper: false, digits: false, symbols: false, noRepeats: true });
  assert.strictEqual(new Set(p).size, 26);
  assert.throws(() => P.generate({ length: 27, upper: false, digits: false, symbols: false, noRepeats: true }), /cannot avoid repeats/);
  assert.throws(() => P.generate({ lower: false, upper: false, digits: false, symbols: false }), /at least one/);
  assert.throws(() => P.generate({ length: 3 }), /too short/);
});
t('uniform distribution (chi-square on 10 digits)', () => {
  const counts = new Array(10).fill(0), N = 50000;
  for (let i = 0; i < N; i++) counts[P.randomInt(10)]++;
  const exp = N / 10, chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  assert.ok(chi < 30, 'chi-square ' + chi.toFixed(1)); // df=9, p<0.0005 threshold ~ 29.7
});
t('entropy math', () => {
  assert.strictEqual(Math.round(P.entropy({ length: 16 })), Math.round(16 * Math.log2(26 + 26 + 10 + 28)));
  assert.strictEqual(Math.round(P.passphraseEntropy(7776, { words: 6 })), 78);
});
t('passphrase', () => {
  const list = ['alpha', 'bravo', 'charlie', 'delta'];
  const p = P.passphrase(list, { words: 5, separator: ' ', capitalize: true, number: true });
  assert.strictEqual(p.split(' ').length, 5); assert.ok(/\d/.test(p)); assert.ok(/^[A-Z]/.test(p));
  assert.throws(() => P.passphrase([], {}), /not loaded/);
});
t('strength: common, leet, keyboard, dates are weak', () => {
  ['password', 'P@ssw0rd', 'qwerty123', '123456789', 'aaaaaaaa', 'iloveyou2024', 'asdfghjkl'].forEach(pw => assert.ok(P.strength(pw).score <= 1, pw + ' ' + JSON.stringify(P.strength(pw))));
  assert.ok(P.strength('P@ssw0rd').findings.some(f => /common password/.test(f)));
  assert.ok(P.strength('zxcvbn99').findings.some(f => /keyboard/.test(f)));
});
t('strength: random and long passphrases are strong', () => {
  assert.ok(P.strength('xK9#mQ2$vL7!pR4@').score >= 3);
  assert.ok(P.strength('correct-horse-battery-staple-orbit-lantern').score >= 3);
  assert.strictEqual(P.strength('').score, 0);
});
t('human time', () => { assert.strictEqual(P.humanTime(0.2), 'instantly'); assert.strictEqual(P.humanTime(7200), '2 hours'); assert.strictEqual(P.humanTime(86400 * 3), '3 days'); assert.strictEqual(P.humanTime(1e30), 'effectively never'); });
console.log(`password engine: ${pass} unit tests passed` + (fail ? `, ${fail} FAILED` : ''));
process.exit(fail ? 1 : 0);
