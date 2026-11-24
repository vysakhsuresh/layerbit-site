/* Layerbit cron engine: parse, schedule and convert cron expressions in the
 * dialects people actually deploy. Pure functions, no DOM. Browser
 * (window.LBCron) and Node.
 *
 * DIALECTS[id] = {name, seconds, year, dowBase, needsQuestion, special, dayLogic, macros, tz, notes}
 * parse(expr, dialect) -> {ok, error, f: {sec, min, hour, dom, mon, dow, year}, macro, warnings}
 *   a field is {any, values: Set, last, lastOffset, nearestWeekday, lastWeekday, nth: [dow, n], lastDow, hashed, text}
 * next(parsed, fromWallMs, count) -> [wall-clock ms, as UTC fields]  (runs strictly after fromWallMs)
 * heatmap(parsed, fromWallMs, days) -> {counts: [day][hour], total}
 * convert(expr, from, to) -> {ok, expr, notes, error}
 * fromEnglish(text) -> {ok, expr, error}  (a 5-field Unix expression)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBCron = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var MACROS = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };

  var DIALECTS = {
    unix: { name: 'Unix cron (Vixie, cronie)', fields: ['min', 'hour', 'dom', 'mon', 'dow'], dowBase: 0, dayLogic: 'or', macros: true, special: false, tz: 'the server\'s time zone' },
    github: { name: 'GitHub Actions', fields: ['min', 'hour', 'dom', 'mon', 'dow'], dowBase: 0, dayLogic: 'or', macros: false, special: false, tz: 'UTC', minInterval: 5 },
    k8s: { name: 'Kubernetes CronJob', fields: ['min', 'hour', 'dom', 'mon', 'dow'], dowBase: 0, dayLogic: 'or', macros: true, special: false, tz: 'the controller\'s zone, or spec.timeZone' },
    jenkins: { name: 'Jenkins', fields: ['min', 'hour', 'dom', 'mon', 'dow'], dowBase: 0, dayLogic: 'or', macros: true, special: false, hash: true, tz: 'the Jenkins controller\'s zone' },
    quartz: { name: 'Quartz', fields: ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year?'], dowBase: 1, dayLogic: 'question', special: true, tz: 'the scheduler\'s zone' },
    spring: { name: 'Spring @Scheduled', fields: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'], dowBase: 0, dayLogic: 'and', macros: true, special: true, tz: 'the zone attribute, or the server\'s' },
    aws: { name: 'AWS EventBridge', fields: ['min', 'hour', 'dom', 'mon', 'dow', 'year'], dowBase: 1, dayLogic: 'question', special: true, tz: 'UTC (EventBridge Scheduler can set a zone)', wrap: true },
    azure: { name: 'Azure Functions (NCRONTAB)', fields: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'], dowBase: 0, dayLogic: 'and', special: false, tz: 'UTC, or WEBSITE_TIME_ZONE' }
  };
  var RANGE = { sec: [0, 59], min: [0, 59], hour: [0, 23], dom: [1, 31], mon: [1, 12], dow: [0, 7], year: [1970, 2199] };

  function field(kind, text, d) {
    var lo = RANGE[kind][0], hi = RANGE[kind][1], f = { any: false, values: new Set(), text: text };
    if (kind === 'dow') { hi = d.dowBase === 1 ? 7 : (d.id === 'azure' ? 6 : 7); lo = d.dowBase; }
    var t = text.toLowerCase();
    var names = kind === 'mon' ? MON : kind === 'dow' ? DOW : null;
    if (names) t = t.replace(/[a-z]{3}/g, function (n) { if (n === 'lw') return n; var i = names.indexOf(n); if (i < 0) throw new Error('"' + n.toUpperCase() + '" is not a ' + (kind === 'mon' ? 'month' : 'weekday') + ' name'); return String(kind === 'mon' ? i + 1 : i + d.dowBase); });
    if (t === '?') { if (kind !== 'dom' && kind !== 'dow') throw new Error('? is only allowed for the day-of-month or day-of-week field'); if (!d.special && d.id !== 'unix' && d.id !== 'k8s' && d.id !== 'github') throw new Error(d.name + ' does not accept ?'); f.any = true; f.question = true; return f; }
    if (t === '*' || t === '*/1') { f.any = true; return f; }
    if (d.hash && /^h/.test(t)) {
      var hm = /^h(?:\((\d+)-(\d+)\))?(?:\/(\d+))?$/.exec(t); if (!hm) throw new Error('"' + text + '" is not a valid H form');
      f.hashed = true; f.hashRange = [hm[1] ? +hm[1] : lo, hm[2] ? +hm[2] : (kind === 'dom' ? 28 : hi)]; f.hashStep = hm[3] ? +hm[3] : 0;
      var a0 = f.hashRange[0]; if (f.hashStep) for (var v0 = a0; v0 <= f.hashRange[1]; v0 += f.hashStep) f.values.add(v0); else f.values.add(a0);
      return f;
    }
    if (kind === 'dom' && d.special) {
      var m;
      if (t === 'l') { f.last = true; f.lastOffset = 0; return f; }
      if ((m = /^l-(\d+)$/.exec(t))) { f.last = true; f.lastOffset = +m[1]; if (f.lastOffset > 30) throw new Error('L-' + m[1] + ' is too far from the end of the month'); return f; }
      if (t === 'lw') { f.lastWeekday = true; return f; }
      if ((m = /^(\d+)w$/.exec(t))) { f.nearestWeekday = +m[1]; if (f.nearestWeekday < 1 || f.nearestWeekday > 31) throw new Error(text + ' is out of range'); return f; }
    }
    if (kind === 'dow' && d.special) {
      var m2;
      if ((m2 = /^(\d)#([1-5])$/.exec(t))) { f.nth = [norm(+m2[1], d), +m2[2]]; return f; }
      if ((m2 = /^(\d)l$/.exec(t))) { f.lastDow = norm(+m2[1], d); return f; }
      if (t === 'l') { f.values.add(6); return f; }   // a bare L here means Saturday
    }
    if (/[lw#]/.test(t)) throw new Error('"' + text + '" uses L, W or #, which ' + d.name + ' does not support');
    t.split(',').forEach(function (part) {
      var m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!m) throw new Error('"' + part + '" is not a valid value');
      var step = m[2] ? +m[2] : 1, a, b;
      if (m[1] === '*') { a = lo; b = hi; } else if (m[1].indexOf('-') >= 0) { a = +m[1].split('-')[0]; b = +m[1].split('-')[1]; } else { a = +m[1]; b = m[2] ? hi : a; }
      if (a < lo || b > hi) throw new Error('"' + part + '" is out of range ' + lo + '–' + hi + ' for the ' + LABEL[kind] + ' field');
      if (step < 1) throw new Error('A step of 0 is not allowed');
      if (a > b) { if (!d.wrap && kind !== 'dow') throw new Error('"' + part + '" runs backwards'); for (var v = a; v <= hi; v += step) f.values.add(v); for (v = lo; v <= b; v += step) f.values.add(v); return; }
      for (var v2 = a; v2 <= b; v2 += step) f.values.add(v2);
    });
    if (kind === 'dow') { var s2 = new Set(); f.values.forEach(function (v) { s2.add(norm(v, d)); }); f.values = s2; }
    return f;
  }
  var LABEL = { sec: 'seconds', min: 'minute', hour: 'hour', dom: 'day-of-month', mon: 'month', dow: 'day-of-week', year: 'year' };
  // weekday as 0 = Sunday
  function norm(v, d) { return d.dowBase === 1 ? (v - 1) % 7 : v % 7; }

  function parse(expr, dialect) {
    var d = Object.assign({ id: dialect }, DIALECTS[dialect] || DIALECTS.unix), warnings = [], macro = null;
    var e = String(expr || '').trim();
    if (d.id === 'aws') e = e.replace(/^cron\((.*)\)$/i, '$1').trim();
    if (/^@/.test(e)) {
      var mac = e.toLowerCase();
      if (mac === '@reboot') return { ok: false, reboot: true, error: '@reboot runs once when the cron daemon starts; it has no schedule.' };
      if (/^@every\s/.test(mac)) return { ok: false, error: '@every is a Go-library extension; ' + d.name + ' does not schedule it.' };
      if (!MACROS[mac]) return { ok: false, error: '"' + e + '" is not a known @ shortcut' };
      if (!d.macros) return { ok: false, error: d.name + ' does not accept @ shortcuts; write ' + MACROS[mac] + ' instead.' };
      macro = mac; e = MACROS[mac];
      if (d.fields[0] === 'sec') e = '0 ' + e;
      if (d.dowBase === 1) e = e.replace(/ 0$/, ' 1');
    }
    var parts = e.split(/\s+/).filter(Boolean), want = d.fields.filter(function (x) { return x.slice(-1) !== '?'; }).length, max = d.fields.length;
    if (parts.length < want || parts.length > max) return { ok: false, error: d.name + ' expects ' + (want === max ? want : want + ' or ' + max) + ' fields (' + d.fields.map(function (x) { return LABEL[x.replace('?', '')]; }).join(', ') + '); this has ' + parts.length + '.' };
    var f = { sec: null, min: null, hour: null, dom: null, mon: null, dow: null, year: null };
    try {
      d.fields.forEach(function (k, i) { k = k.replace('?', ''); if (parts[i] !== undefined) f[k] = field(k, parts[i], d); });
    } catch (err) { return { ok: false, error: err.message }; }
    if (!f.sec) f.sec = { any: false, values: new Set([0]), text: '0' };
    if (!f.year) f.year = { any: true, values: new Set(), text: '*' };
    if (d.dayLogic === 'question') {
      var qd = f.dom.question, qw = f.dow.question;
      if (qd && qw) return { ok: false, error: 'Only one of day-of-month and day-of-week can be ?' };
      if (!qd && !qw) return { ok: false, error: d.name + ' needs ? in either the day-of-month or the day-of-week field (for example 0 9 ? * MON-FRI' + (d.id === 'aws' ? ' *' : '') + ').' };
    }
    if (d.minInterval) { var gaps = next({ ok: true, f: f, d: d }, Date.UTC(2026, 0, 1), 3); if (gaps.length > 1 && gaps[1] - gaps[0] < d.minInterval * 60000) warnings.push('GitHub runs scheduled workflows at most once every ' + d.minInterval + ' minutes, and runs can start late when it is busy.'); }
    if (d.hash && ['min', 'hour', 'dom', 'mon', 'dow'].some(function (k) { return f[k] && f[k].hashed; })) warnings.push('H picks one fixed value per job, derived from the job\'s name, so the exact minute differs between jobs. The runs below show the earliest value H can take.');
    return { ok: true, f: f, d: d, macro: macro, warnings: warnings };
  }

  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m 1-12
  function domMatch(fd, y, m, day) {
    if (fd.any) return true;
    var ld = lastDay(y, m);
    if (fd.last) return day === ld - fd.lastOffset;
    if (fd.lastWeekday) { var t = ld, w = new Date(Date.UTC(y, m - 1, t)).getUTCDay(); if (w === 6) t -= 1; else if (w === 0) t -= 2; return day === t; }
    if (fd.nearestWeekday) {
      var target = Math.min(fd.nearestWeekday, ld), wd = new Date(Date.UTC(y, m - 1, target)).getUTCDay();
      if (wd === 6) target = target === 1 ? 3 : target - 1; else if (wd === 0) target = target === ld ? target - 2 : target + 1;
      return day === target;
    }
    return fd.values.has(day);
  }
  function dowMatch(fw, y, m, day) {
    if (fw.any) return true;
    var wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (fw.nth) return wd === fw.nth[0] && Math.ceil(day / 7) === fw.nth[1];
    if (fw.lastDow !== undefined) return wd === fw.lastDow && day + 7 > lastDay(y, m);
    return fw.values.has(wd);
  }
  function dayOk(p, y, m, day) {
    var f = p.f, logic = p.d.dayLogic;
    if (!f.mon.any && !f.mon.values.has(m)) return false;
    if (!f.year.any && !f.year.values.has(y)) return false;
    var dRestricted = !f.dom.any, wRestricted = !f.dow.any;
    if (logic === 'or' && dRestricted && wRestricted) return domMatch(f.dom, y, m, day) || dowMatch(f.dow, y, m, day);
    return domMatch(f.dom, y, m, day) && dowMatch(f.dow, y, m, day);
  }
  var sorted = function (fd, lo, hi) { if (fd.any) { var a = []; for (var i = lo; i <= hi; i++) a.push(i); return a; } return Array.from(fd.values).sort(function (x, y) { return x - y; }); };
  function next(p, from, count) {
    if (!p || !p.ok) return [];
    var f = p.f, out = [], secs = sorted(f.sec, 0, 59), mins = sorted(f.min, 0, 59), hours = sorted(f.hour, 0, 23);
    var start = new Date(from), day0 = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    for (var k = 0; k < 366 * 30 && out.length < count; k++) {
      var t = new Date(day0 + k * DAY), y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, dd = t.getUTCDate();
      if (y > 2199) break;
      if (!dayOk(p, y, m, dd)) continue;
      for (var hi = 0; hi < hours.length && out.length < count; hi++) for (var mi = 0; mi < mins.length && out.length < count; mi++) for (var si = 0; si < secs.length && out.length < count; si++) {
        var ms = day0 + k * DAY + hours[hi] * 3600000 + mins[mi] * 60000 + secs[si] * 1000;
        if (ms > from) out.push(ms);
      }
    }
    return out;
  }
  function heatmap(p, from, days) {
    var start = new Date(from), day0 = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()), counts = [], total = 0;
    var f = p.f, perHour = {}, mins = sorted(f.min, 0, 59).length * sorted(f.sec, 0, 59).length, hours = new Set(sorted(f.hour, 0, 23));
    for (var k = 0; k < days; k++) {
      var t = new Date(day0 + k * DAY), row = [];
      var ok = dayOk(p, t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
      for (var h = 0; h < 24; h++) { var c = ok && hours.has(h) ? mins : 0; row.push(c); total += c; }
      counts.push({ date: t.toISOString().slice(0, 10), hours: row });
    }
    return { counts: counts, total: total };
  }

  // -------------------------------------------------------------- convert
  function compress(vals, lo, hi) {
    var v = Array.from(vals).sort(function (a, b) { return a - b; });
    if (!v.length) return '*';
    if (v.length === hi - lo + 1) return '*';
    if (v.length > 2) { var step = v[1] - v[0], ap = v.every(function (x, i) { return !i || x - v[i - 1] === step; }); if (ap && step > 1 && v[0] === lo && v[v.length - 1] + step > hi) return '*/' + step; if (ap && step > 1) return v[0] + '-' + v[v.length - 1] + '/' + step; }
    var parts = [], s = v[0], prev = v[0];
    for (var i = 1; i <= v.length; i++) { if (i < v.length && v[i] === prev + 1) { prev = v[i]; continue; } parts.push(s === prev ? String(s) : prev === s + 1 ? s + ',' + prev : s + '-' + prev); if (i < v.length) { s = prev = v[i]; } }
    return parts.join(',');
  }
  function convert(expr, from, to) {
    var p = parse(expr, from), notes = [];
    if (!p.ok) return { ok: false, error: p.error };
    var T = Object.assign({ id: to }, DIALECTS[to]), f = p.f;
    var special = ['dom', 'dow'].some(function (k) { var x = f[k]; return x.last || x.lastWeekday || x.nearestWeekday || x.nth || x.lastDow !== undefined; });
    if (special && !T.special) return { ok: false, error: T.name + ' has no L, W or # (last day, nearest weekday, nth weekday). Use a script that checks the date, or a dialect that has them (Quartz, Spring, AWS).' };
    if (['min', 'hour', 'dom', 'mon', 'dow'].some(function (k) { return f[k].hashed; }) && !T.hash) return { ok: false, error: 'H is Jenkins-only; pick a fixed value for the other dialect.' };
    var hasSec = T.fields[0] === 'sec';
    if (!hasSec && !(f.sec.values.size === 1 && f.sec.values.has(0))) return { ok: false, error: T.name + ' has no seconds field; it can only run on the minute.' };
    var hasYear = T.fields.some(function (x) { return x.replace('?', '') === 'year'; });
    if (!f.year.any && !hasYear) return { ok: false, error: T.name + ' has no year field; this schedule is limited to ' + f.year.text + '.' };
    var dR = !f.dom.any, wR = !f.dow.any;
    if (dR && wR) {
      var fromOr = p.d.dayLogic === 'or';
      if (T.dayLogic === 'question') return { ok: false, error: T.name + ' cannot restrict both the day of the month and the day of the week. ' + (fromOr ? 'Unix cron runs when either matches; split it into two schedules.' : 'Split it into two schedules.') };
      if ((T.dayLogic === 'or') !== fromOr) return { ok: false, error: 'With both day fields set, ' + p.d.name + ' runs when ' + (fromOr ? 'either' : 'both') + ' match, but ' + T.name + ' runs when ' + (fromOr ? 'both' : 'either') + ' match. Split it into two schedules.' };
    }
    var fld = function (k) {
      var x = f[k];
      if (k === 'dom') { if (x.last) return x.lastOffset ? 'L-' + x.lastOffset : 'L'; if (x.lastWeekday) return 'LW'; if (x.nearestWeekday) return x.nearestWeekday + 'W'; }
      if (k === 'dow') {
        var num = function (w) { return String(T.dowBase === 1 ? w + 1 : w); };
        if (x.nth) return num(x.nth[0]) + '#' + x.nth[1];
        if (x.lastDow !== undefined) return num(x.lastDow) + 'L';
        if (x.any) return '*';
        return compress(Array.from(x.values).map(function (w) { return T.dowBase === 1 ? w + 1 : w; }), T.dowBase, T.dowBase + 6);
      }
      if (x.any) return '*';
      return compress(x.values, RANGE[k][0], RANGE[k][1]);
    };
    var out = {};
    ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year'].forEach(function (k) { out[k] = fld(k); });
    if (T.dayLogic === 'question') { if (wR) out.dom = '?'; else out.dow = '?'; }
    var expr2 = T.fields.map(function (k) { var kk = k.replace('?', ''); return kk === 'year' && k.slice(-1) === '?' && out.year === '*' ? null : out[kk]; }).filter(function (x) { return x !== null; }).join(' ');
    if (to === 'aws') expr2 = 'cron(' + expr2 + ')';
    if (p.d.tz !== T.tz) notes.push(p.d.name + ' uses ' + p.d.tz + '; ' + T.name + ' uses ' + T.tz + '. Shift the hour if the zones differ.');
    if (to === 'github') { var g = parse(expr2, 'github'); if (g.ok && g.warnings.length) notes = notes.concat(g.warnings); }
    return { ok: true, expr: expr2, notes: notes };
  }

  // -------------------------------------------------------------- English
  var NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
  var DAYNAME = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  function parseTime(s) {
    s = s.trim().toLowerCase();
    if (s === 'midnight') return [0, 0]; if (s === 'noon' || s === 'midday') return [12, 0];
    var m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s); if (!m) return null;
    var h = +m[1], mi = m[2] ? +m[2] : 0, ap = m[3] ? m[3][0] : '';
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return [h, mi];
  }
  function fromEnglish(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[,.](?!\d)/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    Object.keys(NUM).forEach(function (w) { t = t.replace(new RegExp(' ' + w + ' ', 'g'), ' ' + NUM[w] + ' '); });
    var min = '0', hour = '*', dom = '*', mon = '*', dow = '*', m, times = [], got = false;
    // times: "at 9am", "at 9:30 and 17:00", "at noon"
    var tm = /\bat ((?:(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight|midday)(?:\s*(?:and|&)\s*)?)+)/.exec(t);
    if (tm) { tm[1].split(/\s*(?:and|&)\s*/).filter(Boolean).forEach(function (x) { var p = parseTime(x); if (p) times.push(p); }); }
    if ((m = / every (\d+) minutes? /.exec(t))) { min = '*/' + m[1]; got = true; }
    else if (/ every minute /.test(t)) { min = '*'; got = true; }
    else if ((m = / every (\d+) hours? /.exec(t))) { min = '0'; hour = '*/' + m[1]; got = true; }
    else if (/ every hour | hourly /.test(t)) { min = '0'; hour = '*'; got = true; }
    if ((m = / (?:every|each) (\d+) days? /.exec(t))) { dom = '*/' + m[1]; got = true; }
    if (/ weekdays? | every weekday | monday (?:to|through|-) friday | mon-fri /.test(t)) { dow = '1-5'; got = true; }
    else if (/ weekends? /.test(t)) { dow = '0,6'; got = true; }
    else {
      var days = []; Object.keys(DAYNAME).forEach(function (n) { if (new RegExp(' (?:on |every )?' + n + 's? ').test(t) && days.indexOf(DAYNAME[n]) < 0) days.push(DAYNAME[n]); });
      if (days.length) { dow = days.sort().join(','); got = true; }
    }
    if (/ (?:first|1st) (?:day )?of (?:the |every |each )?month | monthly /.test(t)) { dom = '1'; got = true; }
    else if ((m = / on the (\d{1,2})(?:st|nd|rd|th)? /.exec(t))) { dom = m[1]; got = true; }
    if (/ last day of (?:the |every |each )?month /.test(t)) return { ok: false, error: 'Unix cron cannot say "last day of the month". Quartz, Spring and AWS can: L in the day-of-month field.' };
    var months = []; MON.forEach(function (mn, i) { if (new RegExp(' (?:in |of )?' + mn + '[a-z]* ').test(' ' + t.replace(/ (?:mon|monday)s? /g, ' ') + ' ') && !/ every month /.test(t)) months.push(i + 1); });
    if (months.length && !/ may (?:be|run)/.test(t)) { mon = months.join(','); got = true; }
    if (/ yearly | annually | every year /.test(t)) { dom = dom === '*' ? '1' : dom; mon = mon === '*' ? '1' : mon; got = true; }
    if (/ (?:daily|every day|each day|every night|nightly) /.test(t)) got = true;
    if (times.length) {
      if (hour.indexOf('/') >= 0 || min.indexOf('*') >= 0) return { ok: false, error: 'Give either a repeat ("every 15 minutes") or clock times ("at 9:00"), not both.' };
      var mins = times.map(function (x) { return x[1]; });
      if (mins.every(function (x) { return x === mins[0]; })) { min = String(mins[0]); hour = times.map(function (x) { return x[0]; }).sort(function (a, b) { return a - b; }).join(','); }
      else if (times.length === 1) { min = String(times[0][1]); hour = String(times[0][0]); }
      else return { ok: false, error: 'Unix cron needs the same minute for every time in one line; use one line per time.' };
      got = true;
    } else if (got && hour === '*' && min === '0' && (dow !== '*' || dom !== '*' || mon !== '*') && !/ hour/.test(t)) { hour = '0'; }
    if (/ (?:daily|every day|each day) /.test(t) && !times.length && hour === '*' && min === '0') hour = '0';
    if (!got) return { ok: false, error: 'Try phrases like "every 15 minutes", "weekdays at 9:30", "every Monday at 5pm", "on the 1st of every month at midnight" or "twice a day at 9 and 21".' };
    return { ok: true, expr: [min, hour, dom, mon, dow].join(' ') };
  }

  return { DIALECTS: DIALECTS, MACROS: MACROS, parse: parse, next: next, heatmap: heatmap, convert: convert, fromEnglish: fromEnglish };
});
