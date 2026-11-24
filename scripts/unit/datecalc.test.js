// Unit tests for js/engines/datecalc.js. Run: node scripts/unit/datecalc.test.js
const D = require('../../js/engines/datecalc.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }

t('parse rejects impossible dates', () => {
  assert.deepStrictEqual(D.parse('2026-02-28'), { y: 2026, m: 2, d: 28 });
  ['2026-02-29', '2026-13-01', '2026-04-31', 'abc', ''].forEach(s => assert.strictEqual(D.parse(s), null, s));
  assert.ok(D.parse('2024-02-29'));
  assert.ok(D.isLeap(2000) && !D.isLeap(1900) && D.isLeap(2024) && !D.isLeap(2026));
});
t('days between and weekdays', () => {
  assert.strictEqual(D.daysBetween('2026-01-01', '2026-12-31'), 364);
  assert.strictEqual(D.daysBetween('2026-12-31', '2026-01-01'), -364);
  assert.strictEqual(D.daysBetween('1990-05-15', '2026-11-21'), 13339);
  assert.strictEqual(D.WEEKDAYS[D.weekday('1990-05-15')], 'Tuesday');
  assert.strictEqual(D.WEEKDAYS[D.weekday('1969-07-20')], 'Sunday');
  assert.strictEqual(D.longDate('2026-11-20'), 'Friday, 20 November 2026');
});
t('add months clamps to the end of shorter months', () => {
  assert.strictEqual(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(D.addMonths('2024-01-31', 1), '2024-02-29');
  assert.strictEqual(D.addMonths('2026-03-31', -1), '2026-02-28');
  assert.strictEqual(D.addMonths('2026-11-15', 3), '2027-02-15');
  assert.strictEqual(D.addYears('2024-02-29', 1), '2025-02-28');
  assert.strictEqual(D.addDays('2026-12-30', 3), '2027-01-02');
  assert.strictEqual(D.addDays('2026-03-01', -1), '2026-02-28');
});
t('calendar difference in years, months and days', () => {
  assert.deepStrictEqual(D.diff('2026-01-31', '2026-03-01'), { years: 0, months: 1, days: 1, totalMonths: 1, sign: 1 });
  assert.deepStrictEqual(D.diff('2000-02-29', '2026-02-28'), { years: 26, months: 0, days: 0, totalMonths: 312, sign: 1 });
  assert.deepStrictEqual(D.diff('2026-03-01', '2026-01-31'), { years: 0, months: 1, days: 1, totalMonths: 1, sign: -1 });
  const d = D.diff('1990-05-15', '2026-11-21');
  assert.deepStrictEqual([d.years, d.months, d.days], [36, 6, 6]);
});
t('working days with different weekends', () => {
  assert.deepStrictEqual(D.count('2026-11-02', '2026-11-09', { weekend: 'sat-sun' }), { total: 7, working: 5, weekend: 2, holidays: 0 });
  assert.deepStrictEqual(D.count('2026-11-02', '2026-11-09', { weekend: 'fri-sat' }), { total: 7, working: 5, weekend: 2, holidays: 0 });
  assert.deepStrictEqual(D.count('2026-11-02', '2026-11-09', { weekend: 'sun' }), { total: 7, working: 6, weekend: 1, holidays: 0 });
  assert.strictEqual(D.count('2026-11-02', '2026-11-09', { weekend: 'sun', inclusive: true }).total, 8);
  assert.strictEqual(D.count('2026-12-01', '2026-12-31', { weekend: 'sat-sun', inclusive: true }).working, 23);
});
t('holidays are excluded once, and not when they fall on a weekend', () => {
  const h = D.parseHolidays('2026-12-02 National Day\n2026-12-03, 2026-12-05; nonsense\n\n2026-12-02');
  assert.deepStrictEqual(Object.keys(h.dates).sort(), ['2026-12-02', '2026-12-03', '2026-12-05']);
  assert.deepStrictEqual(h.bad, ['nonsense']);
  const c = D.count('2026-12-01', '2026-12-31', { weekend: 'sat-sun', inclusive: true, holidays: h.dates });
  assert.deepStrictEqual(c, { total: 31, working: 21, weekend: 8, holidays: 2 });
});
t('very long spans are counted without walking every day', () => {
  const t0 = Date.now(), c = D.count('1900-01-01', '2100-01-01', { weekend: 'sat-sun' });
  assert.strictEqual(c.total, D.daysBetween('1900-01-01', '2100-01-01'));
  assert.strictEqual(c.working + c.weekend, c.total);
  assert.ok(Date.now() - t0 < 200);
});
t('adding working days', () => {
  assert.strictEqual(D.addWorkingDays('2026-11-20', 1, { weekend: 'sat-sun' }), '2026-11-23');
  assert.strictEqual(D.addWorkingDays('2026-11-20', 1, { weekend: 'fri-sat' }), '2026-11-22');
  assert.strictEqual(D.addWorkingDays('2026-11-23', -1, { weekend: 'sat-sun' }), '2026-11-20');
  assert.strictEqual(D.addWorkingDays('2026-12-01', 1, { weekend: 'sat-sun', holidays: { '2026-12-02': true, '2026-12-03': true } }), '2026-12-04');
  assert.strictEqual(D.addWorkingDays('2026-11-21', 0, { weekend: 'sat-sun' }), '2026-11-21');
  assert.strictEqual(D.addWorkingDays('2026-11-02', 10, { weekend: 'sat-sun' }), '2026-11-16');
  assert.throws(() => D.addWorkingDays('2026-11-02', 1, { weekend: [0, 1, 2, 3, 4, 5, 6] }), /Every day/);
});
t('ISO week numbers', () => {
  assert.deepStrictEqual(D.isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepStrictEqual(D.isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.deepStrictEqual(D.isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepStrictEqual(D.isoWeek('2026-11-20'), { year: 2026, week: 47 });
});
t('age, next birthday and leap-day birthdays', () => {
  const a = D.age('1990-05-15', '2026-11-21');
  assert.deepStrictEqual([a.years, a.months, a.days], [36, 6, 6]);
  assert.strictEqual(a.totalDays, 13339); assert.strictEqual(a.totalWeeks, 1905); assert.strictEqual(a.weekRemainder, 4);
  assert.strictEqual(a.bornWeekday, 'Tuesday');
  assert.strictEqual(a.nextBirthday, '2027-05-15'); assert.strictEqual(a.nextAge, 37); assert.strictEqual(a.daysToBirthday, 175);
  const l = D.age('2004-02-29', '2026-02-28');
  assert.ok(l.isBirthday); assert.strictEqual(l.years, 22); assert.strictEqual(l.daysToBirthday, 0);
  assert.strictEqual(D.age('2004-02-29', '2026-03-01').nextBirthday, '2027-02-28');
  assert.strictEqual(D.age('2004-02-29', '2027-06-01').nextBirthday, '2028-02-29');
  assert.throws(() => D.age('2030-01-01', '2026-01-01'), /after/);
});
t('words', () => {
  assert.strictEqual(D.words({ years: 1, months: 2, days: 3 }), '1 year, 2 months and 3 days');
  assert.strictEqual(D.words({ years: 0, months: 0, days: 1 }), '1 day');
  assert.strictEqual(D.words({ weeks: 2, days: 0 }), '2 weeks');
  assert.strictEqual(D.words({}), '0 days');
  assert.strictEqual(D.words({ days: 13339 }), '13,339 days');
});

t('Hijri: Umm al-Qura dates both ways, month lengths, impossible days', () => {
  const h = D.toHijri('2026-03-20');
  assert.deepStrictEqual([h.y, h.m, h.d, h.monthName], [1447, 10, 1, 'Shawwal']);
  assert.strictEqual(D.fromHijri(1447, 9, 1), '2026-02-18');
  assert.strictEqual(D.fromHijri(1446, 12, 10), '2025-06-06');
  for (const g of ['2000-01-01', '2024-07-07', '2030-12-31']) { const x = D.toHijri(g); assert.strictEqual(D.fromHijri(x.y, x.m, x.d), g); }
  assert.ok([29, 30].includes(D.hijriMonthLength(1447, 9)));
  assert.strictEqual(D.fromHijri(1447, 9, 31), null);
});
t('moments and durations: times kept, DST-free arithmetic', () => {
  const a = D.parseMoment('2026-11-23T09:15'), b = D.parseMoment('2026-11-25T17:45');
  const d = D.duration(b - a);
  assert.deepStrictEqual([d.days, d.hours, d.minutes, d.totalHours], [2, 8, 30, 56.5]);
  assert.strictEqual(D.durationWords(d), '2 days, 8 hours and 30 minutes');
  assert.strictEqual(D.parseMoment('2026-02-30T10:00'), null);
  assert.ok(D.duration(a - b).negative);
});

console.log(`datecalc: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
