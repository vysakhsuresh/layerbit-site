// Unit tests for js/engines/epochs.js. Run: node scripts/unit/epochs.test.js
const E = require('../../js/engines/epochs.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const ns = iso => BigInt(Date.parse(iso)) * 1000000n;
const iso = n => new Date(Number(n / 1000000n)).toISOString();

t('.NET ticks both ways, exact to 100 ns', () => {
  assert.strictEqual(E.fromNs('dotnet', 0n), '621355968000000000');
  assert.strictEqual(E.fromNs('dotnet', ns('2000-01-01T00:00:00Z')), '630822816000000000');
  assert.strictEqual(E.toNs('dotnet', '638680000000000001'), (638680000000000001n - 621355968000000000n) * 100n);
  assert.strictEqual(E.fromNs('dotnet', E.toNs('dotnet', '638680000000000001')), '638680000000000001');
  assert.throws(() => E.toNs('dotnet', '-1'), /from 0/);
});
t('FILETIME / LDAP, with hex and DWORD pairs and the "never" values', () => {
  assert.strictEqual(E.fromNs('filetime', ns('2009-02-13T23:31:30Z')), '128790414900000000');
  assert.strictEqual(iso(E.toNs('filetime', '128790414900000000')), '2009-02-13T23:31:30.000Z');
  assert.strictEqual(iso(E.toNs('filetime', '0x01C98E5A:0x6E81C800')), iso(E.toNs('filetime', String(0x01C98E5An * 4294967296n + 0x6E81C800n))));
  const a = E.all(ns('2009-02-13T23:31:30Z'));
  assert.strictEqual(a.filetimeHex, '0x' + (128790414900000000n).toString(16).toUpperCase().padStart(16, '0'));
  assert.ok(/^0x[0-9A-F]{8}:0x[0-9A-F]{8}$/.test(a.filetimeDwords));
  assert.throws(() => E.toNs('filetime', '0'), /never/);
  assert.throws(() => E.toNs('filetime', '9223372036854775807'), /never expires/);
});
t('Excel serial dates, 1900 and 1904 systems, with the 1900 leap-year bug', () => {
  assert.strictEqual(E.fromNs('excel', 0n), '25569');
  assert.strictEqual(E.fromNs('excel', ns('2000-01-01T00:00:00Z')), '36526');
  assert.strictEqual(E.fromNs('excel', ns('2026-11-24T18:00:00Z')), '46350.75');
  assert.strictEqual(iso(E.toNs('excel', '46350.75')), '2026-11-24T18:00:00.000Z');
  assert.strictEqual(iso(E.toNs('excel', '1')), '1900-01-01T00:00:00.000Z');
  assert.strictEqual(iso(E.toNs('excel', '59')), '1900-02-28T00:00:00.000Z');
  assert.strictEqual(iso(E.toNs('excel', '61')), '1900-03-01T00:00:00.000Z');
  assert.throws(() => E.toNs('excel', '60'), /29 February 1900/);
  assert.strictEqual(E.fromNs('excel', ns('1900-01-01T00:00:00Z')), '1');
  assert.strictEqual(E.fromNs('excel1904', ns('2000-01-01T00:00:00Z')), '35064');
  assert.strictEqual(iso(E.toNs('excel1904', '0')), '1904-01-01T00:00:00.000Z');
});
t('Cocoa, HFS+, WebKit', () => {
  assert.strictEqual(E.fromNs('cocoa', ns('2001-01-01T00:00:00Z')), '0');
  assert.strictEqual(E.fromNs('cocoa', 0n), '-978307200');
  assert.strictEqual(iso(E.toNs('cocoa', '786000000.5')), '2025-11-28T05:20:00.500Z');
  assert.strictEqual(E.fromNs('hfs', 0n), '2082844800');
  assert.strictEqual(E.fromNs('webkit', 0n), '11644473600000000');
  assert.strictEqual(iso(E.toNs('webkit', '13380000000000000')), '2025-01-01T03:20:00.000Z'.replace(/.*/, new Date(13380000000000 - 11644473600000).toISOString()));
});
t('GPS time: leap seconds, weeks and time of week', () => {
  assert.strictEqual(E.fromNs('gps', ns('1980-01-06T00:00:00Z')), '0');
  assert.strictEqual(E.fromNs('gps', ns('2017-01-01T00:00:00Z')), '1167264018');
  assert.strictEqual(E.leapSeconds(Date.parse('2016-12-31T23:59:59Z') / 1000), 17);
  assert.strictEqual(E.leapSeconds(Date.parse('2026-01-01T00:00:00Z') / 1000), 18);
  const a = E.all(ns('2017-01-01T00:00:00Z'));
  assert.strictEqual(a.gpsWeek, '1930'); assert.strictEqual(a.gpsTow, '18'); assert.strictEqual(a.leap, 18);
  assert.strictEqual(iso(E.toNs('gps', '1167264018')), '2017-01-01T00:00:00.000Z');
  assert.strictEqual(iso(E.toNs('gps', '1930:18')), '2017-01-01T00:00:00.000Z');
  assert.strictEqual(iso(E.toNs('gps', '1930w18')), '2017-01-01T00:00:00.000Z');
});
t('Unix units keep fractions exactly', () => {
  assert.strictEqual(E.toNs('unix', '1700000000.123456789'), 1700000000123456789n);
  assert.strictEqual(E.fromNs('unix', 1700000000123456789n), '1700000000.123456789');
  assert.strictEqual(E.fromNs('unix_ms', 1700000000123456789n), '1700000000123.456789');
  assert.strictEqual(E.fromNs('unix', -1500000000n), '-1.5');
  assert.throws(() => E.toNs('unix', '12abc'), /not a number/);
});
t('guess: an 18-digit number is FILETIME or .NET, not nanoseconds', () => {
  const now = Date.UTC(2026, 10, 24);
  assert.strictEqual(E.guess('133800000000000000', { now })[0], 'filetime');
  assert.strictEqual(E.guess('638680000000000000', { now })[0], 'dotnet');
  assert.ok(E.guess('638680000000000000', { now }).includes('unix_ns'), 'still listed, just less likely');
  assert.strictEqual(E.guess('1700000000', { now })[0], 'unix');
  assert.strictEqual(E.guess('1700000000000', { now })[0], 'unix_ms');
  assert.ok(E.guess('46350.75').includes('excel'));
  assert.deepStrictEqual(E.guess('abc'), []);
});

console.log(`epochs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
