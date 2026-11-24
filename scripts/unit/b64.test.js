// Unit tests for js/engines/b64.js. Run: node scripts/unit/b64.test.js
const B = require('../../js/engines/b64.js');
const assert = require('assert');
let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
const bytes = s => new Uint8Array(Buffer.from(s, 'binary'));

t('encode matches Buffer for every length, standard and URL-safe', () => {
  for (let n = 0; n < 300; n++) {
    const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
    assert.strictEqual(B.encode(b), Buffer.from(b).toString('base64'), 'len ' + n);
    assert.strictEqual(B.encode(b, { urlSafe: true }), Buffer.from(b).toString('base64url'), 'url len ' + n);
    assert.deepStrictEqual(Array.from(B.decode(B.encode(b))), Array.from(b));
  }
});
t('MIME (76) and PEM (64) wrapping', () => {
  const b = new Uint8Array(200).map((_, i) => i);
  const m = B.encode(b, { wrap: 76 }), lines = m.split('\r\n');
  assert.ok(lines.slice(0, -1).every(l => l.length === 76)); assert.ok(lines[lines.length - 1].length <= 76);
  assert.strictEqual(lines.join(''), Buffer.from(b).toString('base64'));
  assert.ok(B.encode(b, { wrap: 64, newline: '\n' }).split('\n').slice(0, -1).every(l => l.length === 64));
  assert.strictEqual(B.encode(new Uint8Array(57), { wrap: 76 }).indexOf('\r\n'), -1, 'exactly one line: no break');
});
t('decode is tolerant of whitespace, URL-safe letters and missing padding, and says where it fails', () => {
  assert.strictEqual(Buffer.from(B.decode('SGVs\r\nbG8s IExh\teWVy')).toString(), 'Hello, Layer');
  assert.strictEqual(Buffer.from(B.decode('aGk_Pg')).toString('binary'), 'hi?>');
  assert.throws(() => B.decode('SGVsbG8*IExh'), e => e.position === 7 && /"\*" at position 8/.test(e.message));
  assert.throws(() => B.decode('SGVsbA==SGVs'), /after the = padding/);
  assert.throws(() => B.decode('SGVsb'), /one character too long/);
  assert.strictEqual(B.decode('').length, 0);
});
t('magic bytes', () => {
  const kind = hex => (B.magic(Uint8Array.from(Buffer.from(hex, 'hex'))) || {}).ext;
  assert.strictEqual(kind('89504e470d0a1a0a0000000d49484452'), 'png');
  assert.strictEqual(kind('ffd8ffe000104a464946'), 'jpg');
  assert.strictEqual(kind('474946383961'), 'gif');
  assert.strictEqual(kind('255044462d312e37'), 'pdf');
  assert.strictEqual(kind('52494646000000005745425056503820'), 'webp');
  assert.strictEqual(kind('000000206674797069736f6d00000200'), 'mp4');
  assert.strictEqual(kind('0000001c6674797061766966'), 'avif');
  assert.strictEqual(kind('1f8b0800'), 'gz');
  assert.strictEqual(kind('0061736d01000000'), 'wasm');
  assert.strictEqual(kind('4d5a90000300'), 'exe');
  assert.strictEqual(kind('7f454c46'), 'elf');
  assert.strictEqual(kind('774f4632'), 'woff2');
  assert.strictEqual(kind('53514c69746520666f726d6174203300'), 'sqlite');
  const zipWith = name => { const h = Buffer.alloc(30); h.write('PK\x03\x04', 0, 'binary'); h.writeUInt16LE(name.length, 26); return Uint8Array.from(Buffer.concat([h, Buffer.from(name)])); };
  assert.strictEqual(B.magic(zipWith('word/document.xml')).ext, 'docx');
  assert.strictEqual(B.magic(zipWith('xl/workbook.xml')).ext, 'xlsx');
  assert.strictEqual(B.magic(zipWith('readme.txt')).ext, 'zip');
  assert.strictEqual(B.magic(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')).ext, 'svg');
  assert.strictEqual(B.magic(bytes('-----BEGIN CERTIFICATE-----\nMIIB')).name, 'PEM text (certificate)');
  assert.strictEqual(B.magic(bytes('{"a": 1}')).ext, 'json');
  assert.strictEqual(B.magic(bytes('hello')), null);
  assert.strictEqual(B.magic(new Uint8Array(0)), null);
});
t('hexdump', () => {
  const d = B.hexdump(bytes('\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'));
  assert.strictEqual(d, '00000000  89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52  |.PNG........IHDR|');
  assert.strictEqual(B.hexdump(new Uint8Array(40), { max: 20 }).split('\n').length, 2);
});
t('text encodings', () => {
  assert.deepStrictEqual(Array.from(B.textToBytes('hé', 'utf-8')), [0x68, 0xc3, 0xa9]);
  assert.deepStrictEqual(Array.from(B.textToBytes('hé', 'utf-8-bom')), [0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xa9]);
  assert.deepStrictEqual(Array.from(B.textToBytes('hé', 'utf-16le')), [0x68, 0, 0xe9, 0]);
  assert.deepStrictEqual(Array.from(B.textToBytes('hé', 'utf-16be')), [0, 0x68, 0, 0xe9]);
  assert.deepStrictEqual(Array.from(B.textToBytes('€é', 'windows-1252')), [0x80, 0xe9]);
  assert.throws(() => B.textToBytes('日', 'windows-1252'), e => /cannot be written in windows-1252/.test(e.message) && e.bytes[0] === 0x3f);
  assert.strictEqual(B.bytesToText(Uint8Array.from([0x80, 0xe9]), 'windows-1252'), '€é');
  assert.strictEqual(B.bytesToText(Uint8Array.from([0x68, 0, 0xe9, 0]), 'utf-16le'), 'hé');
  assert.throws(() => B.bytesToText(Uint8Array.from([0xff, 0xfe, 0xfd]), 'utf-8'));
});
t('streaming a 9 MB blob: encode then decode is byte-exact, wrapped and plain', async () => {
  const n = 9 * 1024 * 1024 + 7, data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (i * 2654435761) >>> 24;
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const wrap of [0, 76]) {
    let calls = 0;
    const enc = await B.encodeBlob(new Blob([data]), { wrap }, () => calls++);
    assert.ok(calls >= 2, 'progress reported');
    const text = await enc.text();
    assert.strictEqual(text.replace(/\r\n/g, ''), Buffer.from(data).toString('base64'), 'wrap ' + wrap);
    if (wrap) assert.ok(text.split('\r\n').slice(0, -1).every(l => l.length === 76));
    const dec = await B.decodeBlob(enc);
    assert.strictEqual(dec.detected.ext, 'png');
    assert.ok(Buffer.from(await dec.arrayBuffer()).equals(Buffer.from(data)), 'round trip wrap ' + wrap);
  }
  const url = await (await B.encodeBlob(new Blob([data.subarray(0, 100)]), { urlSafe: true })).text();
  assert.strictEqual(url, Buffer.from(data.subarray(0, 100)).toString('base64url'));
  await assert.rejects(B.decodeBlob(new Blob(['SGVs', 'bG8*'])), /position 8/);
  const du = await B.decodeBlob(new Blob(['data:image/png;base64,iVBORw0KGgo=']));
  assert.strictEqual(du.detected.ext, 'png');
});

(async () => {
  for (const [name, fn] of queue) { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
  console.log(`b64: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
