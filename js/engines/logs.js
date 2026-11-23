/* Layerbit log parsing: timestamps, formats, events, a timeline and merging.
 * Pure functions, no DOM. Browser / Worker (self.LBLogs) and Node.
 *
 * parseTime(text, year?)      -> epoch ms or null. ISO 8601, Apache/nginx
 *     [23/Nov/2026:09:15:02 +0000], syslog "Nov  3 09:15:02" (year given or
 *     this year), Windows "11/23/2026 9:15:02 PM", epoch seconds or ms. A
 *     time with no zone is read as UTC, so the same file always gives the
 *     same timeline.
 * detectFormat(lines)          -> 'json' | 'logfmt' | 'access' | 'syslog' | 'syslog5424' | 'windows' | 'plain'
 * parseEvent(text, format, year?) -> {ts, level: ERROR|WARN|INFO|DEBUG|null, msg, fields}
 * levelOf(text)                -> the level a line's words suggest
 * splitEvents(text)            -> [{line, text}]: a stack trace or traceback
 *     joins the event before it
 * histogram(tsList, levels, maxBuckets) -> {start, step, counts: [{ERROR, WARN, INFO, DEBUG, OTHER}], untimed}
 * mergeByTime(streams)         -> one list in time order; ties keep file order,
 *     an event with no time stays right after the one before it in its file
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBLogs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function zone(z) {
    if (!z || z === 'Z' || z === 'z') return 0;
    var m = /^([+-])(\d{2}):?(\d{2})$/.exec(z); if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000;
  }
  function frac(f) { return f ? Math.round(+('0.' + f.replace(/^[.,]/, '')) * 1000) : 0; }
  function parseTime(s, year) {
    s = String(s == null ? '' : s).trim();
    var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})([.,]\d+)?\s*(Z|z|[+-]\d{2}:?\d{2})?/.exec(s)))
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + frac(m[7]) - zone(m[8]);
    if ((m = /^(\d{4})\/(\d{2})\/(\d{2})[T ](\d{2}):(\d{2}):(\d{2})([.,]\d+)?/.exec(s)))
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + frac(m[7]);
    if ((m = /^\[?(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\s*([+-]\d{4}))?\]?/.exec(s)) && MON[m[2].toLowerCase()] !== undefined)
      return Date.UTC(+m[3], MON[m[2].toLowerCase()], +m[1], +m[4], +m[5], +m[6]) - zone(m[7] ? m[7].slice(0, 3) + ':' + m[7].slice(3) : null);
    if ((m = /^([A-Za-z]{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(s)) && MON[m[1].toLowerCase()] !== undefined)
      return Date.UTC(year || new Date().getUTCFullYear(), MON[m[1].toLowerCase()], +m[2], +m[3], +m[4], +m[5]) + frac(m[6]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(s))) {
      var h = +m[4]; if (m[7]) { var pm = /p/i.test(m[7]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
      return Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5], +(m[6] || 0));
    }
    if ((m = /^\[?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)? (\d{4})\]?/.exec(s)) && MON[m[1].toLowerCase()] !== undefined)
      return Date.UTC(+m[7], MON[m[1].toLowerCase()], +m[2], +m[3], +m[4], +m[5]) + frac(m[6]);
    if (/^\d{13}(\.\d+)?$/.test(s)) return Math.floor(+s);
    if (/^\d{10}(\.\d+)?$/.test(s)) return Math.round(+s * 1000);
    return null;
  }

  var RX = {
    ERROR: /\b(ERROR|ERR|FATAL|EXCEPTION|CRITICAL|CRIT|SEVERE|EMERG|EMERGENCY|ALERT|PANIC)\b/i,
    WARN: /\b(WARN|WARNING)\b/i, INFO: /\b(INFO|NOTICE)\b/i, DEBUG: /\b(DEBUG|TRACE|VERBOSE)\b/i
  };
  function levelOf(text) { for (var k in RX) if (RX[k].test(text)) return k; return null; }
  function levelWord(v) {
    if (v == null) return null;
    if (typeof v === 'number' || /^\d+$/.test(String(v))) { var n = +v; return n >= 50 ? 'ERROR' : n >= 40 ? 'WARN' : n >= 30 ? 'INFO' : 'DEBUG'; }
    var w = String(v).toLowerCase();
    if (/^(error|err|fatal|critical|crit|emerg|emergency|alert|panic|severe|e|f)$/.test(w)) return 'ERROR';
    if (/^(warn|warning|w)$/.test(w)) return 'WARN';
    if (/^(info|information|informational|notice|i|n)$/.test(w)) return 'INFO';
    if (/^(debug|trace|verbose|d|t|v)$/.test(w)) return 'DEBUG';
    return null;
  }
  function flatFields(o, prefix, out) {
    Object.keys(o).forEach(function (k) {
      var v = o[k], key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatFields(v, key, out);
      else out[key] = v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
    return out;
  }
  var ACCESS = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([A-Z]+) (\S+)(?: (\S+))?" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;
  var SYSLOG = /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) ([^:\[\s]+)(?:\[(\d+)\])?: ?(.*)$/;
  var SYSLOG5424 = /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[[^\]]*\])+) ?(.*)$/;
  var WINDOWS = /^(Information|Warning|Error|Critical|Verbose|Audit Success|Audit Failure)\t([^\t]+)\t([^\t]*)\t(\d+)\t([^\t]*)\t?([\s\S]*)$/;
  function sevLevel(pri) { var s = +pri % 8; return s <= 3 ? 'ERROR' : s === 4 ? 'WARN' : s <= 6 ? 'INFO' : 'DEBUG'; }
  function logfmt(line) {
    var out = {}, re = /([\w.@-]+)=("(?:[^"\\]|\\.)*"|\S*)/g, m, n = 0;
    while ((m = re.exec(line))) { out[m[1]] = m[2][0] === '"' ? m[2].slice(1, -1).replace(/\\(.)/g, '$1') : m[2]; n++; }
    return n ? out : null;
  }
  function detectFormat(lines) {
    var sample = lines.filter(function (l) { return l && l.trim(); }).slice(0, 50), votes = {};
    sample.forEach(function (l) {
      var f = 'plain', t = l.trim();
      if (t[0] === '{') { try { JSON.parse(t); f = 'json'; } catch (e) { /* not JSON */ } }
      if (f === 'plain') {
        if (SYSLOG5424.test(t)) f = 'syslog5424';
        else if (ACCESS.test(t)) f = 'access';
        else if (WINDOWS.test(l)) f = 'windows';
        else if (SYSLOG.test(t)) f = 'syslog';
        else { var kv = logfmt(t); if (kv && Object.keys(kv).length >= 2 && /^\s*[\w.@-]+=/.test(t)) f = 'logfmt'; }
      }
      votes[f] = (votes[f] || 0) + 1;
    });
    var best = 'plain', bn = 0;
    Object.keys(votes).forEach(function (k) { if (votes[k] > bn || (votes[k] === bn && k !== 'plain')) { best = k; bn = votes[k]; } });
    return bn >= Math.max(1, sample.length * 0.6) ? best : 'plain';
  }
  var TIME_KEYS = ['@timestamp', 'timestamp', 'time', 'ts', 'date', 'datetime', 't', 'eventTime'];
  var LEVEL_KEYS = ['level', 'lvl', 'severity', 'log.level', 'levelname', 'loglevel', 'Level'];
  var MSG_KEYS = ['message', 'msg', 'log', 'text', 'event'];
  function pick(f, keys) { for (var i = 0; i < keys.length; i++) if (f[keys[i]] !== undefined) return f[keys[i]]; return undefined; }
  var LEAD_TS = /^\[?(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}(?: [+-]\d{4})?|[A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \d{4})/;
  function parseEvent(text, format, year) {
    var first = String(text).split('\n')[0], m, f;
    if (format === 'json') {
      try {
        var o = JSON.parse(first.trim());
        f = flatFields(o, '', {});
        var tv = pick(f, TIME_KEYS);
        return { ts: tv !== undefined ? parseTime(tv, year) : null, level: levelWord(pick(f, LEVEL_KEYS)) || levelOf(first), msg: pick(f, MSG_KEYS) || first, fields: f };
      } catch (e) { /* fall through to plain */ }
    }
    if (format === 'logfmt' && (f = logfmt(first))) {
      var tl = pick(f, TIME_KEYS);
      return { ts: tl !== undefined ? parseTime(tl, year) : null, level: levelWord(pick(f, LEVEL_KEYS)) || levelOf(first), msg: f.msg || f.message || first, fields: f };
    }
    if (format === 'access' && (m = ACCESS.exec(first))) {
      var st = +m[8];
      return { ts: parseTime(m[4], year), level: st >= 500 ? 'ERROR' : st >= 400 ? 'WARN' : 'INFO', msg: m[5] + ' ' + m[6] + ' ' + m[8],
        fields: { ip: m[1], user: m[3], time: m[4], method: m[5], path: m[6], protocol: m[7] || '', status: m[8], bytes: m[9], referer: m[10] || '', agent: m[11] || '' } };
    }
    if (format === 'syslog5424' && (m = SYSLOG5424.exec(first))) {
      return { ts: parseTime(m[2], year), level: sevLevel(m[1]), msg: m[8], fields: { severity: String(+m[1] % 8), facility: String(Math.floor(+m[1] / 8)), host: m[3], app: m[4], pid: m[5], msgid: m[6], structured: m[7] } };
    }
    if ((format === 'syslog' || format === 'syslog5424') && (m = SYSLOG.exec(first))) {
      return { ts: parseTime(m[2], year), level: m[1] ? sevLevel(m[1]) : levelOf(m[6]), msg: m[6], fields: { host: m[3], app: m[4], pid: m[5] || '', message: m[6] } };
    }
    if (format === 'windows' && (m = WINDOWS.exec(text))) {
      var lv = { Information: 'INFO', Warning: 'WARN', Error: 'ERROR', Critical: 'ERROR', Verbose: 'DEBUG', 'Audit Success': 'INFO', 'Audit Failure': 'WARN' }[m[1]];
      return { ts: parseTime(m[2], year), level: lv, msg: m[6], fields: { level: m[1], time: m[2], source: m[3], eventId: m[4], category: m[5], message: m[6] } };
    }
    var lt = LEAD_TS.exec(first);
    return { ts: lt ? parseTime(lt[1], year) : null, level: levelOf(first), msg: first, fields: {} };
  }

  var TS_START = /^\s*(\[?\d{4}-\d{2}-\d{2}[T ]|\[?\d{1,2}\/\w{3}\/\d{4}|[A-Z][a-z]{2}\s+\d{1,2} \d\d:\d\d|\d{1,3}(\.\d{1,3}){3}\s|\{\s*"|<\d{1,3}>)/;
  function isContinuation(line) {
    if (TS_START.test(line)) return false;
    return /^\s+\S/.test(line) || /^(at |Caused by:|Suppressed:|\.\.\. \d+ (more|common frames omitted)|Traceback \(most recent call last\))/.test(line)
      || /^([\w$]+\.)+[\w$]*(Exception|Error|Throwable)\b/.test(line) || /^[A-Z]\w*(Error|Exception|Warning)(:|$)/.test(line);
  }
  function splitEvents(text) {
    var lines = String(text).split(/\r\n|\n|\r/), out = [], last = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l.trim()) continue;
      if (last && isContinuation(l)) { last.text += '\n' + l; continue; }
      last = { line: i + 1, text: l }; out.push(last);
    }
    return out;
  }

  var STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600, 2592000, 7776000, 31536000].map(function (s) { return s * 1000; });
  function histogram(ts, levels, maxBuckets) {
    var min = Infinity, max = -Infinity, untimed = 0;
    for (var i = 0; i < ts.length; i++) { var t = ts[i]; if (t == null || isNaN(t)) { untimed++; continue; } if (t < min) min = t; if (t > max) max = t; }
    if (min === Infinity) return { start: null, step: null, counts: [], untimed: untimed };
    var span = max - min, step = STEPS[STEPS.length - 1];
    for (var k = 0; k < STEPS.length; k++) if (span / STEPS[k] < (maxBuckets || 60)) { step = STEPS[k]; break; }
    var start = Math.floor(min / step) * step, n = Math.floor((max - start) / step) + 1, counts = [];
    for (var b = 0; b < n; b++) counts.push({ ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, OTHER: 0 });
    for (var j = 0; j < ts.length; j++) {
      var tt = ts[j]; if (tt == null || isNaN(tt)) continue;
      var lv = levels[j]; counts[Math.floor((tt - start) / step)][lv && counts[0][lv] !== undefined ? lv : 'OTHER']++;
    }
    return { start: start, step: step, counts: counts, untimed: untimed };
  }
  function mergeByTime(streams) {
    var pos = streams.map(function () { return 0; }), lastTs = streams.map(function () { return -Infinity; }), out = [];
    for (;;) {
      var best = -1, bestT = Infinity;
      for (var s = 0; s < streams.length; s++) {
        if (pos[s] >= streams[s].length) continue;
        var e = streams[s][pos[s]], eff = e.ts == null ? lastTs[s] : e.ts;
        if (best < 0 || eff < bestT) { best = s; bestT = eff; }
      }
      if (best < 0) return out;
      var ev = streams[best][pos[best]++];
      if (ev.ts != null) lastTs[best] = ev.ts;
      out.push(ev);
    }
  }
  return { parseTime: parseTime, detectFormat: detectFormat, parseEvent: parseEvent, levelOf: levelOf, levelWord: levelWord, splitEvents: splitEvents, isContinuation: isContinuation, histogram: histogram, mergeByTime: mergeByTime };
});
