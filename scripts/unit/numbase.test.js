// Unit tests for js/engines/numbase.js. Run: node scripts/unit/numbase.test.js
const N = require('../../js/engines/numbase.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
t('parse bases, prefixes and separators', () => {
  assert.strictEqual(N.parse('255', 10), 255n);
  assert.strictEqual(N.parse('0xFF', 10), 255n);
  assert.strictEqual(N.parse('ff', 16), 255n);
  assert.strictEqual(N.parse('0b1111_1111', 'auto'), 255n);
  assert.strictEqual(N.parse('0o377', 'auto'), 255n);
  assert.strictEqual(N.parse('1,000,000', 10), 1000000n);
  assert.strictEqual(N.parse('-zz', 36), -1295n);
  assert.strictEqual(N.parse('FFh', 'auto'), 255n);
});
t('parse rejects invalid digits with position', () => { assert.throws(() => N.parse('102', 2), /"2" is not a valid base-2 digit \(position 3\)/); assert.throws(() => N.parse('', 10), /Enter a number/); });
t('big integers stay exact', () => { const v = N.parse('18446744073709551616', 10); assert.strictEqual(N.format(v, 16), '10000000000000000'); assert.strictEqual(N.format(2n ** 200n, 10).length, 61); });
t('format grouping and prefix', () => { assert.strictEqual(N.format(0xdeadbeefn, 16, { upper: true, group: 4, prefix: true }), '0xDEAD BEEF'); assert.strictEqual(N.format(5n, 2, { group: 4 }), '101'); });
t('two\'s complement', () => {
  const r = N.twos(-1n, 8); assert.strictEqual(r.unsigned, 255n); assert.strictEqual(r.bits, '11111111');
  assert.strictEqual(N.twos(200n, 8).signed, -56n);
  assert.ok(N.twos(300n, 8).overflow); assert.ok(!N.twos(-128n, 8).overflow); assert.ok(N.twos(-129n, 8).overflow);
});
t('fit width', () => { assert.strictEqual(N.fitWidth(255n), 8); assert.strictEqual(N.fitWidth(-129n), 16); assert.strictEqual(N.fitWidth(2n ** 63n), 64); });
t('byte order', () => { assert.deepStrictEqual(N.bytes(0x12345678n, 32, false), [0x12, 0x34, 0x56, 0x78]); assert.deepStrictEqual(N.bytes(0x12345678n, 32, true), [0x78, 0x56, 0x34, 0x12]); });
t('IEEE-754 decode', () => {
  assert.strictEqual(N.asFloat(0x3f800000n, 32).value, 1);
  assert.strictEqual(N.asFloat(0x40490fdbn, 32).value.toFixed(6), '3.141593');
  assert.strictEqual(N.asFloat(0x7fc00000n, 32).kind, 'NaN');
  assert.strictEqual(N.asFloat(0x7ff0000000000000n, 64).kind, 'infinity');
  assert.strictEqual(N.asFloat(1n, 64).kind, 'subnormal');
  assert.strictEqual(N.asFloat(0x3ff0000000000000n, 64).unbiased, 0);
});
t('IEEE-754 encode', () => { assert.strictEqual(N.floatBits(0.1, 64), 0x3fb999999999999an); assert.strictEqual(N.floatBits(-2, 32), 0xc0000000n); });
t('bitwise and arithmetic', () => {
  assert.strictEqual(N.op(0b1100n, 0b1010n, 'and'), 0b1000n);
  assert.strictEqual(N.op(0b1100n, 0b1010n, 'xor'), 0b0110n);
  assert.strictEqual(N.op(0x0fn, 0n, 'not', 8), 0xf0n);
  assert.strictEqual(N.op(1n, 8n, 'shl', 8), 0n);
  assert.strictEqual(N.op(2n, 100n, 'pow'), 2n ** 100n);
  assert.throws(() => N.op(1n, 0n, 'div'), /Division by zero/);
});
t('popcount and ascii', () => { assert.strictEqual(N.popcount(0xffn), 8); assert.strictEqual(N.ascii([72, 105, 0, 200]), 'Hi··'); });
console.log(`number engine: ${pass} unit tests passed` + (fail ? `, ${fail} FAILED` : ''));
process.exit(fail ? 1 : 0);
