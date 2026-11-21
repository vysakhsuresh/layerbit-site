// Unit tests for js/engines/tz.js. Run: node scripts/unit/tz.test.js
const Z = require('../../js/engines/tz.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const at = (y, mo, d, h, mi, zone) => Z.toInstant(y, mo, d, h, mi, zone);
const iso = ms => new Date(ms).toISOString().slice(0, 16);

t('Dubai to India is +1:30', () => {
  const r = at(2026, 11, 21, 15, 0, 'Asia/Dubai');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(iso(r.ms), '2026-11-21T11:00');
  const w = Z.wall(r.ms, 'Asia/Kolkata');
  assert.strictEqual(w.time, '16:30'); assert.strictEqual(w.abbr, 'IST'); assert.strictEqual(w.offsetLabel, 'UTC+5:30');
  assert.strictEqual(Z.diffLabel(w.offset - Z.offset(r.ms, 'Asia/Dubai')), '+1:30');
});
t('India to US Eastern differs by season (EST vs EDT)', () => {
  const winter = at(2026, 1, 15, 20, 0, 'Asia/Kolkata'), summer = at(2026, 7, 15, 20, 0, 'Asia/Kolkata');
  const w = Z.wall(winter.ms, 'America/New_York'), s = Z.wall(summer.ms, 'America/New_York');
  assert.strictEqual(w.time, '09:30'); assert.strictEqual(w.abbr, 'EST'); assert.strictEqual(w.dst, false);
  assert.strictEqual(s.time, '10:30'); assert.strictEqual(s.abbr, 'EDT'); assert.strictEqual(s.dst, true);
});
t('London shows GMT in winter and BST in summer', () => {
  assert.strictEqual(Z.wall(Date.UTC(2026, 0, 10, 12), 'Europe/London').abbr, 'GMT');
  assert.strictEqual(Z.wall(Date.UTC(2026, 6, 10, 12), 'Europe/London').abbr, 'BST');
  assert.strictEqual(Z.wall(Date.UTC(2026, 6, 10, 12), 'Asia/Dubai').abbr, 'GST');
});
t('spring-forward gap moves forward and is reported', () => {
  const r = at(2026, 3, 8, 2, 30, 'America/New_York');
  assert.strictEqual(r.status, 'gap');
  assert.strictEqual(Z.wall(r.ms, 'America/New_York').time, '03:30');
  assert.strictEqual(r.shift, 60);
});
t('fall-back overlap returns the first occurrence and the second', () => {
  const r = at(2026, 11, 1, 1, 30, 'America/New_York');
  assert.strictEqual(r.status, 'overlap');
  assert.strictEqual(iso(r.ms), '2026-11-01T05:30');
  assert.strictEqual(iso(r.later), '2026-11-01T06:30');
});
t('UK spring forward on the last Sunday of March', () => {
  assert.strictEqual(at(2026, 3, 29, 1, 30, 'Europe/London').status, 'gap');
  assert.strictEqual(at(2026, 3, 28, 1, 30, 'Europe/London').status, 'ok');
});
t('day changes are counted across the date line', () => {
  const r = at(2026, 11, 21, 22, 0, 'America/Los_Angeles');
  const w = Z.wall(r.ms, 'Asia/Tokyo');
  assert.strictEqual(w.date, '2026-11-22'); assert.strictEqual(Z.dayDiff('2026-11-21', w.date), 1);
  assert.strictEqual(Z.dayDiff('2026-03-01', '2026-02-28'), -1);
});
t('half- and quarter-hour offsets', () => {
  assert.strictEqual(Z.offsetLabel(Z.offset(Date.UTC(2026, 0, 1), 'Asia/Kathmandu')), 'UTC+5:45');
  assert.strictEqual(Z.offsetLabel(-300), 'UTC-5'); assert.strictEqual(Z.offsetLabel(0), 'UTC');
  assert.strictEqual(Z.diffLabel(-570), '-9:30');
});
t('resolve aliases, cities, IANA names and offsets', () => {
  const cases = { 'IST': 'Asia/Kolkata', 'india time': 'Asia/Kolkata', 'Indian Standard Time': 'Asia/Kolkata', 'Mumbai': 'Asia/Kolkata',
    'GST': 'Asia/Dubai', 'Abu Dhabi': 'Asia/Dubai', 'dubai time': 'Asia/Dubai', 'EST': 'America/New_York', 'Eastern Standard Time': 'America/New_York',
    'pst': 'America/Los_Angeles', 'Pacific Daylight Time': 'America/Los_Angeles', 'UK': 'Europe/London', 'British Summer Time': 'Europe/London',
    'gmt': 'Etc/GMT', 'utc': 'UTC', 'asia/tokyo': 'Asia/Tokyo', 'Saudi Arabia': 'Asia/Riyadh',
    'UTC+4': 'Etc/GMT-4', 'GMT-5': 'Etc/GMT+5', 'Dubai, UAE': 'Asia/Dubai', 'nowhere land': null };
  for (const [q, z] of Object.entries(cases)) assert.strictEqual(Z.resolve(q), z, q);
});
t('search ranks the exact match first', () => {
  const r = Z.search('lon', 5);
  assert.ok(r.length > 0 && r[0].zone === 'Europe/London', JSON.stringify(r));
  assert.strictEqual(Z.search('IST', 3)[0].zone, 'Asia/Kolkata');
  assert.deepStrictEqual(Z.search('', 3), []);
});
t('parseTime formats', () => {
  const c = { '3pm': [15, 0], '3:30 PM': [15, 30], '12am': [0, 0], '12 p.m.': [12, 0], '15:00': [15, 0], '0930': [9, 30], 'noon': [12, 0], 'midnight': [0, 0], '7h30': [7, 30] };
  for (const [s, [h, mi]] of Object.entries(c)) assert.deepStrictEqual(Z.parseTime(s), { h, mi }, s);
  ['13pm', '25:00', '9:75', 'abc', ''].forEach(s => assert.strictEqual(Z.parseTime(s), null, s));
});
t('parseQuery phrases', () => {
  assert.deepStrictEqual(Z.parseQuery('3pm IST to EST'), { time: { h: 15, mi: 0 }, from: 'Asia/Kolkata', to: 'America/New_York' });
  assert.deepStrictEqual(Z.parseQuery('9:30 Dubai in London'), { time: { h: 9, mi: 30 }, from: 'Asia/Dubai', to: 'Europe/London' });
  assert.deepStrictEqual(Z.parseQuery('Dubai to India'), { time: null, from: 'Asia/Dubai', to: 'Asia/Kolkata' });
  assert.deepStrictEqual(Z.parseQuery('now in Tokyo'), { time: null, from: null, to: 'Asia/Tokyo' });
  assert.deepStrictEqual(Z.parseQuery('10am'), { time: { h: 10, mi: 0 }, from: null, to: null });
  assert.ok(/Atlantis/.test(Z.parseQuery('3pm IST to Atlantis').error));
  assert.ok(Z.parseQuery('').error);
});
t('planner and overlaps: Dubai, India, London on a winter weekday', () => {
  const rows = Z.planner('2026-11-23', 'Asia/Dubai', ['Asia/Dubai', 'Asia/Kolkata', 'Europe/London']);
  assert.strictEqual(rows.length, 24);
  const r13 = rows[13];
  assert.deepStrictEqual(r13.cells.map(c => [c.h, c.mi]), [[13, 0], [14, 30], [9, 0]]);
  assert.ok(r13.allWork);
  // Whole working hours: London 09-18 = Dubai 13-22 starts 13..20; India 09-18 = Dubai 07:30-16:30 starts 08..15
  assert.deepStrictEqual(Z.overlaps(rows), [{ from: 13, to: 16 }]);
  assert.strictEqual(rows[16].cells[1].band, 'edge');
});
t('planner skips the hour that does not exist on a DST day', () => {
  assert.strictEqual(Z.planner('2026-03-08', 'America/New_York', ['America/New_York']).length, 23);
});
t('bands', () => { assert.strictEqual(Z.band(9, 0), 'work'); assert.strictEqual(Z.band(17, 0), 'work'); assert.strictEqual(Z.band(17, 30), 'edge'); assert.strictEqual(Z.band(18, 0), 'edge'); assert.strictEqual(Z.band(23, 0), 'night'); assert.strictEqual(Z.band(7, 30), 'edge'); });
t('clock text', () => { assert.strictEqual(Z.clock(0, 5, true), '12:05 AM'); assert.strictEqual(Z.clock(13, 0, true), '1:00 PM'); assert.strictEqual(Z.clock(9, 0, false), '09:00'); });
t('zones list includes UTC and common zones', () => { const z = Z.zones(); assert.ok(z.length > 300); ['UTC', 'Etc/GMT', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Ho_Chi_Minh'].forEach(x => assert.ok(z.includes(x), x)); assert.ok(!z.includes('Asia/Calcutta')); assert.strictEqual(Z.resolve('buenos aires'), 'America/Argentina/Buenos_Aires'); assert.strictEqual(Z.resolve('calcutta'), 'Asia/Kolkata'); assert.strictEqual(Z.resolve('Asia/Calcutta'), 'Asia/Kolkata'); assert.strictEqual(Z.resolve('US/Eastern'), 'US/Eastern'); assert.ok(Z.isZone('Asia/Dubai')); assert.ok(!Z.isZone('Mars/Olympus')); });

console.log(`tz: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
