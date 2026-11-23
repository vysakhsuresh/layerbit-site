/* Layerbit CSV engine: the one CSV reader and writer every tool uses.
 * Pure functions, no DOM. Browser (window.LBCsv) and Node (module.exports).
 *
 * Reading follows what Excel does with real-world files:
 *  - a quote opens a quoted field only at the start of a field; anywhere
 *    else it is a literal character, so `1,5" screen,1.50` is three cells;
 *  - inside quotes, "" is a quote, and delimiters and newlines are data;
 *  - CRLF, LF and bare CR all end a record; a leading BOM is skipped;
 *  - the delimiter (comma, semicolon, tab or pipe) is detected from the
 *    first records, counting only delimiters outside quotes;
 *  - in a single-column file an empty line is an empty value, not a gap;
 *    in a wider file a blank line is skipped;
 *  - records whose column count differs from the header, and a quote that
 *    is never closed, are reported in `issues` with their line number.
 *
 * parse(text, {delimiter})  -> {rows, delimiter, issues:[{line, message, expected?, got?}]}
 * parseRows(text, delim)    -> rows (string[][])
 * detectDelimiter(text)     -> ',' | ';' | '\t' | '|'
 * uniqueHeaders(header)     -> names with repeats renamed "amount (2)", blanks "(column 4)"
 * stringify(rows, {delimiter, newline, safe}) and cell(value, opts) for writing;
 *   safe: true prefixes values a spreadsheet would run as a formula with '
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBCsv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CANDIDATES = [',', ';', '\t', '|'];

  function normDelim(d) { return d === '\\t' || d === 'tab' ? '\t' : d; }

  // Counts each candidate outside quotes, record by record, over the first
  // 20 non-blank records, using the same quote rule as the parser. The
  // delimiter is the one whose count is highest and most consistent.
  function detectDelimiter(text) {
    text = String(text || '');
    var counts = {}, recs = 0, i = text.charCodeAt(0) === 0xFEFF ? 1 : 0, n = text.length;
    CANDIDATES.forEach(function (d) { counts[d] = [0]; });
    var q = false, atStart = true, blank = true;
    for (; i < n && recs < 20; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') i++; else q = false; } continue; }
      if (ch === '"' && atStart) { q = true; atStart = false; blank = false; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (!blank) { recs++; CANDIDATES.forEach(function (d) { counts[d].push(0); }); }
        atStart = true; blank = true; continue;
      }
      if (counts[ch]) { counts[ch][counts[ch].length - 1]++; atStart = true; blank = false; continue; }
      if (ch !== ' ' && ch !== '\t') blank = false;
      atStart = false;
    }
    if (!blank) recs++; else CANDIDATES.forEach(function (d) { counts[d].pop(); });
    var best = ',', bestScore = 0;
    CANDIDATES.forEach(function (d) {
      var c = counts[d].slice(0, Math.max(recs, 1));
      var mean = c.reduce(function (a, b) { return a + b; }, 0) / (c.length || 1);
      if (!mean) return;
      var variance = c.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / c.length;
      var score = mean / (1 + variance);
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function parse(text, opts) {
    text = String(text == null ? '' : text);
    var delim = normDelim(opts && opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : detectDelimiter(text));
    var recs = [], row = [], cell = '', i = text.charCodeAt(0) === 0xFEFF ? 1 : 0, n = text.length;
    var q = false, atStart = true, line = 1, recLine = 1, quoteLine = 0, issues = [];
    function endRecord() { row.push(cell); recs.push({ cells: row, line: recLine }); row = []; cell = ''; atStart = true; }
    for (; i < n; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else { if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++; cell += ch; }
        continue;
      }
      if (ch === '"' && atStart) { q = true; atStart = false; quoteLine = line; continue; }
      if (ch === delim) { row.push(cell); cell = ''; atStart = true; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        endRecord(); line++; recLine = line; continue;
      }
      cell += ch; atStart = false;
    }
    if (q) issues.push({ line: quoteLine, message: 'A quote opened on line ' + quoteLine + ' is never closed, so the rest of the file is read as one value.' });
    if (cell !== '' || row.length || q) endRecord();
    // blank records: skipped, except as values in a single-column file
    var isBlank = function (r) { return r.cells.length === 1 && r.cells[0].trim() === ''; };
    var first = 0; while (first < recs.length && isBlank(recs[first])) first++;
    recs = recs.slice(first);
    var width = recs.length ? recs[0].cells.length : 0;
    if (width > 1) recs = recs.filter(function (r) { return !isBlank(r); });
    else { var last = recs.length; while (last > 1 && isBlank(recs[last - 1])) last--; recs = recs.slice(0, last); }
    recs.forEach(function (r, k) {
      if (k && r.cells.length !== width) issues.push({ line: r.line, expected: width, got: r.cells.length, message: 'Line ' + r.line + ' has ' + r.cells.length + ' value' + (r.cells.length === 1 ? '' : 's') + ' where the header has ' + width + '.' });
    });
    issues.sort(function (a, b) { return a.line - b.line; });
    return { rows: recs.map(function (r) { return r.cells; }), delimiter: delim, issues: issues };
  }
  function parseRows(text, delim) { return parse(text, { delimiter: delim }).rows; }

  function uniqueHeaders(hdr) {
    var taken = {}, used = {}, out = [];
    hdr.forEach(function (h) { h = String(h == null ? '' : h); if (h) taken[h] = true; });
    hdr.forEach(function (h, i) {
      h = String(h == null ? '' : h);
      var name = h || '(column ' + (i + 1) + ')';
      if (used[name]) { var k = 2; while (used[h + ' (' + k + ')'] || taken[h + ' (' + k + ')']) k++; name = h + ' (' + k + ')'; }
      used[name] = true; out.push(name);
    });
    return out;
  }

  // A value a spreadsheet would evaluate: =, @, tab or CR first, or + / -
  // followed by something that is not a plain number (so -5 and +3.2 stay).
  function isFormulaLike(s) { return /^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?(\d[\d,]*)?(\.\d+)?([eE][+-]?\d+)?$/.test(s)); }
  function cell(v, opts) {
    var d = normDelim(opts && opts.delimiter) || ',';
    var s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (opts && opts.safe && isFormulaLike(s)) s = "'" + s;
    return s.indexOf('"') >= 0 || s.indexOf(d) >= 0 || /[\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function line(cells, opts) { var d = normDelim(opts && opts.delimiter) || ','; return cells.map(function (c) { return cell(c, opts); }).join(d) + ((opts && opts.newline) || '\r\n'); }
  function stringify(rows, opts) { return rows.map(function (r) { return line(r, opts); }).join(''); }

  return { parse: parse, parseRows: parseRows, detectDelimiter: detectDelimiter, uniqueHeaders: uniqueHeaders, cell: cell, line: line, stringify: stringify, isFormulaLike: isFormulaLike };
});
