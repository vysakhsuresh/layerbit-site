/* Layerbit tabular engine: the conversions between rows and records that
 * CSV <-> JSON uses in the page and in its Worker. Pure functions, no DOM.
 * Browser / Worker (self.LBTable) and Node (module.exports).
 *
 * nest(record, sep='.')        -> {value, conflicts}: "user.name" -> {user: {name}},
 *     "tags.0", "tags.1" -> tags: [..]; a key that is both a value and a
 *     parent ("a" and "a.b") is kept flat and listed in conflicts
 * flatten(value, sep='.')      -> {"user.name": .., "tags.0": ..}; nest(flatten(x)) is x
 * parseJSONL(text)             -> {records, errors: [{line, message}]}
 * toJSONL(records)             -> one compact record per line
 * detectJSON(text)             -> 'json' | 'jsonl'
 * unionKeys(records)           -> every key, first-seen order
 * planFor(headers, prev) / togglePlan / renamePlan / movePlan / applyPlan
 *     a column plan: which columns, under which names, in which order
 * recordConverter(header, {infer, types, nest, plan, sep}) -> {convert(row), names, conflicts}
 * jsonWriter('json' | 'jsonl') -> {begin(), record(r, i), end(count)}: the
 *     same text as a pretty-printed array, written one record at a time
 * table(records, {flatten, plan, sep}) -> {keys, names, rows} for CSV/xlsx out
 * cellText(v) / csvRow(values, safe) -> one CSV line (no newline), the escape
 *     rule of js/engines/csv.js; safe guards spreadsheet formulas
 * parseFilter(text) -> predicate(value): ">9", "<=1e3", "=exact", "!=x",
 *     "!text" (does not contain), "empty", "!empty", else contains (case-
 *     insensitive); numbers (lossless too) are compared by value
 * sortRows(rows, col, dir) -> new array: numbers by value, text naturally,
 *     blanks last in both directions
 * groupBy(rows, keyCol, valueCol) -> [{key, count, sum, avg, min, max}]
 * csvReader({delimiter}) -> {push(text), end(), issues, delimiter}: the
 *     shared CSV rules (js/engines/csv.js) over text that arrives in slices
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./csv.js'), require('./lossless-json.js'));
  else root.LBTable = factory(root.LBCsv, root.LBLossless);
})(typeof self !== 'undefined' ? self : this, function (C, L) {
  'use strict';
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function setKey(o, k, v) {
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    else o[k] = v;
  }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !L.isLosslessNumber(v); }

  // ---- nesting
  function nest(rec, sep) {
    sep = sep || '.';
    var keys = Object.keys(rec), present = {}, conflicts = [];
    keys.forEach(function (k) { present['$' + k] = true; });
    var out = {};
    keys.forEach(function (k) {
      var parts = k.split(sep);
      var ok = parts.length > 1 && parts.every(function (p) { return p !== ''; });
      if (ok) for (var i = 1; i < parts.length; i++) if (present['$' + parts.slice(0, i).join(sep)]) { ok = false; conflicts.push(k); break; }
      if (!ok) { setKey(out, k, rec[k]); return; }
      var node = out;
      for (var j = 0; j < parts.length - 1; j++) {
        if (!has(node, parts[j]) || !isPlainObject(node[parts[j]])) setKey(node, parts[j], {});
        node = node[parts[j]];
      }
      setKey(node, parts[parts.length - 1], rec[k]);
    });
    return { value: arrays(out), conflicts: conflicts };
  }
  // objects whose keys are exactly 0..n-1 become arrays
  function arrays(v) {
    if (!isPlainObject(v)) return v;
    var keys = Object.keys(v);
    keys.forEach(function (k) { v[k] = arrays(v[k]); });
    if (keys.length && keys.every(function (k) { return /^(0|[1-9]\d*)$/.test(k) && +k < keys.length; })) {
      var a = new Array(keys.length);
      keys.forEach(function (k) { a[+k] = v[k]; });
      return a;
    }
    return v;
  }
  function flatten(value, sep, prefix, out) {
    sep = sep || '.'; out = out || {};
    var walk = function (v, p) {
      if (Array.isArray(v)) {
        if (!v.length && p !== '') { setKey(out, p, []); return; }
        v.forEach(function (x, i) { walk(x, p === '' ? String(i) : p + sep + i); });
      } else if (isPlainObject(v)) {
        var ks = Object.keys(v);
        if (!ks.length && p !== '') { setKey(out, p, {}); return; }
        ks.forEach(function (k) { walk(v[k], p === '' ? k : p + sep + k); });
      } else setKey(out, p, v);
    };
    walk(value, prefix || '');
    return out;
  }

  // ---- JSON Lines
  function parseJSONL(text) {
    var lines = String(text).split(/\r\n|\n|\r/), records = [], errors = [];
    lines.forEach(function (ln, i) {
      if (!ln.trim()) return;
      try { JSON.parse(ln); records.push(L.parse(ln)); }
      catch (e) { errors.push({ line: i + 1, message: 'Line ' + (i + 1) + ': ' + String(e.message).replace(/^JSON\.parse: /, '') }); }
    });
    return { records: records, errors: errors };
  }
  function toJSONL(records) { return records.map(function (r) { return L.stringify(r); }).join('\n') + (records.length ? '\n' : ''); }
  function detectJSON(text) {
    text = String(text);
    try { JSON.parse(text); return 'json'; } catch (e) { /* not one document */ }
    var lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return 'json';
    for (var i = 0; i < lines.length; i++) { try { JSON.parse(lines[i]); } catch (e) { return 'json'; } }
    return 'jsonl';
  }
  function unionKeys(records) {
    var seen = {}, out = [];
    records.forEach(function (r) { if (isPlainObject(r)) Object.keys(r).forEach(function (k) { if (!seen['$' + k]) { seen['$' + k] = true; out.push(k); } }); });
    return out;
  }

  // ---- column plans: [{key, name, include}] in output order
  function planFor(headers, prev) {
    var want = {}, out = [];
    headers.forEach(function (h) { want['$' + h] = true; });
    (prev || []).forEach(function (p) { if (want['$' + p.key]) { out.push({ key: p.key, name: p.name, include: p.include }); want['$' + p.key] = false; } });
    headers.forEach(function (h) { if (want['$' + h]) out.push({ key: h, name: h, include: true }); });
    return out;
  }
  function mapPlan(plan, key, f) { return plan.map(function (p) { return p.key === key ? f({ key: p.key, name: p.name, include: p.include }) : p; }); }
  function togglePlan(plan, key, include) { return mapPlan(plan, key, function (p) { p.include = include; return p; }); }
  function renamePlan(plan, key, name) { return mapPlan(plan, key, function (p) { p.name = String(name == null ? '' : name).trim() || p.key; return p; }); }
  function movePlan(plan, key, delta) {
    var out = plan.slice(), i = out.findIndex(function (p) { return p.key === key; }), j = Math.max(0, Math.min(out.length - 1, i + delta));
    if (i < 0 || i === j) return out;
    var item = out.splice(i, 1)[0]; out.splice(j, 0, item);
    return out;
  }
  function applyPlan(headers, plan) {
    var pos = {}, names = [], index = [];
    headers.forEach(function (h, i) { pos['$' + h] = i; });
    planFor(headers, plan).forEach(function (p) { if (p.include) { names.push(p.name); index.push(pos['$' + p.key]); } });
    return { names: C.uniqueHeaders(names), index: index };
  }

  // ---- CSV rows -> records
  function cellValue(val, type, infer) {
    if (type === 'text') return val;
    if (type === 'number') {
      var m = /^([+-]?)0*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.exec(val.replace(/^\+/, ''));
      return m ? new L.LosslessNumber((m[1] === '-' ? '-' : '') + m[2]) : val;
    }
    if (type === 'boolean') {
      var l = val.toLowerCase();
      return ['true', 'yes', 'y', '1'].indexOf(l) >= 0 ? true : ['false', 'no', 'n', '0'].indexOf(l) >= 0 ? false : val;
    }
    return infer ? L.inferValue(val) : val;
  }
  function recordConverter(headerRow, o) {
    o = o || {};
    var headers = C.uniqueHeaders(headerRow.map(function (h) { return String(h).trim(); }));
    var p = applyPlan(headers, o.plan), types = o.types || {}, conflicts = {};
    return {
      headers: headers, names: p.names, index: p.index, conflicts: conflicts,
      convert: function (row) {
        var obj = {};
        for (var j = 0; j < p.index.length; j++) {
          var src = p.index[j], raw = row[src] !== undefined ? String(row[src]).trim() : '';
          setKey(obj, p.names[j], cellValue(raw, types[headers[src]] || 'auto', o.infer !== false));
        }
        if (!o.nest) return obj;
        var r = nest(obj, o.sep);
        r.conflicts.forEach(function (k) { conflicts[k] = true; });
        return r.value;
      }
    };
  }
  function jsonWriter(kind) {
    if (kind === 'jsonl') return { begin: function () { return ''; }, record: function (r) { return L.stringify(r) + '\n'; }, end: function () { return ''; } };
    return {
      begin: function () { return ''; },
      record: function (r, i) { return (i ? ',\n    ' : '[\n    ') + L.stringify(r, 4).replace(/\n/g, '\n    '); },
      end: function (n) { return n ? '\n]' : '[]'; }
    };
  }

  // ---- records -> table (JSON -> CSV / xlsx)
  function table(records, o) {
    o = o || {};
    var recs = o.flatten ? records.map(function (r) { return isPlainObject(r) ? flatten(r, o.sep) : r; }) : records;
    var keys = unionKeys(recs), p = applyPlan(keys, o.plan);
    return {
      keys: keys, names: p.names, index: p.index,
      rows: recs.map(function (r) { return p.index.map(function (i) { return r[keys[i]]; }); })
    };
  }

  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (L.isLosslessNumber(v)) return v.value;
    if (typeof v === 'object') return L.stringify(v);
    return String(v);
  }
  function csvRow(values, safe) { return values.map(function (v) { return C.cell(cellText(v), { safe: !!safe }); }).join(','); }


  // ---- JSON to Table: filters, sorting, grouping
  function asNumber(v) {
    if (L.isLosslessNumber(v)) return Number(v.value);
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
    return null;
  }
  function numText(v) { return L.isLosslessNumber(v) ? v.value : typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : null; }
  // compares two number spellings exactly when both are integers (beyond 2^53 too)
  function cmpNum(a, b) {
    var ta = numText(a), tb = numText(b);
    if (ta !== null && tb !== null && /^-?\d+$/.test(ta) && /^-?\d+$/.test(tb) && typeof BigInt === 'function') { var x = BigInt(ta), y = BigInt(tb); return x < y ? -1 : x > y ? 1 : 0; }
    var p = asNumber(a), q = asNumber(b);
    return p < q ? -1 : p > q ? 1 : 0;
  }
  function parseFilter(text) {
    var q = String(text == null ? '' : text).trim();
    if (!q) return function () { return true; };
    var low = q.toLowerCase();
    if (low === 'empty') return function (v) { return v === null || v === undefined || cellText(v) === ''; };
    if (low === '!empty') return function (v) { return !(v === null || v === undefined || cellText(v) === ''); };
    var m = /^(>=|<=|!=|>|<|=)\s*(.*)$/.exec(q);
    if (m) {
      var op = m[1], rhs = m[2], rn = asNumber(rhs);
      if (op === '=' || op === '!=') {
        var eq = function (v) { return rn !== null && asNumber(v) !== null ? cmpNum(v, rhs) === 0 : cellText(v).toLowerCase() === rhs.toLowerCase(); };
        return op === '=' ? eq : function (v) { return !eq(v); };
      }
      if (rn === null) return function (v) { var t = cellText(v).toLowerCase(), r = rhs.toLowerCase(); return op === '>' ? t > r : op === '<' ? t < r : op === '>=' ? t >= r : t <= r; };
      return function (v) {
        if (asNumber(v) === null) return false;
        var c = cmpNum(v, rhs);
        return op === '>' ? c > 0 : op === '<' ? c < 0 : op === '>=' ? c >= 0 : c <= 0;
      };
    }
    if (q[0] === '!' && q.length > 1) { var neg = low.slice(1); return function (v) { return cellText(v).toLowerCase().indexOf(neg) < 0; }; }
    return function (v) { return cellText(v).toLowerCase().indexOf(low) >= 0; };
  }
  var collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
  function sortRows(rows, col, dir) {
    var blank = function (v) { return v === null || v === undefined || cellText(v) === ''; };
    var numeric = rows.every(function (r) { return blank(r[col]) || asNumber(r[col]) !== null; });
    return rows.slice().sort(function (a, b) {
      var x = a[col], y = b[col], xe = blank(x), ye = blank(y);
      if (xe && ye) return 0; if (xe) return 1; if (ye) return -1;
      var c = numeric ? cmpNum(x, y) : collator ? collator.compare(cellText(x), cellText(y)) : (cellText(x) < cellText(y) ? -1 : cellText(x) > cellText(y) ? 1 : 0);
      return c * dir;
    });
  }
  function groupBy(rows, keyCol, valCol) {
    var order = [], groups = {};
    rows.forEach(function (r) {
      var k = cellText(r[keyCol]); if (k === '') k = '(empty)';
      var g = groups['$' + k];
      if (!g) { g = groups['$' + k] = { key: k, count: 0, sum: null, n: 0, min: null, max: null }; order.push(g); }
      g.count++;
      if (valCol >= 0) { var x = asNumber(r[valCol]); if (x !== null && isFinite(x)) { g.sum = (g.sum || 0) + x; g.n++; g.min = g.min === null ? x : Math.min(g.min, x); g.max = g.max === null ? x : Math.max(g.max, x); } }
    });
    return order.map(function (g) { return { key: g.key, count: g.count, sum: g.sum, avg: g.n ? g.sum / g.n : null, min: g.min, max: g.max }; });
  }

  // ---- streaming CSV reader (the rules of LBCsv.parse, fed in slices)
  function csvReader(opts) {
    opts = opts || {};
    var given = opts.delimiter && opts.delimiter !== 'auto' ? (opts.delimiter === '\\t' || opts.delimiter === 'tab' ? '\t' : opts.delimiter) : null;
    var self = { delimiter: given, issues: [] }, buf = '';
    var q = false, atStart = true, cell = '', row = [], line = 1, recLine = 1, quoteLine = 0;
    var skipLF = false, prevCR = false, pendQ = false, started = false;
    var header = null, width = 0, pendingBlank = [], outRows = [], outHeader = null;
    function isBlank(cells) { return cells.length === 1 && cells[0].trim() === ''; }
    function accept(cells, ln) {
      if (header === null) {
        if (isBlank(cells)) return;
        header = cells; width = cells.length; outHeader = cells; return;
      }
      if (width > 1 && isBlank(cells)) return;
      if (width === 1 && isBlank(cells)) { pendingBlank.push([cells, ln]); return; }
      if (pendingBlank.length) { pendingBlank.forEach(function (b) { outRows.push(b[0]); }); pendingBlank = []; }
      if (cells.length !== width) self.issues.push({ line: ln, expected: width, got: cells.length, message: 'Line ' + ln + ' has ' + cells.length + ' value' + (cells.length === 1 ? '' : 's') + ' where the header has ' + width + '.' });
      outRows.push(cells);
    }
    function endRecord() { row.push(cell); accept(row, recLine); row = []; cell = ''; atStart = true; }
    function feed(s) {
      var i = 0, n = s.length, d = self.delimiter;
      if (!started) { started = true; if (s.charCodeAt(0) === 0xFEFF) i = 1; }
      for (; i < n; i++) {
        var ch = s[i];
        if (skipLF) { skipLF = false; if (ch === '\n') continue; }
        if (pendQ) { pendQ = false; if (ch === '"') { cell += '"'; continue; } q = false; }
        if (q) {
          if (ch === '"') {
            prevCR = false;
            if (i + 1 < n) { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
            else pendQ = true;
            continue;
          }
          // a run of plain characters inside quotes, copied at once
          var k = i;
          while (k < n && s[k] !== '"' && s[k] !== '\n' && s[k] !== '\r') k++;
          if (k > i) { cell += s.slice(i, k); prevCR = false; i = k - 1; continue; }
          if (ch === '\r') { line++; prevCR = true; } else { if (!prevCR) line++; prevCR = false; }
          cell += ch;
          continue;
        }
        if (ch === '"' && atStart) { q = true; atStart = false; quoteLine = line; prevCR = false; continue; }
        if (ch === d) { row.push(cell); cell = ''; atStart = true; continue; }
        if (ch === '\n' || ch === '\r') {
          endRecord(); line++; recLine = line;
          if (ch === '\r') skipLF = true;
          continue;
        }
        // a run of plain characters outside quotes
        var e = i;
        while (e < n && s[e] !== d && s[e] !== '\n' && s[e] !== '\r') e++;
        cell += s.slice(i, e); atStart = false; i = e - 1;
      }
    }
    function take() { var r = { header: outHeader, rows: outRows }; outHeader = null; outRows = []; return r; }
    self.push = function (text) {
      if (self.delimiter) { feed(String(text)); return take(); }
      buf += String(text);
      if (buf.length >= 65536) { self.delimiter = C.detectDelimiter(buf); feed(buf); buf = ''; }
      return take();
    };
    self.end = function () {
      if (!self.delimiter) { self.delimiter = C.detectDelimiter(buf); feed(buf); buf = ''; }
      if (pendQ) { pendQ = false; q = false; }
      if (q) self.issues.push({ line: quoteLine, message: 'A quote opened on line ' + quoteLine + ' is never closed, so the rest of the file is read as one value.' });
      if (cell !== '' || row.length || q) endRecord();
      pendingBlank = [];
      self.issues.sort(function (a, b) { return a.line - b.line; });
      return take();
    };
    return self;
  }

  return {
    nest: nest, flatten: flatten, parseJSONL: parseJSONL, toJSONL: toJSONL, detectJSON: detectJSON, unionKeys: unionKeys,
    planFor: planFor, togglePlan: togglePlan, renamePlan: renamePlan, movePlan: movePlan, applyPlan: applyPlan,
    cellValue: cellValue, cellText: cellText, parseFilter: parseFilter, sortRows: sortRows, groupBy: groupBy, asNumber: asNumber, csvRow: csvRow, recordConverter: recordConverter, jsonWriter: jsonWriter, table: table, csvReader: csvReader, setKey: setKey
  };
});
