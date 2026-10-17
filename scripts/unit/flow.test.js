// Node unit tests for js/engines/flow.js. Run: node scripts/unit/flow.test.js
global.window = global; require('../../js/md5.js');
const F = require('../../js/engines/flow.js');
const J = require('../../js/engines/json.js');
F.libs.ensure = name => Promise.resolve({ md5: global.md5, LBJson: J, jsyaml: require('../../js/vendor/js-yaml.min.js'), sqlFormatter: require('../../js/vendor/sql-formatter.min.js') }[name]);
const assert = require('assert');
let n = 0; const fails = [];
async function t(name, fn) { try { await fn(); n++; } catch (e) { fails.push(name); console.error('FAIL', name, '\n  ', (e.stack || e.message).split('\n').slice(0, 3).join('\n')); } }
const one = async (op, input, args) => { const r = await F.run([{ op, args }], input); if (r[0].error) throw new Error(op + ': ' + r[0].error); return r[0].output; };
(async () => {
  await t('every op has unique id, group, desc and runs on a sample without throwing', async () => {
    const ids = new Set(); for (const o of F.OPS) { assert.ok(!ids.has(o.id), o.id); ids.add(o.id); assert.ok(o.group && o.desc && o.name); }
    assert.ok(F.OPS.length >= 60, F.OPS.length);
    for (const o of F.OPS) { const r = await F.run([{ op: o.id, args: {} }], 'Hello, World 42'); assert.ok(r.length === 1 && (typeof r[0].output === 'string' || r[0].error), o.id); }
  });
  await t('encoding round trips', async () => {
    const s = 'héllo wörld — 日本 🌍 <a href="x">&</a>';
    assert.strictEqual(await one('base64-decode', await one('base64-encode', s, { url: true })), s);
    assert.strictEqual(await one('base64-encode', 'hi?>', { url: false }), 'aGk/Pg=='); assert.strictEqual(await one('base64-encode', 'hi?>', { url: true }), 'aGk_Pg');
    assert.strictEqual(await one('hex-decode', await one('hex-encode', s, { sep: 'colon' })), s);
    assert.strictEqual(await one('base32-decode', await one('base32-encode', s)), s);
    assert.strictEqual(await one('url-decode', await one('url-encode', s, { mode: 'component' }), { plus: true }), s);
    assert.strictEqual(await one('url-encode', 'a b', { mode: 'form (+ for space)' }), 'a+b');
    assert.strictEqual(await one('html-unescape', await one('html-escape', s)), s);
    assert.strictEqual(await one('html-unescape', '&lt;p&gt;caf&eacute; &#x1F30D; &#169;'), '<p>caf&eacute; 🌍 ©');
    assert.strictEqual(await one('unicode-unescape', await one('unicode-escape', s)), s);
    assert.strictEqual(await one('json-string-unescape', await one('json-string-escape', s)), s);
    assert.strictEqual(await one('binary-decode', await one('binary-encode', 'AB')), 'AB');
    assert.strictEqual(await one('from-charcode', await one('charcode', 'a🌍', { base: 'hex (U+)' })), 'a🌍');
    assert.strictEqual(await one('rot13', await one('rot13', 'Hello', { n: 13 }), { n: 13 }), 'Hello');
    assert.strictEqual(await one('gunzip', await one('gzip', s, { format: 'gzip' }), { format: 'auto' }), s);
    assert.strictEqual(await one('gunzip', await one('gzip', s, { format: 'deflate-raw' }), { format: 'deflate-raw' }), s);
    const jwt = JSON.parse(await one('jwt-decode', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')); assert.strictEqual(jwt.payload.name, 'John Doe');
    await assert.rejects(one('base64-decode', '!!!'), /base64/); await assert.rejects(one('hex-decode', 'abc'), /hex/);
  });
  await t('hashing', async () => {
    assert.strictEqual(await one('md5', 'abc', { format: 'hex' }), '900150983cd24fb0d6963f7d28e17f72');
    assert.strictEqual(await one('sha256', 'abc', { format: 'hex' }), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.strictEqual(await one('sha256', 'abc', { format: 'base64url' }), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    assert.strictEqual(await one('hmac', 'The quick brown fox jumps over the lazy dog', { hash: 'SHA-256', key: 'key', format: 'hex' }), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    assert.strictEqual(await one('crc32', 'The quick brown fox jumps over the lazy dog'), '414fa339');
    assert.ok((await one('hash-lines', 'a\nb', { hash: 'SHA-256' })).startsWith('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb\ta'));
  });
  await t('text ops', async () => {
    assert.strictEqual(await one('case', 'hello big world', { to: 'camelCase' }), 'helloBigWorld'); assert.strictEqual(await one('case', 'helloBigWorld', { to: 'snake_case' }), 'hello_big_world');
    assert.strictEqual(await one('trim', '  a  \n b ', { mode: 'each line' }), 'a\nb');
    assert.strictEqual(await one('find-replace', 'a1b22', { find: '(\\d+)', replace: '[$1]', regex: true, flags: 'g' }), 'a[1]b[22]');
    assert.strictEqual(await one('extract', 'x a@b.co y c@d.org', { pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', group: 0, unique: true }), 'a@b.co\nc@d.org');
    assert.strictEqual(await one('filter-lines', 'INFO ok\nERROR bad\nerror worse', { pattern: 'error', mode: 'keep matching', regex: false, icase: true }), 'ERROR bad\nerror worse');
    assert.strictEqual(await one('sort-lines', 'b10\na2\nb2', { mode: 'natural', icase: true }), 'a2\nb2\nb10');
    assert.strictEqual(await one('unique-lines', 'a\nb\na', { counts: true, icase: false }), '     2  a\n     1  b');
    assert.strictEqual(await one('number-lines', 'x\ny', { start: 1, sep: '. ' }), '1. x\n2. y');
    assert.strictEqual(await one('cut-column', 'a,b,c\n1,2,3', { delim: 'auto', col: -1 }), 'c\n3');
    assert.strictEqual(await one('slugify', 'Café Déjà Vu!'), 'cafe-deja-vu');
    assert.strictEqual(await one('strip-html', '<p>Hi <b>there</b> &amp; bye</p><script>x()</script>'), 'Hi there & bye');
    assert.strictEqual(await one('prefix-suffix', 'a\nb', { prefix: "'", suffix: "'," }), "'a',\n'b',");
    assert.ok((await one('count', 'one two two three three three')).includes('words: 6'));
    assert.strictEqual(await one('wrap', 'aaa bbb ccc', { mode: 'wrap at width', n: 7 }), 'aaa bbb\nccc');
  });
  await t('data ops', async () => {
    assert.strictEqual(await one('json-format', '{"b":1,"a":[2]}', { indent: 'minify', sort: true }), '{"a":[2],"b":1}');
    assert.strictEqual(await one('json-query', '{"a":[{"id":1},{"id":2}]}', { path: '$.a[*].id' }), '[\n  1,\n  2\n]');
    assert.strictEqual(await one('json-to-yaml', '{"a":1,"b":["x","yes"],"c":{"d":null}}'), 'a: 1\nb:\n  - x\n  - "yes"\nc:\n  d: null');
    assert.strictEqual(await one('yaml-to-json', 'a: 1\nb: [x, y]', { indent: 'minify' }), '{"a":1,"b":["x","y"]}');
    assert.strictEqual(await one('csv-to-json', 'id,ok\n1,true\n2,"a,b"', { delim: 'auto', types: true }), '[\n  {\n    "id": 1,\n    "ok": true\n  },\n  {\n    "id": 2,\n    "ok": "a,b"\n  }\n]');
    assert.strictEqual(await one('json-to-csv', '[{"a":1,"b":{"c":"x,y"}},{"a":2}]', { delim: ',' }), 'a,b.c\n1,"x,y"\n2,');
    assert.strictEqual(await one('json-flatten', '{"a":{"b":1}}', { mode: 'flatten' }), '{\n  "a.b": 1\n}');
    assert.ok((await one('sql-format', 'select a from b where c=1', { dialect: 'postgresql' })).includes('\n'));
    assert.strictEqual(await one('xml-format', '<a><b x="1">t</b><c/></a>', { mode: 'indent' }), '<a>\n  <b x="1">t</b>\n  <c/>\n</a>');
    assert.ok((await one('markdown-table', 'a,b\n1,2')).startsWith('| a   | b   |\n| --- | --- |'));
  });
  await t('time, numbers, network, crypto', async () => {
    assert.strictEqual(await one('unix-to-date', '1700000000', { zone: 'UTC' }), '2023-11-14T22:13:20.000Z');
    assert.ok((await one('unix-to-date', '1700000000000', { zone: 'UTC' })).includes('milliseconds'));
    assert.strictEqual(await one('date-to-unix', '2023-11-14T22:13:20Z', { unit: 'seconds' }), '1700000000');
    assert.strictEqual(await one('number-base', '255\n0xff', { from: 'auto', to: 'binary' }), '0b11111111\n0b11111111');
    assert.strictEqual(await one('bytes-human', '1536', { unit: 'binary (KiB)' }), '1.50 KiB');
    assert.ok((await one('sum', 'a 1, b 2.5')).includes('sum: 3.5'));
    const u = JSON.parse(await one('url-parse', 'https://u@h.example.com:8443/p/q?a=1&a=2&b=x%20y#frag')); assert.deepStrictEqual(u.query, { a: ['1', '2'], b: 'x y' }); assert.strictEqual(u.port, '8443');
    assert.strictEqual(await one('query-string', 'a=1&b=x+y', { mode: 'to JSON' }), '{\n  "a": "1",\n  "b": "x y"\n}');
    assert.strictEqual(await one('defang', 'http://evil.example.com/x', { mode: 'defang' }), 'hxxp://evil[.]example[.]com/x');
    assert.strictEqual(await one('defang', 'hxxps://a[.]b[.]co', { mode: 'refang' }), 'https://a.b.co');
    assert.strictEqual(await one('ip-convert', '10.0.0.1', { to: 'integer' }), '167772161'); assert.strictEqual(await one('ip-convert', '167772161', { to: 'dotted' }), '10.0.0.1');
    assert.strictEqual(await one('extract-urls', 'see https://a.co/x and https://a.co/x or b@c.io', { what: 'URLs', unique: true }), 'https://a.co/x');
    const ct = await one('aes-encrypt', 'secret note', { password: 'pw' }); assert.strictEqual(await one('aes-decrypt', ct, { password: 'pw' }), 'secret note'); await assert.rejects(one('aes-decrypt', ct, { password: 'x' }), /wrong password/);
    assert.ok(/^[0-9a-f-]{36}$/.test(await one('random', '', { kind: 'UUID v4', n: 1 })));
  });
  await t('runner chains, stops at first error, reports timing', async () => {
    const r = await F.run([{ op: 'base64-encode', args: {} }, { op: 'base64-decode', args: {} }, { op: 'hex-decode', args: {} }, { op: 'trim', args: {} }], 'xyz');
    assert.strictEqual(r[1].output, 'xyz'); assert.ok(r[2].error); assert.strictEqual(r[3].skipped, true); assert.ok(typeof r[0].ms === 'number');
    assert.ok((await F.run([{ op: 'nope' }], 'x'))[0].error);
  });
  await t('detect suggests the right operation', async () => {
    const top = s => F.detect(s)[0].op;
    assert.strictEqual(top('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig'), 'jwt-decode');
    assert.strictEqual(top('H4sIAAAAAAAAA6tWSkksSVSyUkpKLEpVqgUAZ0pX8g8AAAA='), 'gunzip');
    assert.strictEqual(top('SGVsbG8gd29ybGQh'), 'base64-decode');
    assert.strictEqual(top('48656c6c6f20776f726c64'), 'hex-decode');
    assert.strictEqual(top('a%20b%3Dc'), 'url-decode');
    assert.strictEqual(top('{"a": 1}'), 'json-format');
    assert.strictEqual(top('https://example.com/?x=1'), 'url-parse');
    assert.strictEqual(top('hxxp://bad[.]example'), 'defang');
    assert.strictEqual(top('1700000000'), 'unix-to-date');
    assert.strictEqual(top('id,name\n1,a\n2,b'), 'csv-to-json');
    assert.strictEqual(top('&lt;b&gt; hi'), 'html-unescape');
    assert.deepStrictEqual(F.detect(''), []);
  });
  await t('presets run end to end on their samples', async () => {
    for (const p of F.PRESETS) { const r = await F.run(p.steps, p.sample); const last = r[r.length - 1]; assert.ok(!last.error && !last.skipped, p.id + ': ' + JSON.stringify(r.find(x => x.error))); }
    const jwt = await F.run(F.PRESETS[0].steps, F.PRESETS[0].sample); assert.ok(jwt[3].output.includes('"name": "John Doe"'));
    const gz = await F.run(F.PRESETS[1].steps, F.PRESETS[1].sample); assert.ok(gz[1].output.includes('"event": "order.created"'), gz[1].output);
    const list = await F.run(F.PRESETS[2].steps, F.PRESETS[2].sample); assert.strictEqual(list[3].output, 'server-1\nserver-2\nserver-10');
  });
  await t('serialize / parse recipes', async () => {
    const steps = F.parse(F.serialize([{ op: 'trim', args: { mode: 'whole text' } }])); assert.strictEqual(steps[0].args.mode, 'whole text');
    assert.throws(() => F.parse('{"steps":[{"op":"zzz"}]}'), /Unknown operation/); assert.throws(() => F.parse('[]'), /Not a recipe/);
  });
  console.log(`flow engine: ${n} unit tests passed${fails.length ? ', ' + fails.length + ' FAILED' : ''}`);
  if (fails.length) process.exitCode = 1;
})();
