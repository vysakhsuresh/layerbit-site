// Node unit tests for js/engines/lossless-json.js. Run: node scripts/unit/lossless.test.js
const assert = require('assert');
let L;
let n = 0, failed = 0;
function t(name, fn) { try { if (!L) L = require('../../js/engines/lossless-json.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }

t('A3: numbers round-trip exactly as written', () => {
  const src = '{"id":12345678901234567890,"big":1e400,"neg":-0,"f":1.10,"e":2.5E-3,"small":-12}';
  assert.strictEqual(L.stringify(L.parse(src)), src);
  assert.strictEqual(L.stringify(L.parse('[9007199254740993]'), '  '), '[\n  9007199254740993\n]');
});
t('A3: parse accepts what JSON.parse accepts and rejects what it rejects', () => {
  ['{}', '[]', '"x"', 'true', 'null', ' {"a" : [1, {"b": "c\\n"}]} ', '"\\u00e9"'].forEach(s => assert.deepStrictEqual(L.toNative(L.parse(s)), JSON.parse(s), s));
  ['{a:1}', '[1,]', '01', '1.', '.5', '+1', '[1] x', '"\u0001"', '', '{"a":1,}'].forEach(s => assert.throws(() => L.parse(s), SyntaxError, s));
});
t('A3: a "__proto__" key is an ordinary key, not the prototype', () => {
  const v = L.parse('{"__proto__": {"polluted": true}, "a": 1}');
  assert.deepStrictEqual(Object.keys(v), ['__proto__', 'a']);
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(L.stringify(v), '{"__proto__":{"polluted":true},"a":1}');
});
t('A3: sortKeys sorts deeply and keeps numbers exact', () => {
  assert.strictEqual(L.stringify(L.sortKeys(L.parse('{"b":12345678901234567891,"a":{"d":1,"c":-0}}'))), '{"a":{"c":-0,"d":1},"b":12345678901234567891}');
});
t('A3: toNative gives JavaScript values for analysis; isUnsafe says which numbers it would change', () => {
  assert.deepStrictEqual(L.toNative(L.parse('{"a":[1,2.5],"b":"x"}')), { a: [1, 2.5], b: 'x' });
  assert.strictEqual(L.isUnsafe('12345678901234567890'), true);
  assert.strictEqual(L.isUnsafe('1e400'), true);
  assert.strictEqual(L.isUnsafe('-0'), true);
  assert.strictEqual(L.isUnsafe('1.10'), false);   // same value, only the spelling differs
  assert.strictEqual(L.isUnsafe('9007199254740991'), false);
  assert.strictEqual(L.isUnsafe('0.1'), false);
  assert.deepStrictEqual(L.unsafeNumbers(L.parse('{"a":12345678901234567890,"b":[1,1e400]}')), ['12345678901234567890', '1e400']);
});
t('A3: canonicalNumber compares values, not spellings', () => {
  assert.strictEqual(L.canonicalNumber('1.0'), L.canonicalNumber('1'));
  assert.strictEqual(L.canonicalNumber('1e2'), L.canonicalNumber('100'));
  assert.notStrictEqual(L.canonicalNumber('12345678901234567890'), L.canonicalNumber('12345678901234567891'));
});
t('A3: inferValue never changes a value when typing CSV cells', () => {
  const v = s => L.inferValue(s);
  assert.strictEqual(v('42'), 42);
  assert.strictEqual(v('-3.5'), -3.5);
  assert.strictEqual(v('0'), 0);
  assert.strictEqual(v('0.25'), 0.25);
  assert.strictEqual(v('true'), true);
  assert.strictEqual(v('FALSE'), false);
  assert.strictEqual(v('null'), null);
  // kept as text: leading zeros, a plus sign, more than 15 significant digits,
  // spellings that would not survive (1.10, 1e3, .5), and anything else
  ['00123', '0012.5', '+971', '12345678901234567890', '1234567890123456', '1.10', '1e3', '.5', '5.', ' 7', '0x1F', 'NaN', 'Infinity', '1,000', ''].forEach(s => assert.strictEqual(v(s), s, JSON.stringify(s)));
});

process.on('beforeExit', () => { if (!failed) console.log(`lossless json: ${n} unit tests passed`); });
t('A3: stringify honours toJSON (dates) like JSON.stringify', () => {
  assert.strictEqual(L.stringify({ d: new Date(Date.UTC(2026, 0, 1)) }), '{"d":"2026-01-01T00:00:00.000Z"}');
});
