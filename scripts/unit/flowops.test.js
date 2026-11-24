// Node unit tests for js/engines/flowops.js and the Flow runner's fork/pause.
// Reference values are the published test vectors for each algorithm.
// Run: node scripts/unit/flowops.test.js
global.window = global; require('../../js/md5.js');
const assert = require('assert'), fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(__dirname + '/../../js/vendor/smol-toml.min.js', 'utf8'));
const F = require('../../js/engines/flowops.js');
F.libs.ensure = n => Promise.resolve({ hashwasm: require('../../js/vendor/hash-wasm.min.js'), TOML: global.TOML, jmespath: require('../../js/vendor/jmespath.min.js'), LBJsonX: require('../../js/engines/jsonx.js') }[n]);
let n = 0, failed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const run1 = (op, args, input) => F.run([{ op, args }], input).then(r => { if (r[0].error) throw new Error(op + ': ' + r[0].error); return r[0].output; });
const vec = async list => { for (const [op, args, input, want] of list) assert.strictEqual(await run1(op, args, input), want, op + ' ' + JSON.stringify(input).slice(0, 40)); };

t('registry: over 200 operations, unique ids, every one has a group and description', () => {
  assert.ok(F.OPS.length >= 200, F.OPS.length);
  assert.strictEqual(new Set(F.OPS.map(o => o.id)).size, F.OPS.length);
  F.OPS.forEach(o => assert.ok(o.group && o.desc && typeof o.run === 'function', o.id));
});
t('encodings: Base58, Base85, Base45, basE91, punycode, Morse, Quoted-Printable round trips', () => vec([
  ['base58-encode', {}, 'hello world', 'StV1DL6CwTryKyV'], ['base58-decode', {}, 'StV1DL6CwTryKyV', 'hello world'],
  ['base85-encode', {}, 'Man ', '9jqo^'], ['base85-decode', {}, '<~9jqo^~>', 'Man '],
  ['base45-encode', {}, 'AB', 'BB8'], ['base45-encode', {}, 'ietf!', 'QED8WEX0'], ['base45-decode', {}, 'QED8WEX0', 'ietf!'],
  ['base91-encode', {}, 'test', 'fPNKd'], ['base91-decode', {}, 'fPNKd', 'test'],
  ['punycode', {}, 'münchen.de', 'xn--mnchen-3ya.de'], ['punycode', { mode: 'Unicode' }, 'xn--mnchen-3ya.de', 'münchen.de'],
  ['morse-encode', {}, 'SOS help', '... --- ... / .... . .-.. .--.'], ['morse-decode', {}, '... --- ...', 'SOS'],
  ['qp-encode', {}, 'café = ok', 'caf=C3=A9 =3D ok'], ['qp-decode', {}, 'caf=C3=A9 =3D=\nok', 'café =ok'],
  ['a1z26-encode', {}, 'Hi there', '8-9 20-8-5-18-5'], ['a1z26-decode', {}, '8-9 20-8-5-18-5', 'hi there']
]));
t('ciphers: Vigenère, affine, rail fence, ROT47, Atbash, RC4, XOR', () => vec([
  ['vigenere-encode', { key: 'LEMON' }, 'ATTACKATDAWN', 'LXFOPVEFRNHR'], ['vigenere-decode', { key: 'LEMON' }, 'LXFOPVEFRNHR', 'ATTACKATDAWN'],
  ['affine-encode', { a: 5, b: 8 }, 'AFFINE CIPHER', 'IHHWVC SWFRCP'], ['affine-decode', { a: 5, b: 8 }, 'IHHWVC SWFRCP', 'AFFINE CIPHER'],
  ['railfence-encode', { rails: 3 }, 'WEAREDISCOVEREDFLEEATONCE', 'WECRLTEERDSOEEFEAOCAIVDEN'], ['railfence-decode', { rails: 3 }, 'WECRLTEERDSOEEFEAOCAIVDEN', 'WEAREDISCOVEREDFLEEATONCE'],
  ['rot47', {}, 'Hello', 'w6==@'], ['atbash', {}, 'Hello', 'Svool'],
  ['rc4', { key: 'Key', outFmt: 'hex' }, 'Plaintext', 'bbf316e8d940af0ad3'],
  ['xor', { key: '01', keyFmt: 'hex', outFmt: 'text' }, 'abc', '`cb']
]));
t('hashes and checksums against their reference vectors', () => vec([
  ['sha3', { bits: '256' }, 'abc', '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'],
  ['keccak', { bits: '256' }, '', 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['ripemd160', {}, 'abc', '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc'],
  ['crc32c', {}, '123456789', 'e3069283'], ['adler32', {}, 'Wikipedia', '11e60398'],
  ['crc16', {}, '123456789', '29b1'], ['crc16', { v: 'MODBUS' }, '123456789', '4b37'], ['crc16', { v: 'XMODEM' }, '123456789', '31c3'], ['crc8', {}, '123456789', 'f4'],
  ['fletcher', {}, 'abcde', 'c8f0'], ['murmur3', {}, 'hello', '613153351'], ['fnv', { bits: '32' }, 'hello', '4f9f2cab'], ['fnv', { bits: '64' }, 'hello', 'a430d84680aabd0b'],
  ['ntlm', {}, 'password', '8846f7eaee8fb117ad06bdd830b7586c'],
  ['luhn', {}, '4539 1488 0343 6467', '4539 1488 0343 6467\tvalid'], ['luhn', { mode: 'add check digit' }, '7992739871', '79927398713']
]));
t('crypto: JWT HS256 sign and verify, TOTP RFC 6238 vector, PBKDF2 RFC 6070', async () => {
  const tok = await run1('jwt-sign', { alg: 'HS256', secret: 'your-256-bit-secret' }, '{"sub":"1234567890","name":"John Doe","iat":1516239022}');
  assert.strictEqual(tok, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  assert.match(await run1('jwt-verify', { secret: 'your-256-bit-secret' }, tok), /^Signature valid/);
  assert.match(await run1('jwt-verify', { secret: 'wrong' }, tok), /INVALID/);
  // RFC 6238 SHA-1 secret "12345678901234567890" at T = 59 s -> 94287082 (8 digits)
  assert.match(await run1('totp', { digits: '8', at: '59' }, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), /^94287082\t/);
  assert.strictEqual(await run1('hotp', { counter: 1 }, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), '287082');
  assert.strictEqual(await run1('pbkdf2', { salt: 'salt', iter: 1, hash: 'SHA-1', len: 20 }, 'password'), '0c60c80f961f0e71f3a9b524af6012062fe037a6');
});
t('numbers, network and data', () => vec([
  ['roman', {}, '1994\nMCMXCIV\nIIII', 'MCMXCIV\n1994\nIIII\tnot a valid Roman numeral'],
  ['number-words', {}, '1001', 'one thousand one'], ['number-words', { style: 'Indian (lakh, crore)' }, '12345678', 'one crore twenty-three lakh forty-five thousand six hundred and seventy-eight'],
  ['twos-complement', { bits: '8' }, '-1', '0xff'], ['twos-complement', { bits: '16', mode: 'hex or binary → signed decimal' }, '0xfffe', '-2'],
  ['ieee754', {}, '0.1', '0x3fb999999999999a'], ['ieee754', {}, '3fb999999999999a', '0.1'],
  ['convert-units', { from: 'C', to: 'F' }, '100', '212'], ['convert-units', { from: 'km', to: 'mi' }, '42.195', '26.21875746'],
  ['ipv6', {}, '2001:0db8:0000:0000:0000:ff00:0042:8329', '2001:db8::ff00:42:8329'], ['ipv6', { mode: 'expand' }, '::1', '0000:0000:0000:0000:0000:0000:0000:0001'],
  ['ip-sort', {}, '10.0.0.10\n10.0.0.9\n10.0.0.9', '10.0.0.9\n10.0.0.10'],
  ['mac-format', { style: 'aabb.ccdd.eeff' }, 'AA-BB-CC-DD-EE-FF', 'aabb.ccdd.eeff'],
  ['date-format', { from: 'DD/MM/YYYY hh:mm A', to: 'YYYY-MM-DD HH:mm' }, '05/03/2026 09:15 PM', '2026-03-05 21:15'],
  ['timestamp-convert', {}, '133000000000000000', '2022-06-18T04:26:40.000Z'],
  ['csv-columns', { cols: 'b,a' }, 'a,b,c\n1,"x, y",3', 'b,a\n"x, y",1'],
  ['csv-filter', { col: 'n', test: '>', value: '5' }, 'n,name\n3,a\n9,b', 'n,name\n9,b'],
  ['jsonl-to-json', {}, '{"a":1}\n{"a":12345678901234567890}', '[\n  {\n    "a": 1\n  },\n  {\n    "a": 12345678901234567890\n  }\n]'],
  ['toml-to-json', {}, 'a = 1\n[b]\nc = "d"', '{\n  "a": 1,\n  "b": {\n    "c": "d"\n  }\n}'],
  ['css-minify', {}, 'a { color : red ; }  /* x */ b{margin:0 }', 'a{color:red}b{margin:0}'],
  ['strip-comments', {}, 'var a = "http://x"; // c\n/* b */ b();', 'var a = "http://x";\n b();'],
  ['file-type', {}, '89504e470d0a1a0a0000', 'PNG image\nMIME type: image/png']
]));
t('runner: Fork and Merge run the inner steps per part; nested forks; errors name the part', async () => {
  const r = await F.run([{ op: 'fork', args: { split: '\\n', join: ',' } }, { op: 'case', args: { to: 'UPPER' } }, { op: 'merge' }, { op: 'reverse', args: { mode: 'characters' } }], 'ab\ncd\n');
  assert.strictEqual(r[3].output, 'DC,BA');
  const e = await F.run([{ op: 'fork', args: { split: ' ', join: ' ' } }, { op: 'base64-decode' }], 'aGk= !!');
  assert.match(e[1].error, /^part 2:/);
});
t('runner: pauseAfter stops after that step and marks the rest paused', async () => {
  const r = await F.run([{ op: 'case', args: { to: 'UPPER' } }, { op: 'reverse' }, { op: 'base64-encode' }], 'Hi', null, { pauseAfter: 0 });
  assert.deepStrictEqual([r[0].output, r[1].paused, r[2].paused], ['HI', true, true]);
});
t('lineSafe: per-line steps qualify, whole-text steps do not', () => {
  assert.ok(F.lineSafe({ op: 'filter-lines', args: {} }) && F.lineSafe({ op: 'case', args: { to: 'UPPER' } }));
  assert.ok(!F.lineSafe({ op: 'case', args: { to: 'Sentence case' } }) && !F.lineSafe({ op: 'number-lines', args: {} }) && !F.lineSafe({ op: 'sort-lines', args: {} }));
});

(async () => { for (const [name, fn] of tests) { try { await fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } } console.log(`${n} passed, ${failed} failed`); })();
