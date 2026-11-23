/* Layerbit diff engine. Pure functions over strings; no DOM.
 *
 * Runs in the browser (window.LBDiff, needs the vendored jsdiff as `Diff`)
 * and under Node for the unit tests (module.exports, requires ../vendor/diff).
 *
 * Covers: normalised line diff with intra-line word/character segments,
 * syntax token ranges merged with change ranges, unified patch export and
 * apply, three-way merge (diff3 with conflict markers), structural diff of
 * parsed JSON/YAML, keyed table diff for CSV, a CSV parser, and a zip
 * directory reader built on DecompressionStream.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../vendor/diff.min.js'));
  else root.LBDiff = factory(root.Diff);
})(typeof self !== 'undefined' ? self : this, function (Diff) {
  'use strict';

  // ------------------------------------------------------------ normalisation
  var DEFAULT_OPTS = { ignoreWhitespace: false, ignoreCase: false, ignoreEol: true, trimTrailing: false, ignoreBlank: false, granularity: 'word', context: 3 };

  function normalizeLine(line, o) {
    if (o.ignoreEol !== false) line = line.replace(/\r$/, '');
    if (o.trimTrailing) line = line.replace(/[ \t]+$/, '');
    if (o.ignoreWhitespace) line = line.replace(/\s+/g, ' ').trim();
    if (o.ignoreCase) line = line.toLowerCase();
    return line;
  }
  function splitLines(text) {
    if (text === '') return [];
    var lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /** Line-ending style and whether the text ends with a newline. */
  function textFacts(text) {
    var crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/\n/g) || []).length - crlf, cr = (text.match(/\r(?!\n)/g) || []).length;
    var kinds = (crlf ? 1 : 0) + (lf ? 1 : 0) + (cr ? 1 : 0);
    return { eol: kinds > 1 ? 'mixed' : crlf ? 'CRLF' : lf ? 'LF' : cr ? 'CR' : 'none', finalNewline: /[\r\n]$/.test(text) };
  }
  var EOL_NAME = { CRLF: 'CRLF (Windows)', LF: 'LF (Unix and macOS)', CR: 'CR (classic Mac)', mixed: 'a mix of line endings' };
  /** Differences a line comparison hides: line endings and the final newline. */
  function textNotes(a, b) {
    var fa = textFacts(a), fb = textFacts(b), out = [];
    if (fa.eol !== fb.eol && fa.eol !== 'none' && fb.eol !== 'none') out.push('Line endings differ: the original uses ' + EOL_NAME[fa.eol] + ', the modified file uses ' + EOL_NAME[fb.eol] + '.');
    else if (fa.eol === 'mixed' || fb.eol === 'mixed') out.push('The ' + (fa.eol === 'mixed' ? 'original' : 'modified file') + ' mixes line-ending styles.');
    if (a && b && fa.finalNewline !== fb.finalNewline) out.push('No newline at end of file in the ' + (fa.finalNewline ? 'modified file' : 'original') + '.');
    return out;
  }

  // ------------------------------------------------------------ alignment
  // Linear-space Myers diff (the "middle snake" bisection used by
  // diff-match-patch) over integer line ids. jsdiff 5.1's diffArrays copies
  // its paths and took minutes on two similar 20,000-line files; this runs in
  // O((N+M)D) time and O(N+M) memory. `budget` caps the inner-loop work: when
  // it runs out the caller reports the files as too different to align.
  function TooDifferent() { this.tooDifferent = true; }
  function alignIds(A, B, budget) {
    var work = 0, pairs = [];
    function rec(a0, a1, b0, b1) {
      while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { pairs.push(a0, b0); a0++; b0++; }
      var e0 = a1, e1 = b1;
      while (e0 > a0 && e1 > b0 && A[e0 - 1] === B[e1 - 1]) { e0--; e1--; }
      if (a0 < e0 && b0 < e1) bisect(a0, e0, b0, e1);
      for (var k = 0; k < a1 - e0; k++) pairs.push(e0 + k, e1 + k);
    }
    function bisect(a0, a1, b0, b1) {
      var n = a1 - a0, m = b1 - b0, maxD = Math.ceil((n + m) / 2), off = maxD, len = 2 * maxD + 2;
      var v1 = new Int32Array(len).fill(-1), v2 = new Int32Array(len).fill(-1);
      v1[off + 1] = 0; v2[off + 1] = 0;
      var delta = n - m, front = (delta & 1) !== 0, k1s = 0, k1e = 0, k2s = 0, k2e = 0;
      for (var d = 0; d < maxD; d++) {
        for (var k1 = -d + k1s; k1 <= d - k1e; k1 += 2) {
          var i1 = off + k1, x1 = (k1 === -d || (k1 !== d && v1[i1 - 1] < v1[i1 + 1])) ? v1[i1 + 1] : v1[i1 - 1] + 1, y1 = x1 - k1, s1 = x1;
          while (x1 < n && y1 < m && A[a0 + x1] === B[b0 + y1]) { x1++; y1++; }
          v1[i1] = x1; work += 1 + x1 - s1;
          if (x1 > n) k1e += 2; else if (y1 > m) k1s += 2;
          else if (front) { var j2 = off + delta - k1; if (j2 >= 0 && j2 < len && v2[j2] !== -1 && x1 >= n - v2[j2]) return split(a0, a1, b0, b1, x1, y1); }
        }
        for (var k2 = -d + k2s; k2 <= d - k2e; k2 += 2) {
          var i2 = off + k2, x2 = (k2 === -d || (k2 !== d && v2[i2 - 1] < v2[i2 + 1])) ? v2[i2 + 1] : v2[i2 - 1] + 1, y2 = x2 - k2, s2 = x2;
          while (x2 < n && y2 < m && A[a1 - x2 - 1] === B[b1 - y2 - 1]) { x2++; y2++; }
          v2[i2] = x2; work += 1 + x2 - s2;
          if (x2 > n) k2e += 2; else if (y2 > m) k2s += 2;
          else if (!front) { var j1 = off + delta - k2; if (j1 >= 0 && j1 < len && v1[j1] !== -1) { var xx = v1[j1], yy = off + xx - j1; if (xx >= n - x2) return split(a0, a1, b0, b1, xx, yy); } }
        }
        if (work > budget) throw new TooDifferent();
      }
      // no common line at all: nothing to pair in this range
    }
    function split(a0, a1, b0, b1, x, y) { rec(a0, a0 + x, b0, b0 + y); rec(a0 + x, a1, b0 + y, b1); }
    rec(0, A.length, 0, B.length);
    return pairs;
  }
  /** jsdiff-style parts ({value, added, removed}) from aligned line keys. */
  function alignParts(ka, kb, budget) {
    var ids = Object.create(null), next = 0, A = new Int32Array(ka.length), B = new Int32Array(kb.length), i;
    for (i = 0; i < ka.length; i++) { var x = ka[i]; A[i] = x in ids ? ids[x] : (ids[x] = next++); }
    for (i = 0; i < kb.length; i++) { var y = kb[i]; B[i] = y in ids ? ids[y] : (ids[y] = next++); }
    var pairs = alignIds(A, B, budget), runs = [], ai = 0, bi = 0;
    // collect [kind, from, to] runs first and slice once: growing arrays one
    // matched line at a time would be quadratic on long equal stretches
    function push(kind, from, to, src) { if (to <= from) return; var last = runs[runs.length - 1]; if (last && last.kind === kind && last.to === from) last.to = to; else runs.push({ kind: kind, from: from, to: to, src: src }); }
    for (i = 0; i < pairs.length; i += 2) { push('d', ai, pairs[i], ka); push('i', bi, pairs[i + 1], kb); push('e', pairs[i], pairs[i] + 1, ka); ai = pairs[i] + 1; bi = pairs[i + 1] + 1; }
    push('d', ai, ka.length, ka); push('i', bi, kb.length, kb);
    return runs.map(function (r) { return { kind: r.kind, value: r.src.slice(r.from, r.to), added: r.kind === 'i', removed: r.kind === 'd' }; });
  }
  /** Counts for a pair of files too different to align: lines only on one
   *  side and lines in common, compared as multisets of normalised lines. */
  function lineSummary(ka, kb) {
    var count = Object.create(null), common = 0;
    ka.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
    kb.forEach(function (k) { if (count[k] > 0) { count[k]--; common++; } });
    return { linesA: ka.length, linesB: kb.length, onlyA: ka.length - common, onlyB: kb.length - common, common: common };
  }

  // ----------------------------------------------------------------- line diff
  /** Returns rows for split and unified rendering.
   *  row: {type:'eq'|'del'|'ins'|'mod', l:{n,text,segs}|null, r:{n,text,segs}|null}
   *  segs: [{t:text, c:'eq'|'del'|'ins'}] intra-line for 'mod' rows. */
  function lineDiff(a, b, opts) {
    var o = Object.assign({}, DEFAULT_OPTS, opts || {});
    var la = splitLines(a), lb = splitLines(b);
    var ka = la.map(function (l) { return normalizeLine(l, o); });
    var kb = lb.map(function (l) { return normalizeLine(l, o); });
    // Ignore blank lines: blank lines take no part in the alignment at all.
    // They are put back afterwards as 'blank' rows, which are never changes.
    var full = null;
    if (o.ignoreBlank) {
      var keepA = [], keepB = [];
      ka.forEach(function (l, i) { if (l.trim() !== '') keepA.push(i); });
      kb.forEach(function (l, i) { if (l.trim() !== '') keepB.push(i); });
      full = { la: la, lb: lb, keepA: keepA, keepB: keepB };
      la = keepA.map(function (i) { return full.la[i]; }); lb = keepB.map(function (i) { return full.lb[i]; });
      ka = keepA.map(function (i) { return ka[i]; }); kb = keepB.map(function (i) { return kb[i]; });
    }
    var parts, report = typeof o.onProgress === 'function' ? o.onProgress : null;
    if (report) report(0, 'align');
    try { parts = alignParts(ka, kb, o.workLimit == null ? 60000000 : o.workLimit); }
    catch (e) {
      if (!(e instanceof TooDifferent)) throw e;
      return { rows: [], hunks: [], tooDifferent: true, notes: textNotes(a, b), facts: { a: textFacts(a), b: textFacts(b) }, summary: lineSummary(ka, kb), stats: { added: 0, removed: 0, modified: 0, unchanged: 0, linesA: la.length, linesB: lb.length, similarity: 0 } };
    }
    var rows = [], ai = 0, bi = 0;
    for (var i = 0; i < parts.length; i++) {
      if (report && i % 200 === 0) report(i / parts.length, 'highlight');
      var p = parts[i], next = parts[i + 1];
      if (!p.added && !p.removed) {
        for (var k = 0; k < p.value.length; k++) {
          rows.push({ type: 'eq', l: { n: ai + 1, text: la[ai] }, r: { n: bi + 1, text: lb[bi] } }); ai++; bi++;
        }
      } else if (p.removed && next && next.added) {
        // A replaced block: pair each removed line with the added line it most
        // resembles (order-preserving), so a moved-down line is not compared
        // against whatever happens to sit in the same slot.
        var plan = pairBlock(la.slice(ai, ai + p.value.length), lb.slice(bi, bi + next.value.length), ka.slice(ai, ai + p.value.length), kb.slice(bi, bi + next.value.length));
        for (var q = 0; q < plan.length; q++) {
          var step = plan[q];
          if (step === 'm') {
            var segs = intraline(la[ai], lb[bi], o.granularity);
            rows.push({ type: 'mod', l: { n: ai + 1, text: la[ai], segs: segs.a }, r: { n: bi + 1, text: lb[bi], segs: segs.b } }); ai++; bi++;
          } else if (step === 'd') { rows.push({ type: 'del', l: { n: ai + 1, text: la[ai] }, r: null }); ai++; }
          else { rows.push({ type: 'ins', l: null, r: { n: bi + 1, text: lb[bi] } }); bi++; }
        }
        i++;
      } else if (p.removed) {
        for (var k5 = 0; k5 < p.value.length; k5++) { rows.push({ type: 'del', l: { n: ai + 1, text: la[ai] }, r: null }); ai++; }
      } else {
        for (var k6 = 0; k6 < p.value.length; k6++) { rows.push({ type: 'ins', l: null, r: { n: bi + 1, text: lb[bi] } }); bi++; }
      }
    }
    if (full) { rows = withBlanks(rows, full); la = full.la; lb = full.lb; }
    return { rows: rows, hunks: hunksOf(rows), stats: statsOf(rows, la.length, lb.length), notes: textNotes(a, b), facts: { a: textFacts(a), b: textFacts(b) } };
  }

  /** Re-inserts the blank lines left out by ignoreBlank: row numbers are
   *  mapped back to the real line numbers, blank lines present at the same
   *  point on both sides pair as 'eq', and the rest become one-sided
   *  'blank' rows. */
  function withBlanks(rows, f) {
    var out = [], na = 0, nb = 0;
    function flush(toA, toB) {
      var ba = [], bb = [];
      while (na < toA) { ba.push(na); na++; }
      while (nb < toB) { bb.push(nb); nb++; }
      var m = Math.min(ba.length, bb.length), i;
      for (i = 0; i < m; i++) out.push({ type: 'eq', l: { n: ba[i] + 1, text: f.la[ba[i]] }, r: { n: bb[i] + 1, text: f.lb[bb[i]] } });
      for (i = m; i < ba.length; i++) out.push({ type: 'blank', l: { n: ba[i] + 1, text: f.la[ba[i]] }, r: null });
      for (i = m; i < bb.length; i++) out.push({ type: 'blank', l: null, r: { n: bb[i] + 1, text: f.lb[bb[i]] } });
    }
    rows.forEach(function (row) {
      var ra = row.l ? f.keepA[row.l.n - 1] : null, rb = row.r ? f.keepB[row.r.n - 1] : null;
      flush(ra == null ? na : ra, rb == null ? nb : rb);
      if (row.l) { row.l.n = ra + 1; na = ra + 1; }
      if (row.r) { row.r.n = rb + 1; nb = rb + 1; }
      out.push(row);
    });
    flush(f.la.length, f.lb.length);
    return out;
  }
  /** Character-bigram Dice similarity of two lines, 0..1 (whitespace-insensitive). */
  function lineSimilarity(x, y) {
    x = x.replace(/\s+/g, ' ').trim(); y = y.replace(/\s+/g, ' ').trim();
    if (x === y) return 1;
    if (x.length < 2 || y.length < 2) return 0;
    var grams = {}, n = 0, hit = 0, i;
    for (i = 0; i < x.length - 1; i++) { var g = x.substr(i, 2); grams[g] = (grams[g] || 0) + 1; n++; }
    for (i = 0; i < y.length - 1; i++) { var h = y.substr(i, 2); if (grams[h] > 0) { grams[h]--; hit++; } }
    return 2 * hit / (n + y.length - 1);
  }
  /** Order-preserving alignment of a removed block A against an added block B.
   *  Returns steps 'm' (pair), 'd' (removed only), 'i' (added only). Strong
   *  pairs (>= 40% alike) score fully; weak ones (>= 12%) score half, so a line
   *  rewritten in place still pairs unless a better partner exists. Blocks over
   *  400x400 fall back to slot order. */
  function pairBlock(A, B, KA, KB) {
    var na = A.length, nb = B.length, i, j, steps = [];
    var slots = function () {
      var m = Math.min(na, nb);
      for (i = 0; i < m; i++) steps.push('m');
      for (i = m; i < na; i++) steps.push('d');
      for (j = m; j < nb; j++) steps.push('i');
      return steps;
    };
    if (na * nb > 160000) return slots();
    var sim = [], dp = [];
    for (i = 0; i <= na; i++) { dp.push(new Float64Array(nb + 1)); sim.push(i < na ? new Float64Array(nb) : null); }
    for (i = 0; i < na; i++) for (j = 0; j < nb; j++) { var v = lineSimilarity(KA[i], KB[j]); sim[i][j] = v >= 0.4 ? v : v >= 0.12 ? v / 2 : 0; }
    for (i = na - 1; i >= 0; i--) for (j = nb - 1; j >= 0; j--) {
      var best = Math.max(dp[i + 1][j], dp[i][j + 1]);
      if (sim[i][j] > 0) best = Math.max(best, dp[i + 1][j + 1] + sim[i][j]);
      dp[i][j] = best;
    }
    // nothing alike at all (short or unrelated lines): keep slot order
    if (dp[0][0] === 0) return slots();
    i = 0; j = 0;
    while (i < na || j < nb) {
      if (i < na && j < nb && sim[i][j] > 0 && dp[i][j] === dp[i + 1][j + 1] + sim[i][j]) { steps.push('m'); i++; j++; }
      else if (i < na && (j >= nb || dp[i][j] === dp[i + 1][j])) steps.push('d'), i++;
      else steps.push('i'), j++;
    }
    return steps;
  }

  /** Groups consecutive changed rows into hunks: [{start, end}] (row indexes, end exclusive). */
  function hunksOf(rows) {
    var h = [], cur = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].type !== 'eq' && rows[i].type !== 'blank') { if (!cur) cur = { start: i, end: i + 1 }; else cur.end = i + 1; }
      else if (cur) { h.push(cur); cur = null; }
    }
    if (cur) h.push(cur);
    return h;
  }
  function statsOf(rows, na, nb) {
    var add = 0, del = 0, mod = 0;
    rows.forEach(function (r) { if (r.type === 'ins') add++; else if (r.type === 'del') del++; else if (r.type === 'mod') mod++; });
    var eq = rows.length - add - del - mod;
    var total = Math.max(na, nb, 1);
    return { added: add, removed: del, modified: mod, unchanged: eq, linesA: na, linesB: nb, similarity: Math.round(100 * eq / total) };
  }

  /** Intra-line segments at word or char granularity. 'none' gives whole-line segments. */
  function intraline(a, b, granularity) {
    if (granularity === 'none' || a === b) return { a: [{ t: a, c: 'eq' }], b: [{ t: b, c: 'eq' }] };
    var parts = granularity === 'char' ? Diff.diffChars(a, b) : Diff.diffWordsWithSpace(a, b);
    var sa = [], sb = [];
    parts.forEach(function (p) {
      if (p.added) sb.push({ t: p.value, c: 'ins' });
      else if (p.removed) sa.push({ t: p.value, c: 'del' });
      else { sa.push({ t: p.value, c: 'eq' }); sb.push({ t: p.value, c: 'eq' }); }
    });
    return { a: mergeSegs(sa), b: mergeSegs(sb) };
  }
  function mergeSegs(s) {
    var out = [];
    s.forEach(function (x) { if (!x.t) return; var l = out[out.length - 1]; if (l && l.c === x.c) l.t += x.t; else out.push({ t: x.t, c: x.c }); });
    return out;
  }

  /** Collapse unchanged runs longer than 2*context+1 into {type:'skip', count, from} rows.
   *  keepOpen lists the `from` of folds the visitor has expanded. */
  function foldContext(rows, context, keepOpen) {
    if (context == null || context < 0) return rows;
    var open = {}; (keepOpen || []).forEach(function (f) { open[f] = true; });
    var out = [], i = 0;
    while (i < rows.length) {
      var same = function (r) { return r.type === 'eq' || r.type === 'blank'; };
      if (!same(rows[i])) { out.push(rows[i]); i++; continue; }
      var j = i; while (j < rows.length && same(rows[j])) j++;
      var run = j - i, head = i === 0 ? 0 : context, tail = j === rows.length ? 0 : context;
      if (run > head + tail + 1 && !open[i + head]) {
        for (var k = 0; k < head; k++) out.push(rows[i + k]);
        out.push({ type: 'skip', count: run - head - tail, from: i + head, to: j - tail });
        for (var k2 = j - tail; k2 < j; k2++) out.push(rows[k2]);
      } else for (var k3 = i; k3 < j; k3++) out.push(rows[k3]);
      i = j;
    }
    return out;
  }

  // ----------------------------------------------------------- syntax tokens
  var KW = {
    js: 'async await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield',
    py: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
    sql: 'select from where and or not in is null as join inner left right full outer on group by order having limit offset insert into values update set delete create table alter drop index view primary key foreign references unique default check constraint union all distinct case when then else end exists between like asc desc with begin commit rollback declare top',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record',
    cs: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await',
    sh: 'if then else elif fi for while do done case esac function in return exit export local echo set unset source',
    rs: 'as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn',
    css: ''
  };
  var KWSET = {};
  Object.keys(KW).forEach(function (k) { KWSET[k] = {}; KW[k].split(' ').forEach(function (w) { if (w) KWSET[k][w] = 1; }); });

  function detectLang(text, name) {
    var ext = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    if (ext) {
      var e = ext[1];
      var map = { json: 'json', js: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', jsx: 'js', py: 'py', sql: 'sql', yml: 'yaml', yaml: 'yaml', xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', css: 'css', scss: 'css', go: 'go', java: 'java', kt: 'java', cs: 'cs', sh: 'sh', bash: 'sh', zsh: 'sh', rs: 'rs', md: 'text', txt: 'text', csv: 'text', ini: 'ini', toml: 'ini', env: 'ini', properties: 'ini', diff: 'diff', patch: 'diff' };
      if (map[e]) return map[e];
    }
    var t = (text || '').slice(0, 4000).trim();
    if (!t) return 'text';
    if (/^[\[{]/.test(t) && /[\]}]\s*$/.test((text || '').trim().slice(-3))) { try { JSON.parse(text); return 'json'; } catch (e) { /* fallthrough */ } }
    if (/^\s*<(\?xml|!DOCTYPE|html|[a-zA-Z][\w:-]*[\s>])/.test(t)) return 'xml';
    if (/^(---\s*$|[\w"'.-]+:\s)/m.test(t) && !/[;{}]\s*$/m.test(t) && /^\s*[\w"'.-]+:(\s|$)/m.test(t)) return 'yaml';
    if (/\b(select|insert|update|delete|create|alter)\b[\s\S]*\b(from|into|table|set)\b/i.test(t)) return 'sql';
    if (/^\s*(def |class |import |from \S+ import )/m.test(t) && !/[;{]\s*$/m.test(t)) return 'py';
    if (/\b(function|const|let|var|=>|import .* from|export )\b/.test(t)) return 'js';
    if (/^\s*(package|func) /m.test(t)) return 'go';
    if (/\b(public|private) (static |final )?(class|void|int|String)\b/.test(t)) return 'java';
    if (/^\s*[.#]?[\w-]+\s*\{[^}]*:[^}]*\}/m.test(t) || /^\s*[\w-]+\s*:\s*[^;]+;\s*$/m.test(t)) return 'css';
    if (/^\s*(#!\/bin\/(ba)?sh|\$ |echo |export )/m.test(t)) return 'sh';
    if (/^\s*\[[\w .-]+\]\s*$/m.test(t) && /^\s*[\w.-]+\s*=/m.test(t)) return 'ini';
    if (/^(---|\+\+\+|@@ )/m.test(t)) return 'diff';
    return 'text';
  }

  /** Token ranges for one line: [{s,e,c}] with c in str,num,kw,cmt,key,punc,attr,tag,prop. Pure per-line; block comments are not tracked across lines. */
  function tokenize(line, lang) {
    var out = [], i = 0, n = line.length, m;
    if (lang === 'text' || !lang) return out;
    function push(s, e, c) { if (e > s) out.push({ s: s, e: e, c: c }); }
    if (lang === 'diff') { if (/^\+/.test(line)) push(0, n, 'ins'); else if (/^-/.test(line)) push(0, n, 'del'); else if (/^@@/.test(line)) push(0, n, 'cmt'); return out; }
    if (lang === 'ini') { if ((m = /^\s*[;#]/.exec(line))) { push(0, n, 'cmt'); return out; } if ((m = /^\s*\[[^\]]*\]/.exec(line))) { push(0, m[0].length, 'tag'); return out; } if ((m = /^(\s*[\w.-]+)(\s*[=:])/.exec(line))) { push(0, m[1].length, 'key'); push(m[0].length, n, 'str'); } return out; }
    if (lang === 'yaml') {
      if ((m = /^\s*#/.exec(line))) { push(0, n, 'cmt'); return out; }
      if ((m = /^(\s*-?\s*)([^:#"']+?|"[^"]*"|'[^']*')(\s*:)(\s|$)/.exec(line))) { push(m[1].length, m[1].length + m[2].length, 'key'); i = m[0].length; }
      var rest = line.slice(i);
      if ((m = /^\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(rest))) push(i + m[0].length - m[1].length, i + m[0].length, 'str');
      else if ((m = /^\s*(-?\d[\d_.eE+-]*|true|false|null|~|yes|no|on|off)\s*(#.*)?$/i.exec(rest))) { var st = i + m[0].indexOf(m[1]); push(st, st + m[1].length, /\d/.test(m[1][0]) || m[1][0] === '-' ? 'num' : 'kw'); }
      var hc = rest.indexOf(' #'); if (hc >= 0) push(i + hc + 1, n, 'cmt');
      return out;
    }
    if (lang === 'xml') {
      var re = /<!--[\s\S]*?-->|<\/?[\w:.-]+|\/?>|[\w:.-]+(?==)|"[^"]*"|'[^']*'/g;
      while ((m = re.exec(line))) {
        var tk = m[0];
        if (tk[0] === '<' && tk[1] === '!') push(m.index, m.index + tk.length, 'cmt');
        else if (tk[0] === '<' || tk === '>' || tk === '/>') push(m.index, m.index + tk.length, 'tag');
        else if (tk[0] === '"' || tk[0] === "'") push(m.index, m.index + tk.length, 'str');
        else push(m.index, m.index + tk.length, 'attr');
      }
      return out;
    }
    if (lang === 'json') {
      var rj = /"(?:[^"\\]|\\.)*"(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
      while ((m = rj.exec(line))) { var t = m[0]; push(m.index, m.index + t.length, t[0] === '"' ? (m[1] ? 'key' : 'str') : /^[tfn]/.test(t) ? 'kw' : 'num'); }
      return out;
    }
    if (lang === 'css') {
      var rc = /\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg)?|[.#]?[\w-]+(?=\s*[{,:])|@[\w-]+/g;
      while ((m = rc.exec(line))) { var tc = m[0]; push(m.index, m.index + tc.length, tc[0] === '/' ? 'cmt' : (tc[0] === '"' || tc[0] === "'") ? 'str' : /^-?[\d.]/.test(tc) || tc[0] === '#' && tc.length > 1 && /^#[0-9a-f]+$/i.test(tc) ? 'num' : tc[0] === '@' ? 'kw' : /^[.#]/.test(tc) ? 'tag' : 'prop'); }
      return out;
    }
    // C-like / scripting
    var kws = KWSET[lang] || KWSET.js;
    var lineComment = lang === 'py' || lang === 'sh' ? '#' : lang === 'sql' ? '--' : '//';
    var rg = /\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_$][\w$]*|\/\/|#|--/g;
    while ((m = rg.exec(line))) {
      var tt = m[0], s = m.index;
      if (tt === lineComment || (lang === 'js' && tt === '//') || (lang !== 'py' && lang !== 'sh' && lang !== 'sql' && tt === '//')) { if (tt === lineComment) { push(s, n, 'cmt'); break; } else continue; }
      if (tt === '#' || tt === '--' || tt === '//') continue;
      if (tt[0] === '/' && tt[1] === '*') push(s, s + tt.length, 'cmt');
      else if (tt[0] === '"' || tt[0] === "'" || tt[0] === '`') push(s, s + tt.length, 'str');
      else if (/^\d|^0x/.test(tt)) push(s, s + tt.length, 'num');
      else if (kws[lang === 'sql' ? tt.toLowerCase() : tt]) push(s, s + tt.length, 'kw');
      else if (lang === 'sql' && /^(count|sum|avg|min|max|coalesce|now|cast|concat|substring|length|upper|lower|trim|round|date|year|month|day|if|ifnull|nullif|row_number|rank|over|partition)$/i.test(tt)) push(s, s + tt.length, 'fn');
    }
    return out;
  }

  // Characters that render as nothing (or as an ordinary space): shown as a
  // labelled marker with "Show whitespace", and always inside a change.
  var INVISIBLE = {
    '\u00a0': ['NBSP', 'no-break space'], '\u202f': ['NNBSP', 'narrow no-break space'], '\u2007': ['FSP', 'figure space'], '\u00ad': ['SHY', 'soft hyphen'],
    '\u200b': ['ZWSP', 'zero-width space'], '\u200c': ['ZWNJ', 'zero-width non-joiner'], '\u200d': ['ZWJ', 'zero-width joiner'], '\u2060': ['WJ', 'word joiner'], '\ufeff': ['BOM', 'byte-order mark / zero-width no-break space'],
    '\u200e': ['LRM', 'left-to-right mark'], '\u200f': ['RLM', 'right-to-left mark'], '\u061c': ['ALM', 'Arabic letter mark'],
    '\u202a': ['LRE', 'left-to-right embedding'], '\u202b': ['RLE', 'right-to-left embedding'], '\u202c': ['PDF', 'pop directional formatting'], '\u202d': ['LRO', 'left-to-right override'], '\u202e': ['RLO', 'right-to-left override'],
    '\u2066': ['LRI', 'left-to-right isolate'], '\u2067': ['RLI', 'right-to-left isolate'], '\u2068': ['FSI', 'first strong isolate'], '\u2069': ['PDI', 'pop directional isolate'],
    '\u2028': ['LS', 'line separator'], '\u2029': ['PS', 'paragraph separator'], '\u180e': ['MVS', 'Mongolian vowel separator'], '\u3000': ['IDSP', 'ideographic space'], '\u205f': ['MMSP', 'medium mathematical space'],
    '\u2000': ['NQSP', 'en quad'], '\u2001': ['MQSP', 'em quad'], '\u2002': ['ENSP', 'en space'], '\u2003': ['EMSP', 'em space'], '\u2004': ['3/MSP', 'three-per-em space'], '\u2005': ['4/MSP', 'four-per-em space'],
    '\u2006': ['6/MSP', 'six-per-em space'], '\u2008': ['PUNCSP', 'punctuation space'], '\u2009': ['THSP', 'thin space'], '\u200a': ['HSP', 'hair space'], '\u034f': ['CGJ', 'combining grapheme joiner']
  };
  var INVISIBLE_RE = /[\u00a0\u202f\u2007\u00ad\u200b-\u200f\u2060\ufeff\u061c\u202a-\u202e\u2066-\u2069\u2028\u2029\u180e\u3000\u205f\u2000-\u2006\u2008-\u200a\u034f\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
  function hex4(c) { return ('000' + c.charCodeAt(0).toString(16).toUpperCase()).slice(-4); }
  function markInvisible(raw) {
    var out = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i], inv = INVISIBLE[ch];
      if (inv) out += '<span class="inv" title="U+' + hex4(ch) + ' ' + inv[1] + '">' + inv[0] + '</span>';
      else if (INVISIBLE_RE.test(ch)) out += '<span class="inv" title="U+' + hex4(ch) + ' control character">U+' + hex4(ch) + '</span>';
      else out += esc(ch);
    }
    return out;
  }
  /** Builds HTML for one line from intra-line segments and syntax ranges. */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function renderLine(text, segs, lang, showWs) {
    var changes = [], pos = 0;
    (segs || [{ t: text, c: 'eq' }]).forEach(function (sg) { changes.push({ s: pos, e: pos + sg.t.length, c: sg.c }); pos += sg.t.length; });
    var toks = tokenize(text, lang);
    var cuts = {};
    changes.forEach(function (c) { cuts[c.s] = 1; cuts[c.e] = 1; });
    toks.forEach(function (t) { cuts[t.s] = 1; cuts[t.e] = 1; });
    cuts[0] = 1; cuts[text.length] = 1;
    var pts = Object.keys(cuts).map(Number).sort(function (a, b) { return a - b; });
    var html = '';
    for (var i = 0; i < pts.length - 1; i++) {
      var s = pts[i], e = pts[i + 1]; if (e <= s) continue;
      var ch = null, tk = null;
      for (var j = 0; j < changes.length; j++) if (changes[j].s <= s && changes[j].e >= e) { ch = changes[j].c; break; }
      for (var k = 0; k < toks.length; k++) if (toks[k].s <= s && toks[k].e >= e) { tk = toks[k].c; break; }
      var raw = text.slice(s, e), piece;
      if ((showWs || (ch && ch !== 'eq')) && INVISIBLE_RE.test(raw)) piece = markInvisible(raw); else piece = esc(raw);
      if (showWs) piece = piece.replace(/ (?![^<]*>)/g, '<span class="ws">·</span>').replace(/\t/g, '<span class="ws">→\t</span>');
      var cls = [];
      if (ch && ch !== 'eq') cls.push(ch === 'del' ? 'word-removed' : 'word-added');
      if (tk) cls.push('tk-' + tk);
      html += cls.length ? '<span class="' + cls.join(' ') + '">' + piece + '</span>' : piece;
    }
    return html || '&nbsp;';
  }

  // ------------------------------------------------------------------ patches
  function unifiedPatch(a, b, nameA, nameB, context) {
    var p = Diff.createTwoFilesPatch(nameA || 'original', nameB || 'modified', a, b, '', '', { context: context == null ? 3 : context });
    return p.replace(/^Index:.*\n/, '').replace(/^=+\n/, '').replace(/^(---|\+\+\+) (.*)\t$/mg, '$1 $2');
  }
  function applyPatch(text, patch) {
    var patches;
    try { patches = Diff.parsePatch(patch); } catch (e) { return { ok: false, error: 'Could not parse the patch: ' + e.message }; }
    if (!patches.length || !patches[0].hunks || !patches[0].hunks.length) return { ok: false, error: 'No hunks found. A unified diff starts with --- / +++ lines followed by @@ hunks.' };
    var res = Diff.applyPatch(text, patches[0], { fuzzFactor: 0 });
    if (res === false) {
      var fuzzy = Diff.applyPatch(text, patches[0], { fuzzFactor: 2 });
      if (fuzzy === false) return { ok: false, error: 'The patch does not apply: a hunk\'s context lines were not found in the original. Check that this is the file the patch was made from.' };
      return { ok: true, text: fuzzy, fuzzy: true, hunks: patches[0].hunks.length };
    }
    return { ok: true, text: res, hunks: patches[0].hunks.length };
  }

  /** Every file in a (possibly multi-file) unified diff:
   *  [{name, oldName, newName, hunks, patch}] where patch is jsdiff's object. */
  function parsePatchFiles(patch) {
    var list;
    try { list = Diff.parsePatch(patch); } catch (e) { throw new Error('Could not parse the patch: ' + e.message); }
    var strip = function (n) { return (n || '').replace(/^[ab]\//, '').replace(/\t.*$/, ''); };
    return list.filter(function (p) { return p.hunks && p.hunks.length; }).map(function (p) {
      var newName = strip(p.newFileName), oldName = strip(p.oldFileName);
      return { name: newName && newName !== '/dev/null' ? newName : oldName, oldName: oldName, newName: newName, hunks: p.hunks, patch: p };
    });
  }
  /** Where each hunk's expected lines (context and removed) best fit the
   *  original, and which of them differ there: [{hunk, line, expected, actual}]
   *  with 1-based line numbers in the original. */
  function hunkMismatches(text, file) {
    var lines = splitLines(text).map(function (l) { return l.replace(/\r$/, ''); }), out = [];
    file.hunks.forEach(function (h, hi) {
      var exp = h.lines.filter(function (l) { return l[0] === ' ' || l[0] === '-'; }).map(function (l) { return l.slice(1); });
      if (!exp.length) return;
      var best = -1, bestScore = -1, want = Math.max(0, h.oldStart - 1);
      for (var p = 0; p + exp.length <= lines.length; p++) {
        var sc = 0; for (var k = 0; k < exp.length; k++) if (lines[p + k] === exp[k]) sc++;
        if (sc > bestScore || (sc === bestScore && Math.abs(p - want) < Math.abs(best - want))) { bestScore = sc; best = p; }
      }
      if (best < 0) best = want;
      for (var k2 = 0; k2 < exp.length; k2++) if (lines[best + k2] !== exp[k2]) out.push({ hunk: hi + 1, line: best + k2 + 1, expected: exp[k2], actual: lines[best + k2] == null ? '' : lines[best + k2] });
    });
    return out;
  }
  /** Applies one file of a patch. Exact context first; if that fails, a fuzz
   *  of 2 lines, reported with the context lines that did not match. */
  function applyPatchFile(text, file) {
    var res = Diff.applyPatch(text, file.patch, { fuzzFactor: 0 });
    if (res !== false) return { ok: true, text: res, fuzzy: false, mismatches: [], hunks: file.hunks.length };
    var fuzzy = Diff.applyPatch(text, file.patch, { fuzzFactor: 2 });
    if (fuzzy === false) return { ok: false, error: 'The patch does not apply to ' + (file.name || 'this file') + ': a hunk\'s context lines were not found. Check that this is the file the patch was made from.', mismatches: hunkMismatches(text, file), hunks: file.hunks.length };
    return { ok: true, text: fuzzy, fuzzy: true, mismatches: hunkMismatches(text, file), hunks: file.hunks.length };
  }

  // ---------------------------------------------------------------- three-way
  /** diff3: merges `ours` and `theirs` against `base`. Returns merged text,
   *  conflict count, and chunks [{type:'eq'|'ours'|'theirs'|'both'|'conflict', lines|ours,theirs,base}]. */
  function diff3(base, ours, theirs, opts) {
    var o = Object.assign({}, DEFAULT_OPTS, opts || {});
    var lb = splitLines(base), lo = splitLines(ours), lt = splitLines(theirs);
    var key = function (l) { return normalizeLine(l, o); };
    var ho = hunksVsBase(lb.map(key), lo.map(key)), ht = hunksVsBase(lb.map(key), lt.map(key));
    // hunk: {bs, be, s, e} base range [bs,be) replaced by side range [s,e)
    var chunks = [], bi = 0, oi = 0, ti = 0, io = 0, it = 0;
    while (io < ho.length || it < ht.length) {
      var a = ho[io], b = ht[it];
      var next = Math.min(a ? a.bs : Infinity, b ? b.bs : Infinity);
      if (next > bi) { chunks.push({ type: 'eq', lines: lb.slice(bi, next) }); oi += next - bi; ti += next - bi; bi = next; }
      // gather all hunks from both sides that overlap the region starting here
      var bs = next, be = Math.max(a && a.bs === next ? a.be : next, b && b.bs === next ? b.be : next);
      var useO = [], useT = [];
      var changed = true;
      while (changed) {
        changed = false;
        while (io < ho.length && ho[io].bs < be + (be === bs ? 1 : 0) && ho[io].bs >= bs) { useO.push(ho[io]); be = Math.max(be, ho[io].be); io++; changed = true; }
        while (it < ht.length && ht[it].bs < be + (be === bs ? 1 : 0) && ht[it].bs >= bs) { useT.push(ht[it]); be = Math.max(be, ht[it].be); it++; changed = true; }
        if (be === bs) { // pure insertions at the same point: take both lists at bs
          while (io < ho.length && ho[io].bs === bs) { useO.push(ho[io]); io++; changed = true; }
          while (it < ht.length && ht[it].bs === bs) { useT.push(ht[it]); it++; changed = true; }
        }
      }
      var oRange = sideRange(useO, bs, be, oi, lb, lo.length), tRange = sideRange(useT, bs, be, ti, lb, lt.length);
      var oLines = lo.slice(oRange[0], oRange[1]), tLines = lt.slice(tRange[0], tRange[1]), bLines = lb.slice(bs, be);
      var oChanged = useO.length > 0, tChanged = useT.length > 0;
      if (oChanged && tChanged) {
        if (sameLines(oLines, tLines, key)) chunks.push({ type: 'both', lines: oLines });
        else chunks.push({ type: 'conflict', base: bLines, ours: oLines, theirs: tLines });
      } else if (oChanged) chunks.push({ type: 'ours', lines: oLines });
      else chunks.push({ type: 'theirs', lines: tLines });
      bi = be; oi = oRange[1]; ti = tRange[1];
    }
    if (bi < lb.length) chunks.push({ type: 'eq', lines: lb.slice(bi) });
    var out = [], conflicts = 0;
    chunks.forEach(function (c) {
      if (c.type === 'conflict') { conflicts++; out.push('<<<<<<< ours'); out.push.apply(out, c.ours); out.push('||||||| base'); out.push.apply(out, c.base); out.push('======='); out.push.apply(out, c.theirs); out.push('>>>>>>> theirs'); }
      else out.push.apply(out, c.lines);
    });
    return { merged: out.join('\n') + (out.length ? '\n' : ''), conflicts: conflicts, chunks: chunks };
  }
  function hunksVsBase(kb, ks) {
    var parts = Diff.diffArrays(kb, ks), h = [], bi = 0, si = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p.added && !p.removed) { bi += p.value.length; si += p.value.length; continue; }
      var cur = { bs: bi, be: bi, s: si, e: si };
      if (p.removed) { cur.be = bi + p.value.length; bi = cur.be; var nx = parts[i + 1]; if (nx && nx.added) { cur.e = si + nx.value.length; si = cur.e; i++; } }
      else { cur.e = si + p.value.length; si = cur.e; }
      h.push(cur);
    }
    return h;
  }
  function sideRange(hunks, bs, be, si, lb, sideLen) {
    if (!hunks.length) return [si, si + (be - bs)];
    var first = hunks[0], last = hunks[hunks.length - 1];
    var start = first.s - (first.bs - bs);
    var end = last.e + (be - last.be);
    return [Math.max(0, start), Math.min(sideLen, end)];
  }
  function sameLines(a, b, key) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (key(a[i]) !== key(b[i])) return false; return true; }

  // ------------------------------------------------------- lossless JSON
  /** A JSON number kept as its source text, so 9007199254740993 does not
   *  become 9007199254740992 the way it does in JSON.parse. */
  function LosslessNumber(raw) { this.value = raw; this.isLosslessNumber = true; }
  /** Canonical form of a decimal literal: 1.0, 1e0 and 1 all give "1e0". */
  function canonicalNumber(raw) {
    var m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
    if (!m) return raw;
    var digits = (m[2] + (m[3] || '')).replace(/^0+/, ''), exp = parseInt(m[4] || '0', 10) - (m[3] || '').length;
    if (!digits) return '0';
    var t = digits.replace(/0+$/, ''); exp += digits.length - t.length;
    return (m[1] ? '-' : '') + t + 'e' + exp;
  }
  /** JSON.parse that keeps numbers as LosslessNumber. Throws SyntaxError with
   *  a position, like JSON.parse. */
  function parseJsonLossless(text) {
    var i = 0, n = text.length;
    function fail(msg) { throw new SyntaxError('Invalid JSON: ' + msg + ' at position ' + i); }
    function ws() { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; }
    function value() {
      ws(); var c = text[i];
      if (c === '{') { i++; var obj = {}; ws(); if (text[i] === '}') { i++; return obj; }
        for (;;) { ws(); if (text[i] !== '"') fail('expected a property name'); var k = str(); ws(); if (text[i] !== ':') fail('expected ":"'); i++; obj[k] = value(); ws();
          if (text[i] === ',') { i++; continue; } if (text[i] === '}') { i++; return obj; } fail('expected "," or "}"'); } }
      if (c === '[') { i++; var arr = []; ws(); if (text[i] === ']') { i++; return arr; }
        for (;;) { arr.push(value()); ws(); if (text[i] === ',') { i++; continue; } if (text[i] === ']') { i++; return arr; } fail('expected "," or "]"'); } }
      if (c === '"') return str();
      var m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
      if (m && m[0]) { i += m[0].length; if (/^[\d.]/.test(text[i] || '')) fail('invalid number'); return new LosslessNumber(m[0]); }
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      fail(i >= n ? 'unexpected end of input' : 'unexpected character ' + JSON.stringify(c));
    }
    function str() {
      var start = i; i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; else if (text.charCodeAt(i) < 32) fail('control character in string'); i++; }
      if (i >= n) fail('unterminated string');
      i++;
      return JSON.parse(text.slice(start, i));
    }
    var v = value(); ws();
    if (i < n) fail('unexpected text after the end');
    return v;
  }
  function isNum(v) { return v instanceof LosslessNumber; }
  /** JSON.stringify that writes LosslessNumbers as their digits. */
  function stringifyLossless(v, indent, depth) {
    depth = depth || 0;
    var pad = indent ? '\n' + new Array(depth + 2).join(indent) : '', close = indent ? '\n' + new Array(depth + 1).join(indent) : '';
    if (isNum(v)) return v.value;
    if (Array.isArray(v)) return v.length ? '[' + v.map(function (x) { return pad + stringifyLossless(x, indent, depth + 1); }).join(',') + close + ']' : '[]';
    if (v && typeof v === 'object') { var ks = Object.keys(v); return ks.length ? '{' + ks.map(function (k) { return pad + JSON.stringify(k) + (indent ? ': ' : ':') + stringifyLossless(v[k], indent, depth + 1); }).join(',') + close + '}' : '{}'; }
    return v === undefined ? 'null' : JSON.stringify(v);
  }

  // --------------------------------------------------------------- structural
  function typeOf(v) { return v === null ? 'null' : isNum(v) ? 'number' : Array.isArray(v) ? 'array' : typeof v; }
  /** Semantic diff of two parsed values. Returns [{path, type:'added'|'removed'|'changed'|'type', old, new}]. Key order is ignored by construction. */
  function structuralDiff(a, b, opts) {
    var o = Object.assign({ arrays: 'index', keyField: null }, opts || {});
    var out = [];
    function walk(x, y, path) {
      var tx = typeOf(x), ty = typeOf(y);
      if (tx !== ty) { out.push({ path: path, type: 'type', old: x, new: y, oldType: tx, newType: ty }); return; }
      if (tx === 'object') {
        var keys = {}; Object.keys(x).forEach(function (k) { keys[k] = 1; }); Object.keys(y).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).sort().forEach(function (k) {
          var p = path + (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '["' + k.replace(/"/g, '\\"') + '"]');
          if (!(k in y)) out.push({ path: p, type: 'removed', old: x[k] });
          else if (!(k in x)) out.push({ path: p, type: 'added', new: y[k] });
          else walk(x[k], y[k], p);
        });
      } else if (tx === 'array') {
        if (o.arrays === 'key' && o.keyField && x.every(function (e) { return e && typeof e === 'object' && o.keyField in e; }) && y.every(function (e) { return e && typeof e === 'object' && o.keyField in e; })) {
          var mx = {}, my = {}, keysInOrder = [];
          var group = function (arr, m) { arr.forEach(function (e) { var k = keyText(e[o.keyField]); if (!m[k]) { m[k] = []; if (keysInOrder.indexOf(k) < 0) keysInOrder.push(k); } m[k].push(e); }); };
          group(x, mx); group(y, my);
          keysInOrder.forEach(function (k) {
            var p = path + '[' + o.keyField + '=' + k + ']', ax = mx[k] || [], ay = my[k] || [], n = Math.max(ax.length, ay.length);
            if (ax.length > 1 || ay.length > 1) out.push({ path: p, type: 'duplicate', countA: ax.length, countB: ay.length });
            for (var i = 0; i < n; i++) {
              var pi = n > 1 ? p + '#' + (i + 1) : p;
              if (i >= ay.length) out.push({ path: pi, type: 'removed', old: ax[i] }); else if (i >= ax.length) out.push({ path: pi, type: 'added', new: ay[i] }); else walk(ax[i], ay[i], pi);
            }
          });
        } else if (o.arrays === 'set') {
          // multiset: every occurrence must be matched by one on the other side
          var sx = x.map(function (v) { return JSON.stringify(canon(v)); }), sy = y.map(function (v) { return JSON.stringify(canon(v)); });
          var left = {}; sy.forEach(function (k) { left[k] = (left[k] || 0) + 1; });
          x.forEach(function (v, i) { if (left[sx[i]] > 0) left[sx[i]]--; else out.push({ path: path + '[' + i + ']', type: 'removed', old: v }); });
          var right = {}; sx.forEach(function (k) { right[k] = (right[k] || 0) + 1; });
          y.forEach(function (v, i) { if (right[sy[i]] > 0) right[sy[i]]--; else out.push({ path: path + '[' + i + ']', type: 'added', new: v }); });
        } else {
          var n = Math.max(x.length, y.length);
          for (var i = 0; i < n; i++) { var p2 = path + '[' + i + ']'; if (i >= y.length) out.push({ path: p2, type: 'removed', old: x[i] }); else if (i >= x.length) out.push({ path: p2, type: 'added', new: y[i] }); else walk(x[i], y[i], p2); }
        }
      } else if (tx === 'number' && (isNum(x) || isNum(y))) {
        if (canonicalNumber(isNum(x) ? x.value : String(x)) !== canonicalNumber(isNum(y) ? y.value : String(y))) out.push({ path: path, type: 'changed', old: x, new: y });
      } else if (x !== y && !(tx === 'number' && isNaN(x) && isNaN(y))) out.push({ path: path, type: 'changed', old: x, new: y });
    }
    walk(a, b, '$');
    return out;
  }
  function keyText(v) { return v && typeof v === 'object' && v.isLosslessNumber ? v.value : String(v); }
  function canon(v) {
    if (isNum(v)) return { '#number': canonicalNumber(v.value) };
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function sortKeys(v) {
    if (isNum(v)) return v;
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = sortKeys(v[k]); }); return o; }
    return v;
  }
  function canonicalJson(v) { return stringifyLossless(sortKeys(v), '  '); }

  // --------------------------------------------------------------------- CSV
  function detectDelimiter(text) {
    var head = text.split(/\r?\n/).slice(0, 10).join('\n');
    var best = ',', bestN = -1;
    [',', ';', '\t', '|'].forEach(function (d) { var n = (head.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length; if (n > bestN) { bestN = n; best = d; } });
    return best;
  }
  function parseCsv(text, delim) {
    delim = delim || detectDelimiter(text);
    var rows = [], row = [], cell = '', i = 0, q = false, started = false, n = text.length;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '' && !started) q = true; // quoting only opens at the start of a field, as in Excel
      else if (ch === delim) { row.push(cell); cell = ''; started = false; continue; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; started = false; continue; }
      else cell += ch;
      started = true;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  }
  /** Table diff. rowsA/rowsB are arrays of arrays whose first row is the
   *  header. opts.keys lists key column NAMES, looked up in each file's own
   *  header, so a file whose columns were reordered still matches row for
   *  row. An empty key list compares by row order. A number is accepted for
   *  older callers: an index into the original's header. */
  /** Makes header names unique and non-empty so no column shadows another:
   *  amount, amount -> amount, amount (2); a blank header becomes (column N). */
  function uniqueHeaders(hdr) {
    var taken = {}, out = [];
    hdr.forEach(function (h) { h = String(h == null ? '' : h); if (h) taken[h] = (taken[h] || 0) + 1; });
    var used = {};
    hdr.forEach(function (h, i) {
      h = String(h == null ? '' : h);
      var name = h || '(column ' + (i + 1) + ')';
      if (used[name]) { var n = 2; while (used[h + ' (' + n + ')'] || (taken[h + ' (' + n + ')'] && h + ' (' + n + ')' !== name)) n++; name = h + ' (' + n + ')'; }
      used[name] = true; out.push(name);
    });
    return out;
  }
  function tableDiff(rowsA, rowsB, opts) {
    var ha = uniqueHeaders(rowsA[0] || []), hb = uniqueHeaders(rowsB[0] || []);
    if (typeof opts === 'number') opts = { keys: opts >= 0 && ha[opts] != null ? [ha[opts]] : [] };
    var o = Object.assign({ keys: [] }, opts || {});
    o.keys.forEach(function (k) {
      if (ha.indexOf(k) < 0) throw new Error('Key column "' + k + '" is not in the original file.');
      if (hb.indexOf(k) < 0) throw new Error('Key column "' + k + '" is not in the modified file.');
    });
    var cols = ha.slice(); hb.forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); });
    var colsAdded = hb.filter(function (c) { return ha.indexOf(c) < 0; }), colsRemoved = ha.filter(function (c) { return hb.indexOf(c) < 0; });
    function objects(rows, hdr) {
      return rows.slice(1).map(function (r) { var obj = {}; hdr.forEach(function (c, j) { obj[c] = r[j] == null ? '' : String(r[j]); }); return obj; });
    }
    var OA = objects(rowsA, ha), OB = objects(rowsB, hb);
    var keyOf = function (obj, i) { return o.keys.length ? o.keys.map(function (k) { return obj[k]; }).join('\u241F') : String(i); };
    // Every row is kept, even when its key repeats: rows sharing a key are
    // paired in file order (a multiset), surplus ones are added or removed,
    // and every repeated key is listed in `duplicates`.
    function index(objs) {
      var m = {}, order = [];
      objs.forEach(function (obj, i) { var k = keyOf(obj, i); if (!m[k]) { m[k] = []; order.push(k); } m[k].push(obj); });
      return { m: m, order: order };
    }
    var added = [], removed = [], changed = [], unchanged = 0, duplicates = [];
    var diffCells = function (ra, rb) {
      var cells = [];
      cols.forEach(function (c) { var x = ra[c] == null ? '' : ra[c], y = rb[c] == null ? '' : rb[c]; if (x !== y) cells.push({ col: c, old: x, new: y }); });
      return cells;
    };
    if (!o.keys.length) {
      // Row order: align whole rows with an LCS first, so one inserted row
      // is one added row; rows in a replaced block are paired by likeness.
      var sig = function (r) { return cols.map(function (c) { return r[c] == null ? '' : r[c]; }).join('\u241E'); };
      var SA = OA.map(sig), SB = OB.map(sig), parts = alignParts(SA, SB, Infinity), ia = 0, ib = 0;
      var emitPair = function (x, y) { var cells = diffCells(OA[x], OB[y]); if (cells.length) changed.push({ key: 'row ' + (y + 1), aRow: x + 1, bRow: y + 1, cells: cells, row: OB[y] }); else unchanged++; };
      for (var pi = 0; pi < parts.length; pi++) {
        var part = parts[pi], nx = parts[pi + 1];
        if (part.kind === 'e') { unchanged += part.value.length; ia += part.value.length; ib += part.value.length; continue; }
        if (part.kind === 'd' && nx && nx.kind === 'i') {
          var plan = pairBlock(SA.slice(ia, ia + part.value.length), SB.slice(ib, ib + nx.value.length), SA.slice(ia, ia + part.value.length), SB.slice(ib, ib + nx.value.length));
          plan.forEach(function (step) {
            if (step === 'm') { emitPair(ia, ib); ia++; ib++; }
            else if (step === 'd') { removed.push({ key: 'row ' + (ia + 1), aRow: ia + 1, row: OA[ia] }); ia++; }
            else { added.push({ key: 'row ' + (ib + 1), bRow: ib + 1, row: OB[ib] }); ib++; }
          });
          pi++; continue;
        }
        if (part.kind === 'd') part.value.forEach(function () { removed.push({ key: 'row ' + (ia + 1), aRow: ia + 1, row: OA[ia] }); ia++; });
        else part.value.forEach(function () { added.push({ key: 'row ' + (ib + 1), bRow: ib + 1, row: OB[ib] }); ib++; });
      }
      return { columns: cols, colsAdded: colsAdded, colsRemoved: colsRemoved, added: added, removed: removed, changed: changed, unchanged: unchanged, keyName: null, keys: [], duplicates: [] };
    }
    var A = index(OA), B = index(OB);
    var label = function (k, i, n) { return n > 1 ? k + ' (#' + (i + 1) + ')' : k; };
    A.order.forEach(function (k) {
      var ra = A.m[k], rb = B.m[k] || [], n = Math.max(ra.length, rb.length);
      if (ra.length > 1 || rb.length > 1) duplicates.push({ key: k, a: ra.length, b: rb.length });
      for (var i = 0; i < n; i++) {
        if (i >= rb.length) { removed.push({ key: label(k, i, n), row: ra[i] }); continue; }
        if (i >= ra.length) { added.push({ key: label(k, i, n), row: rb[i] }); continue; }
        var cells = [];
        cols.forEach(function (c) { var x = ra[i][c] == null ? '' : ra[i][c], y = rb[i][c] == null ? '' : rb[i][c]; if (x !== y) cells.push({ col: c, old: x, new: y }); });
        if (cells.length) changed.push({ key: label(k, i, n), cells: cells, row: rb[i] }); else unchanged++;
      }
    });
    B.order.forEach(function (k) {
      if (A.m[k]) return;
      var rb = B.m[k];
      if (rb.length > 1) duplicates.push({ key: k, a: 0, b: rb.length });
      rb.forEach(function (row, i) { added.push({ key: label(k, i, rb.length), row: row }); });
    });
    return { columns: cols, colsAdded: colsAdded, colsRemoved: colsRemoved, added: added, removed: removed, changed: changed, unchanged: unchanged, keyName: o.keys.length ? o.keys.join(' + ') : null, keys: o.keys, duplicates: o.keys.length ? duplicates : [] };
  }

  // ------------------------------------------------------------- workbooks
  /** Pairs the sheets of two workbooks ([{name, rows}]): by name first, then
   *  unmatched sheets whose content is identical or whose header row is
   *  mostly the same are reported as renamed-looking pairs. */
  function pairSheets(A, B) {
    var pairs = [], usedA = {}, usedB = {};
    A.forEach(function (sa) { var sb = B.find(function (x) { return x.name === sa.name; }); if (sb) { pairs.push({ a: sa.name, b: sb.name }); usedA[sa.name] = usedB[sb.name] = 1; } });
    var sig = function (s) { return JSON.stringify(s.rows); };
    var head = function (s) { return (s.rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); }).filter(Boolean); };
    var likeness = function (x, y) { var hx = head(x), hy = head(y); if (!hx.length || !hy.length) return 0; var inter = hx.filter(function (h) { return hy.indexOf(h) >= 0; }).length; return inter / Math.max(hx.length, hy.length); };
    A.forEach(function (sa) {
      if (usedA[sa.name]) return;
      var best = null, score = 0;
      B.forEach(function (sb) { if (usedB[sb.name]) return; var v = sig(sa) === sig(sb) ? 2 : likeness(sa, sb); if (v > score) { score = v; best = sb; } });
      if (best && score >= 0.6) { pairs.push({ a: sa.name, b: best.name, renamed: true }); usedA[sa.name] = usedB[best.name] = 1; }
    });
    var order = A.map(function (s) { return s.name; });
    pairs.sort(function (x, y) { return order.indexOf(x.a) - order.indexOf(y.a); });
    return { pairs: pairs, added: B.filter(function (s) { return !usedB[s.name]; }).map(function (s) { return s.name; }), removed: A.filter(function (s) { return !usedA[s.name]; }).map(function (s) { return s.name; }) };
  }

  // ----------------------------------------------------------------- folders
  var DEFAULT_IGNORE = ['.git', 'node_modules', 'bin', 'obj', '.vs', '*.log', '.DS_Store', 'Thumbs.db'];
  function globRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*') + '$', 'i'); }
  /** Ignore patterns: a pattern without "/" matches any file or folder name
   *  at any depth (node_modules, *.log); one with "/" matches a path from the
   *  root (docs/*.pdf); a trailing "/" means "this folder". */
  function compileIgnore(patterns) {
    var names = [], paths = [];
    (patterns || []).map(function (p) { return String(p).trim(); }).filter(Boolean).forEach(function (p) {
      var dir = /\/$/.test(p); p = p.replace(/^\/+|\/+$/g, '');
      if (!p) return;
      if (p.indexOf('/') < 0) names.push(globRe(p)); else paths.push({ re: globRe(p), dir: dir });
    });
    return function (path) {
      var seg = path.split('/');
      for (var i = 0; i < seg.length; i++) for (var j = 0; j < names.length; j++) if (names[j].test(seg[i])) return true;
      for (var k = 0; k < paths.length; k++) {
        if (paths[k].re.test(path)) return true;
        for (var d = 1; d < seg.length; d++) if (paths[k].re.test(seg.slice(0, d).join('/'))) return true;
      }
      return false;
    };
  }
  /** File-level comparison of two listings [{path, size, mtime, hash, crc}].
   *  by: 'content' (hash, or zip CRC when both sides have one; equal sizes
   *  without either are 'pending', never guessed), 'size', or 'date'
   *  (same when modified times are within 2 s, the resolution of zip and
   *  FAT timestamps). Rows are sorted by path. */
  function folderDiff(A, B, by) {
    var ma = {}, mb = {}, all = {};
    A.forEach(function (e) { ma[e.path] = e; all[e.path] = 1; }); B.forEach(function (e) { mb[e.path] = e; all[e.path] = 1; });
    return Object.keys(all).sort(function (x, y) { return x < y ? -1 : x > y ? 1 : 0; }).map(function (p) {
      var a = ma[p], b = mb[p], row = { path: p, a: a || null, b: b || null };
      if (!a) row.status = 'added'; else if (!b) row.status = 'removed';
      else if (by === 'size') row.status = a.size === b.size ? 'same' : 'modified';
      else if (by === 'date') {
        var ta = a.mtime || 0, tb = b.mtime || 0;
        row.status = Math.abs(ta - tb) <= 2000 && a.size === b.size ? 'same' : 'modified';
        if (Math.abs(ta - tb) > 2000) row.newer = ta > tb ? 'a' : 'b';
      } else if (a.size !== b.size) row.status = 'modified';
      else if (a.hash && b.hash) row.status = a.hash === b.hash ? 'same' : 'modified';
      else if (a.crc != null && b.crc != null) row.status = a.crc === b.crc ? 'same' : 'modified';
      else row.status = 'pending';
      return row;
    });
  }
  function emptyCounts() { return { added: 0, removed: 0, modified: 0, same: 0, pending: 0 }; }
  /** Folder tree of folderDiff rows with per-folder status counts. */
  function buildTree(rows) {
    var root = { name: '', path: '', dir: true, children: [], index: {}, counts: emptyCounts() };
    rows.forEach(function (r) {
      var seg = r.path.split('/'), node = root;
      node.counts[r.status]++;
      for (var i = 0; i < seg.length - 1; i++) {
        var p = seg.slice(0, i + 1).join('/'), next = node.index[seg[i]];
        if (!next) { next = { name: seg[i], path: p, dir: true, children: [], index: {}, counts: emptyCounts() }; node.index[seg[i]] = next; node.children.push(next); }
        next.counts[r.status]++; node = next;
      }
      node.children.push({ name: seg[seg.length - 1], path: r.path, dir: false, row: r });
    });
    (function sort(n) { n.children.sort(function (x, y) { return x.dir !== y.dir ? (x.dir ? -1 : 1) : x.name < y.name ? -1 : x.name > y.name ? 1 : 0; }); n.children.forEach(function (c) { if (c.dir) sort(c); }); })(root);
    return root;
  }
  /** Visible rows of the tree: open folders' contents, with identical items
   *  hidden or only one status shown when asked. Folders with nothing left
   *  to show are hidden too. Returns [{node, depth}]. */
  function flattenTree(root, open, opts) {
    var o = opts || {}, out = [];
    var keep = function (st) { return (!o.hideIdentical || st !== 'same') && (!o.status || o.status === 'all' || o.status === st); };
    var dirKeep = function (n) { var c = n.counts; return ['added', 'removed', 'modified', 'same', 'pending'].some(function (st) { return c[st] && keep(st); }); };
    (function walk(n, depth) {
      n.children.forEach(function (c) {
        if (c.dir) { if (!dirKeep(c)) return; out.push({ node: c, depth: depth }); if (open.has(c.path)) walk(c, depth + 1); }
        else if (keep(c.row.status)) out.push({ node: c, depth: depth });
      });
    })(root, 0);
    return out;
  }
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function csvLine(cells) { return cells.map(csvCell).join(',') + '\r\n'; }
  function isoTime(t) { return t ? new Date(t).toISOString() : ''; }
  /** Folder comparison report as CSV, starting with the options and date. */
  function folderCsv(rows, meta) {
    var m = meta || {}, out = csvLine(['Report', 'Layerbit folder comparison']) + csvLine(['Generated', m.generated || new Date().toISOString()]) +
      csvLine(['Left', m.left || '']) + csvLine(['Right', m.right || '']) + csvLine(['Compared by', m.by || '']) + csvLine(['Ignored', (m.ignore || []).join(' ')]) + '\r\n' +
      csvLine(['Path', 'Status', 'Size left', 'Size right', 'Modified left', 'Modified right']);
    rows.forEach(function (r) { out += csvLine([r.path, r.status === 'same' ? 'identical' : r.status, r.a ? r.a.size : '', r.b ? r.b.size : '', r.a ? isoTime(r.a.mtime) : '', r.b ? isoTime(r.b.mtime) : '']); });
    return out;
  }
  /** MS-DOS date and time fields (zip headers) to a local timestamp. */
  function dosTime(date, time) { return new Date(((date >> 9) & 127) + 1980, ((date >> 5) & 15) - 1, date & 31, (time >> 11) & 31, (time >> 5) & 63, (time & 31) * 2).getTime(); }

  // --------------------------------------------------------------------- zip
  /** Reads a zip's central directory. Returns [{name, size, crc, dir, read():Promise<Uint8Array>}]. Browser only (DecompressionStream). */
  function readZip(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), n = u8.length;
    var eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
    var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    var entries = [], p = cdOff, td = new TextDecoder();
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt central directory');
      var method = dv.getUint16(p + 10, true), mtime = dosTime(dv.getUint16(p + 14, true), dv.getUint16(p + 12, true)), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
      var name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      var ent = makeEntry(name, usize, csize, crc, method, loff); ent.mtime = mtime; entries.push(ent);
      p += 46 + nlen + elen + clen;
    }
    function makeEntry(name, usize, csize, crc, method, loff) {
      return { name: name, size: usize, crc: crc >>> 0, dir: /\/$/.test(name), method: method, read: function () {
        if (dv.getUint32(loff, true) !== 0x04034b50) return Promise.reject(new Error('Corrupt local header for ' + name));
        var ln = dv.getUint16(loff + 26, true), le = dv.getUint16(loff + 28, true), start = loff + 30 + ln + le;
        var data = u8.subarray(start, start + csize);
        if (method === 0) return Promise.resolve(data);
        if (method !== 8) return Promise.reject(new Error('Unsupported compression method ' + method + ' in ' + name));
        if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('This browser cannot inflate zip entries'));
        var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(data); w.close();
        return new Response(ds.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      } };
    }
    return entries.filter(function (e) { return !e.dir; });
  }
  // ----------------------------------------------------------------- bytes
  /** Decodes file bytes without losing information: a BOM picks UTF-8 or
   *  UTF-16; BOM-less UTF-16 is recognised by its zero bytes; otherwise strict
   *  UTF-8 is tried and, if the bytes are not valid UTF-8, Windows-1252 (which
   *  maps every byte to a character, so two different files never decode to
   *  the same text). Returns {text, encoding, bom}. */
  function decodeBytes(u8) {
    var dec = function (label, bytes, fatal) { return new TextDecoder(label, fatal ? { fatal: true } : undefined).decode(bytes); };
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return { text: dec('utf-8', u8.subarray(3)), encoding: 'UTF-8', bom: true };
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return { text: dec('utf-16le', u8.subarray(2)), encoding: 'UTF-16 LE', bom: true };
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return { text: dec('utf-16be', u8.subarray(2)), encoding: 'UTF-16 BE', bom: true };
    var n = Math.min(u8.length, 4000) & ~1;
    if (n >= 4) {
      var even = 0, odd = 0;
      for (var i = 0; i < n; i += 2) { if (u8[i] === 0) even++; if (u8[i + 1] === 0) odd++; }
      if (odd > n / 2 * 0.4 && even < n / 2 * 0.05) return { text: dec('utf-16le', u8), encoding: 'UTF-16 LE', bom: false };
      if (even > n / 2 * 0.4 && odd < n / 2 * 0.05) return { text: dec('utf-16be', u8), encoding: 'UTF-16 BE', bom: false };
    }
    try { return { text: dec('utf-8', u8, true), encoding: 'UTF-8', bom: false }; }
    catch (e) { return { text: dec('windows-1252', u8), encoding: 'Windows-1252', bom: false }; }
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  /** Display paths for a list of archive entries: a single top folder is
   *  removed only when every entry sits inside it (proj/a, proj/b -> a, b);
   *  src/app.js and lib/app.js keep their folders so neither is lost. */
  function stripCommonRoot(paths) {
    if (paths.length < 2) return paths.slice();
    var first = paths[0].split('/')[0];
    var all = paths.every(function (p) { var i = p.indexOf('/'); return i > 0 && p.slice(0, i) === first; });
    return all ? paths.map(function (p) { return p.slice(first.length + 1); }) : paths.slice();
  }
  function isProbablyText(u8) {
    var n = Math.min(u8.length, 4000), ctl = 0;
    for (var i = 0; i < n; i++) { var c = u8[i]; if (c === 0) return false; if (c < 7 || (c > 13 && c < 32)) ctl++; }
    return ctl / Math.max(n, 1) < 0.05;
  }

  return { lineDiff: lineDiff, foldContext: foldContext, intraline: intraline, tokenize: tokenize, detectLang: detectLang, renderLine: renderLine, esc: esc,
    unifiedPatch: unifiedPatch, applyPatch: applyPatch, parsePatchFiles: parsePatchFiles, applyPatchFile: applyPatchFile, diff3: diff3, structuralDiff: structuralDiff, canonicalJson: canonicalJson, canon: canon,
    parseCsv: parseCsv, detectDelimiter: detectDelimiter, tableDiff: tableDiff, readZip: readZip, isProbablyText: isProbablyText, decodeBytes: decodeBytes, bytesEqual: bytesEqual, stripCommonRoot: stripCommonRoot, uniqueHeaders: uniqueHeaders, pairSheets: pairSheets, DEFAULT_IGNORE: DEFAULT_IGNORE, compileIgnore: compileIgnore, folderDiff: folderDiff, buildTree: buildTree, flattenTree: flattenTree, folderCsv: folderCsv, csvLine: csvLine, dosTime: dosTime, textFacts: textFacts, textNotes: textNotes, parseJsonLossless: parseJsonLossless, stringifyLossless: stringifyLossless, canonicalNumber: canonicalNumber, splitLines: splitLines, normalizeLine: normalizeLine, DEFAULT_OPTS: DEFAULT_OPTS };
});
