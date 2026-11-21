/* Layerbit date engine (UMD: window.LBDate / module.exports).
   Calendar arithmetic on plain dates (no times, no time zones): days between
   dates, calendar differences in years, months and days, adding days, weeks,
   months, years or working days, working-day counts with any weekend and a
   holiday list, exact age and next birthday, ISO week numbers. Dates are
   'YYYY-MM-DD' strings in and out. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBDate = factory();
})(this, function () {
  'use strict';
  var DAY = 86400000;
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Weekend presets as sets of weekday numbers (0 = Sunday).
  var WEEKENDS = { 'sat-sun': [6, 0], 'fri-sat': [5, 6], 'sun': [0], 'fri': [5], 'none': [] };

  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

  /** 'YYYY-MM-DD' -> { y, m, d } or null when it is not a real date. */
  function parse(s) {
    var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(String(s || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function fmt(o) { return pad(o.y, 4) + '-' + pad(o.m) + '-' + pad(o.d); }
  /** Days since 1970-01-01 (negative before). */
  function serial(o) { return Math.round(Date.UTC(o.y, o.m - 1, o.d) / DAY); }
  function fromSerial(n) { var t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  function weekday(o) { return ((serial(o) % 7) + 7 + 4) % 7; } // 1970-01-01 was a Thursday
  function req(s, what) { var o = typeof s === 'string' ? parse(s) : s; if (!o) throw new Error('Enter a valid ' + (what || 'date') + '.'); return o; }

  /** Today's date in the runtime's local time zone. */
  function today() { var t = new Date(); return fmt({ y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }); }

  function addDays(s, n) { return fmt(fromSerial(serial(req(s)) + n)); }

  /** Adds calendar months; the day is clamped to the end of a shorter month,
   *  so 31 January + 1 month is 28 (or 29) February. */
  function addMonths(s, n) {
    var o = req(s), idx = o.y * 12 + (o.m - 1) + n, y = Math.floor(idx / 12), m = idx - y * 12 + 1;
    return fmt({ y: y, m: m, d: Math.min(o.d, daysInMonth(y, m)) });
  }
  function addYears(s, n) { return addMonths(s, 12 * n); }

  /** Whole days from a to b (negative if b is earlier). */
  function daysBetween(a, b) { return serial(req(b)) - serial(req(a)); }

  /** Calendar difference from a to b as { years, months, days, sign }: the
   *  largest number of whole months that fits, then the remaining days. */
  function diff(a, b) {
    var A = req(a), B = req(b), sign = 1;
    if (serial(B) < serial(A)) { var t = A; A = B; B = t; sign = -1; }
    var months = (B.y - A.y) * 12 + (B.m - A.m);
    if (serial(parse(addMonths(fmt(A), months))) > serial(B)) months--;
    var days = serial(B) - serial(parse(addMonths(fmt(A), months)));
    return { years: Math.floor(months / 12), months: months % 12, days: days, totalMonths: months, sign: sign };
  }

  /** Parses a holiday list: one date per line or separated by commas or
   *  semicolons; text after a date ("2026-12-02 National Day") is ignored.
   *  Returns { dates: Set of 'YYYY-MM-DD', bad: [unreadable entries] }. */
  function parseHolidays(text) {
    var dates = {}, bad = [];
    String(text || '').split(/[\n,;]+/).forEach(function (raw) {
      var s = raw.trim();
      if (!s) return;
      var m = /^(\d{4}-\d{1,2}-\d{1,2})/.exec(s), o = m && parse(m[1]);
      if (o) dates[fmt(o)] = true; else bad.push(s);
    });
    return { dates: dates, bad: bad };
  }

  function weekendSet(w) {
    var list = Array.isArray(w) ? w : (WEEKENDS[w] || WEEKENDS['sat-sun']), set = {};
    list.forEach(function (d) { set[d] = true; });
    return set;
  }

  /** Counts days from a up to b. The start date counts, the end date only
   *  when `inclusive`. Returns { total, working, weekend, holidays } where a
   *  holiday on a weekend is counted once, as weekend. */
  function count(a, b, opts) {
    opts = opts || {};
    var A = serial(req(a, 'start date')), B = serial(req(b, 'end date'));
    if (B < A) { var t = A; A = B; B = t; }
    var end = opts.inclusive ? B : B - 1;
    var we = weekendSet(opts.weekend), hol = opts.holidays || {};
    var total = 0, weekend = 0, holidays = 0;
    // Whole weeks contribute the same mix each time, so only the remainder
    // is walked day by day; spans of centuries stay instant.
    var span = end - A + 1;
    if (span > 0) {
      var weeks = Math.floor(span / 7), perWeek = Object.keys(we).length;
      total = span; weekend = weeks * perWeek;
      for (var n = A + weeks * 7; n <= end; n++) if (we[((n % 7) + 7 + 4) % 7]) weekend++;
      Object.keys(hol).forEach(function (h) {
        var o = parse(h); if (!o) return;
        var s = serial(o);
        if (s >= A && s <= end && !we[weekday(o)]) holidays++;
      });
    }
    return { total: Math.max(span, 0), working: Math.max(span, 0) - weekend - holidays, weekend: weekend, holidays: holidays };
  }

  function isWorking(n, we, hol) {
    var o = fromSerial(n);
    return !we[weekday(o)] && !hol[fmt(o)];
  }

  /** Adds n working days (negative to go back), skipping weekends and
   *  holidays. Day 0 is the start date itself, even if it is not a working
   *  day; +1 is the next working day after it. */
  function addWorkingDays(s, n, opts) {
    opts = opts || {};
    var we = weekendSet(opts.weekend), hol = opts.holidays || {};
    if (Object.keys(we).length >= 7) throw new Error('Every day is a weekend day.');
    var cur = serial(req(s)), step = n < 0 ? -1 : 1, left = Math.abs(n);
    if (left > 200000) throw new Error('That is more than 500 years of working days.');
    while (left > 0) { cur += step; if (isWorking(cur, we, hol)) left--; }
    return fmt(fromSerial(cur));
  }

  /** ISO 8601 week: weeks start on Monday and week 1 contains the year's
   *  first Thursday. Returns { year, week }. */
  function isoWeek(s) {
    var o = req(s), n = serial(o), wd = (weekday(o) + 6) % 7; // Monday = 0
    var thursday = fromSerial(n - wd + 3);
    var jan1 = serial({ y: thursday.y, m: 1, d: 1 });
    return { year: thursday.y, week: Math.floor((n - wd + 3 - jan1) / 7) + 1 };
  }

  /** Exact age on `asOf`. A 29 February birthday falls on 28 February in
   *  other years. Throws if the birth date is after asOf. */
  function age(birth, asOf) {
    var B = req(birth, 'date of birth'), T = req(asOf || today());
    if (serial(T) < serial(B)) throw new Error('The date of birth is after the "as of" date.');
    var d = diff(fmt(B), fmt(T));
    var next = birthdayIn(B, T.y);
    if (serial(parse(next)) < serial(T)) next = birthdayIn(B, T.y + 1);
    var totalDays = serial(T) - serial(B);
    return {
      years: d.years, months: d.months, days: d.days, totalMonths: d.totalMonths,
      totalWeeks: Math.floor(totalDays / 7), weekRemainder: totalDays % 7, totalDays: totalDays,
      bornWeekday: WEEKDAYS[weekday(B)], nextBirthday: next, daysToBirthday: serial(parse(next)) - serial(T),
      nextAge: parse(next).y - B.y, isBirthday: serial(parse(next)) === serial(T)
    };
  }
  function birthdayIn(B, y) { return fmt({ y: y, m: B.m, d: Math.min(B.d, daysInMonth(y, B.m)) }); }

  /** "Monday, 3 March 2026". */
  function longDate(s) { var o = req(s); return WEEKDAYS[weekday(o)] + ', ' + o.d + ' ' + MONTHS[o.m - 1] + ' ' + o.y; }
  /** "1 year, 2 months and 3 days"; zero parts are left out. */
  function words(parts) {
    var out = [];
    [['years', 'year'], ['months', 'month'], ['weeks', 'week'], ['days', 'day']].forEach(function (u) {
      var v = parts[u[0]];
      if (v) out.push(v.toLocaleString('en-US') + ' ' + u[1] + (v === 1 ? '' : 's'));
    });
    if (!out.length) return '0 days';
    return out.length === 1 ? out[0] : out.slice(0, -1).join(', ') + ' and ' + out[out.length - 1];
  }

  return {
    WEEKDAYS: WEEKDAYS, MONTHS: MONTHS, WEEKENDS: WEEKENDS,
    isLeap: isLeap, daysInMonth: daysInMonth, parse: parse, format: fmt, weekday: function (s) { return weekday(req(s)); },
    today: today, addDays: addDays, addMonths: addMonths, addYears: addYears, daysBetween: daysBetween, diff: diff,
    parseHolidays: parseHolidays, count: count, addWorkingDays: addWorkingDays, isoWeek: isoWeek, age: age,
    longDate: longDate, words: words
  };
});
