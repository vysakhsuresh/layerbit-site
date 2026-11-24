// Unit tests for js/engines/cron.js. Run: node scripts/unit/cron.test.js
const C = require('../../js/engines/cron.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const iso = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const runs = (expr, d, from, n) => { const p = C.parse(expr, d); assert.ok(p.ok, p.error); return C.next(p, Date.parse(from + 'Z'), n || 3).map(iso); };

t('unix basics and the day-of-month OR day-of-week rule', () => {
  assert.deepStrictEqual(runs('*/15 9 * * *', 'unix', '2026-11-24T09:20:00'), ['2026-11-24 09:30:00', '2026-11-24 09:45:00', '2026-11-25 09:00:00']);
  // 13th OR a Friday
  assert.deepStrictEqual(runs('0 0 13 * 5', 'unix', '2026-11-01T00:00:00', 3), ['2026-11-06 00:00:00', '2026-11-13 00:00:00', '2026-11-20 00:00:00']);
  assert.deepStrictEqual(runs('0 9 * * mon-fri', 'unix', '2026-11-27T10:00:00', 1), ['2026-11-30 09:00:00']);
  assert.deepStrictEqual(runs('0 0 * * 7', 'unix', '2026-11-24T00:00:00', 1), ['2026-11-29 00:00:00']);
  assert.deepStrictEqual(runs('@monthly', 'unix', '2026-11-24T00:00:00', 1), ['2026-12-01 00:00:00']);
});
t('errors name the field and the range', () => {
  assert.match(C.parse('60 * * * *', 'unix').error, /out of range 0–59 for the minute/);
  assert.match(C.parse('* * * *', 'unix').error, /expects 5 fields/);
  assert.match(C.parse('0 0 L * *', 'unix').error, /does not support/);
  assert.match(C.parse('@reboot', 'unix').error, /once when the cron daemon starts/);
  assert.match(C.parse('@daily', 'github').error, /does not accept @/);
  assert.match(C.parse('0 9 * * MON-FRI', 'quartz').error, /expects 6 or 7 fields/);
  assert.match(C.parse('0 0 9 * * MON-FRI', 'quartz').error, /needs \?/);
  assert.match(C.parse('0 0 9 ? * ?', 'quartz').error, /Only one/);
});
t('quartz: seconds, 1-based weekdays, L, W, #, year', () => {
  assert.deepStrictEqual(runs('30 0 9 ? * 2-6', 'quartz', '2026-11-27T10:00:00', 1), ['2026-11-30 09:00:30']);
  assert.deepStrictEqual(runs('0 0 12 L * ?', 'quartz', '2026-02-01T00:00:00', 2), ['2026-02-28 12:00:00', '2026-03-31 12:00:00']);
  assert.deepStrictEqual(runs('0 0 12 L-2 * ?', 'quartz', '2026-02-01T00:00:00', 1), ['2026-02-26 12:00:00']);
  // 15W in Nov 2026: the 15th is a Sunday, nearest weekday Monday 16th
  assert.deepStrictEqual(runs('0 0 8 15W * ?', 'quartz', '2026-11-01T00:00:00', 1), ['2026-11-16 08:00:00']);
  // 1W in Aug 2026: the 1st is a Saturday, cannot cross into July: Monday 3rd
  assert.deepStrictEqual(runs('0 0 8 1W * ?', 'quartz', '2026-08-01T00:00:00', 1), ['2026-08-03 08:00:00']);
  // LW in Oct 2026: 31st is a Saturday -> Friday 30th
  assert.deepStrictEqual(runs('0 0 8 LW * ?', 'quartz', '2026-10-01T00:00:00', 1), ['2026-10-30 08:00:00']);
  // 6#3: third Friday (Quartz 6 = Friday)
  assert.deepStrictEqual(runs('0 0 10 ? * 6#3', 'quartz', '2026-11-01T00:00:00', 2), ['2026-11-20 10:00:00', '2026-12-18 10:00:00']);
  // 2L: last Monday
  assert.deepStrictEqual(runs('0 0 10 ? * 2L', 'quartz', '2026-11-01T00:00:00', 1), ['2026-11-30 10:00:00']);
  assert.deepStrictEqual(runs('0 0 10 ? * L', 'quartz', '2026-11-01T00:00:00', 2), ['2026-11-07 10:00:00', '2026-11-14 10:00:00']);
  assert.deepStrictEqual(runs('0 0 0 1 1 ? 2028', 'quartz', '2026-11-01T00:00:00', 2), ['2028-01-01 00:00:00']);
});
t('aws: cron() wrapper, ? rule, year', () => {
  assert.deepStrictEqual(runs('cron(0 18 ? * MON-FRI *)', 'aws', '2026-11-27T19:00:00', 1), ['2026-11-30 18:00:00']);
  assert.match(C.parse('0 18 * * MON-FRI *', 'aws').error, /needs \?/);
});
t('spring and azure: 6 fields with seconds, AND for both day fields', () => {
  assert.deepStrictEqual(runs('0 */30 9-10 * * MON-FRI', 'spring', '2026-11-27T10:15:00', 2), ['2026-11-27 10:30:00', '2026-11-30 09:00:00']);
  assert.deepStrictEqual(runs('0 0 0 13 * 5', 'azure', '2026-01-01T00:00:00', 2), ['2026-02-13 00:00:00', '2026-03-13 00:00:00']);
  assert.deepStrictEqual(runs('@daily', 'spring', '2026-11-24T05:00:00', 1), ['2026-11-25 00:00:00']);
});
t('github warns about the five-minute floor', () => {
  const p = C.parse('* * * * *', 'github');
  assert.ok(p.ok && p.warnings.some(w => /5 minutes/.test(w)));
  assert.strictEqual(C.parse('*/10 * * * *', 'github').warnings.length, 0);
});
t('jenkins H', () => {
  const p = C.parse('H H(2-4) * * *', 'jenkins');
  assert.ok(p.ok, p.error);
  assert.ok(p.warnings.some(w => /H picks one fixed value/.test(w)));
  assert.ok(C.parse('H/15 * * * *', 'jenkins').ok);
  assert.ok(!C.parse('H * * * *', 'unix').ok);
});
t('heatmap counts runs per day and hour', () => {
  const h = C.heatmap(C.parse('*/15 9-10 * * 1-5', 'unix'), Date.parse('2026-11-23T00:00:00Z'), 7);
  assert.strictEqual(h.counts.length, 7);
  assert.strictEqual(h.counts[0].date, '2026-11-23');
  assert.strictEqual(h.counts[0].hours[9], 4);
  assert.strictEqual(h.counts[5].hours[9], 0);  // Saturday
  assert.strictEqual(h.total, 5 * 2 * 4);
});
t('convert between dialects', () => {
  assert.deepStrictEqual(C.convert('0 9 * * 1-5', 'unix', 'quartz').expr, '0 0 9 ? * 2-6');
  assert.deepStrictEqual(C.convert('0 9 * * 1-5', 'unix', 'aws').expr, 'cron(0 9 ? * 2-6 *)');
  assert.deepStrictEqual(C.convert('0 0 9 ? * 2-6', 'quartz', 'unix').expr, '0 9 * * 1-5');
  assert.deepStrictEqual(C.convert('*/15 * * * *', 'unix', 'spring').expr, '0 */15 * * * *');
  assert.deepStrictEqual(C.convert('0 12 1 * *', 'unix', 'aws').expr, 'cron(0 12 1 * ? *)');
  assert.deepStrictEqual(C.convert('0 0 12 L * ?', 'quartz', 'aws').expr, 'cron(0 12 L * ? *)');
  assert.match(C.convert('0 0 12 L * ?', 'quartz', 'unix').error, /no L, W or #/);
  assert.match(C.convert('30 0 9 * * *', 'spring', 'unix').error, /no seconds field/);
  assert.match(C.convert('0 0 13 * 5', 'unix', 'quartz').error, /cannot restrict both/);
  assert.match(C.convert('0 0 13 * 5', 'unix', 'spring').error, /Split it/);
  assert.ok(C.convert('0 9 * * *', 'unix', 'github').notes.some(n => /UTC/.test(n)));
  // round trip
  ['0 9 * * 1-5', '*/5 * * * *', '0 0 1,15 * *', '30 2 * 1-3 0'].forEach(e => {
    const q = C.convert(e, 'unix', 'quartz'); assert.ok(q.ok, q.error);
    assert.strictEqual(C.convert(q.expr, 'quartz', 'unix').expr, e, e + ' via ' + q.expr);
  });
});
t('converted expressions schedule the same runs', () => {
  const from = Date.parse('2026-11-01T00:00:00Z');
  ['0 9 * * 1-5', '15 */6 1-7 * *', '0 0 * * 0', '0 12 * 2 2,4'].forEach(e => {
    const u = C.next(C.parse(e, 'unix'), from, 20);
    ['quartz', 'aws', 'spring', 'azure', 'k8s'].forEach(d => {
      const c = C.convert(e, 'unix', d); assert.ok(c.ok, d + ': ' + c.error);
      assert.deepStrictEqual(C.next(C.parse(c.expr, d), from, 20), u, e + ' -> ' + d + ' ' + c.expr);
    });
  });
});
t('English to cron', () => {
  const E = s => { const r = C.fromEnglish(s); assert.ok(r.ok, s + ': ' + r.error); return r.expr; };
  assert.strictEqual(E('every 15 minutes'), '*/15 * * * *');
  assert.strictEqual(E('every minute'), '* * * * *');
  assert.strictEqual(E('every 2 hours'), '0 */2 * * *');
  assert.strictEqual(E('weekdays at 9:30'), '30 9 * * 1-5');
  assert.strictEqual(E('every Monday at 5pm'), '0 17 * * 1');
  assert.strictEqual(E('every day at midnight'), '0 0 * * *');
  assert.strictEqual(E('daily'), '0 0 * * *');
  assert.strictEqual(E('on the 1st of every month at 6am'), '0 6 1 * *');
  assert.strictEqual(E('twice a day at 9 and 21'), '0 9,21 * * *');
  assert.strictEqual(E('every Tuesday and Thursday at 8:15 am'), '15 8 * * 2,4');
  assert.strictEqual(E('weekends at noon'), '0 12 * * 0,6');
  assert.strictEqual(E('every hour'), '0 * * * *');
  assert.strictEqual(E('at 12am on the 15th'), '0 0 15 * *');
  assert.strictEqual(E('every year'), '0 0 1 1 *');
  assert.strictEqual(E('at 9am in january and july'), '0 9 * 1,7 *');
  assert.ok(!C.fromEnglish('last day of the month').ok);
  assert.ok(!C.fromEnglish('banana').ok);
  // every English result is a valid unix expression
  ['every 5 minutes', 'weekdays at 9:30', 'every Monday at 5pm'].forEach(s => assert.ok(C.parse(E(s), 'unix').ok));
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
