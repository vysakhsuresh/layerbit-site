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

  // ----------------------------------------------------------------- line diff
  /** Returns rows for split and unified rendering.
   *  row: {type:'eq'|'del'|'ins'|'mod', l:{n,text,segs}|null, r:{n,text,segs}|null}
   *  segs: [{t:text, c:'eq'|'del'|'ins'}] intra-line for 'mod' rows. */
  function lineDiff(a, b, opts) {
    var o = Object.assign({}, DEFAULT_OPTS, opts || {});
    var la = splitLines(a), lb = splitLines(b);
    var ka = la.map(function (l) { return normalizeLine(l, o); });
    var kb = lb.map(function (l) { return normalizeLine(l, o); });
    if (o.ignoreBlank) {
      // blank lines still display, but are matched as if absent: give every
      // blank the same key so runs of them align freely
      ka = ka.map(function (l) { return l.trim() === '' ? '' : l; });
      kb = kb.map(function (l) { return l.trim() === '' ? '' : l; });
    }
    var parts = Diff.diffArrays(ka, kb);
    var rows = [], ai = 0, bi = 0;
    for (var i = 0; i < parts.length; i++) {
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
    return { rows: rows, hunks: hunksOf(rows), stats: statsOf(rows, la.length, lb.length) };
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
      if (rows[i].type !== 'eq') { if (!cur) cur = { start: i, end: i + 1 }; else cur.end = i + 1; }
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

  /** Collapse unchanged runs longer than 2*context+1 into {type:'skip', count, from} rows. */
  function foldContext(rows, context) {
    if (context == null || context < 0) return rows;
    var out = [], i = 0;
    while (i < rows.length) {
      if (rows[i].type !== 'eq') { out.push(rows[i]); i++; continue; }
      var j = i; while (j < rows.length && rows[j].type === 'eq') j++;
      var run = j - i, head = i === 0 ? 0 : context, tail = j === rows.length ? 0 : context;
      if (run > head + tail + 1) {
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
      var piece = esc(text.slice(s, e));
      if (showWs) piece = piece.replace(/ /g, '<span class="ws">·</span>').replace(/\t/g, '<span class="ws">→\t</span>');
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

  // --------------------------------------------------------------- structural
  function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }
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
          var mx = {}, my = {}; x.forEach(function (e) { mx[String(e[o.keyField])] = e; }); y.forEach(function (e) { my[String(e[o.keyField])] = e; });
          var all = {}; Object.keys(mx).forEach(function (k) { all[k] = 1; }); Object.keys(my).forEach(function (k) { all[k] = 1; });
          Object.keys(all).forEach(function (k) {
            var p = path + '[' + o.keyField + '=' + k + ']';
            if (!(k in my)) out.push({ path: p, type: 'removed', old: mx[k] }); else if (!(k in mx)) out.push({ path: p, type: 'added', new: my[k] }); else walk(mx[k], my[k], p);
          });
        } else if (o.arrays === 'set') {
          var sx = x.map(function (v) { return JSON.stringify(canon(v)); }), sy = y.map(function (v) { return JSON.stringify(canon(v)); });
          x.forEach(function (v, i) { if (sy.indexOf(sx[i]) < 0) out.push({ path: path + '[' + i + ']', type: 'removed', old: v }); });
          y.forEach(function (v, i) { if (sx.indexOf(sy[i]) < 0) out.push({ path: path + '[' + i + ']', type: 'added', new: v }); });
        } else {
          var n = Math.max(x.length, y.length);
          for (var i = 0; i < n; i++) { var p2 = path + '[' + i + ']'; if (i >= y.length) out.push({ path: p2, type: 'removed', old: x[i] }); else if (i >= x.length) out.push({ path: p2, type: 'added', new: y[i] }); else walk(x[i], y[i], p2); }
        }
      } else if (x !== y && !(tx === 'number' && isNaN(x) && isNaN(y))) out.push({ path: path, type: 'changed', old: x, new: y });
    }
    walk(a, b, '$');
    return out;
  }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function canonicalJson(v) { return JSON.stringify(canon(v), null, 2); }

  // --------------------------------------------------------------------- CSV
  function detectDelimiter(text) {
    var head = text.split(/\r?\n/).slice(0, 10).join('\n');
    var best = ',', bestN = -1;
    [',', ';', '\t', '|'].forEach(function (d) { var n = (head.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length; if (n > bestN) { bestN = n; best = d; } });
    return best;
  }
  function parseCsv(text, delim) {
    delim = delim || detectDelimiter(text);
    var rows = [], row = [], cell = '', i = 0, q = false, n = text.length;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  }
  /** Keyed table diff. rowsA/rowsB are arrays of arrays with a header row. keyCol is an index or -1 for row order. */
  function tableDiff(rowsA, rowsB, keyCol) {
    var ha = rowsA[0] || [], hb = rowsB[0] || [];
    var cols = ha.slice(); hb.forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); });
    var colsAdded = hb.filter(function (c) { return ha.indexOf(c) < 0; }), colsRemoved = ha.filter(function (c) { return hb.indexOf(c) < 0; });
    function index(rows, hdr) {
      var m = {}, order = [];
      rows.slice(1).forEach(function (r, i) {
        var k = keyCol >= 0 ? String(r[keyCol] == null ? '' : r[keyCol]) : String(i);
        var obj = {}; hdr.forEach(function (c, j) { obj[c] = r[j] == null ? '' : String(r[j]); });
        if (!(k in m)) order.push(k);
        m[k] = obj;
      });
      return { m: m, order: order };
    }
    var A = index(rowsA, ha), B = index(rowsB, hb);
    var added = [], removed = [], changed = [], unchanged = 0;
    A.order.forEach(function (k) {
      if (!(k in B.m)) { removed.push({ key: k, row: A.m[k] }); return; }
      var cells = [];
      cols.forEach(function (c) { var x = A.m[k][c] == null ? '' : A.m[k][c], y = B.m[k][c] == null ? '' : B.m[k][c]; if (x !== y) cells.push({ col: c, old: x, new: y }); });
      if (cells.length) changed.push({ key: k, cells: cells, row: B.m[k] }); else unchanged++;
    });
    B.order.forEach(function (k) { if (!(k in A.m)) added.push({ key: k, row: B.m[k] }); });
    return { columns: cols, colsAdded: colsAdded, colsRemoved: colsRemoved, added: added, removed: removed, changed: changed, unchanged: unchanged, keyName: keyCol >= 0 ? ha[keyCol] : null };
  }

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
      var method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
      var name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.push(makeEntry(name, usize, csize, crc, method, loff));
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
  function isProbablyText(u8) {
    var n = Math.min(u8.length, 4000), ctl = 0;
    for (var i = 0; i < n; i++) { var c = u8[i]; if (c === 0) return false; if (c < 7 || (c > 13 && c < 32)) ctl++; }
    return ctl / Math.max(n, 1) < 0.05;
  }

  return { lineDiff: lineDiff, foldContext: foldContext, intraline: intraline, tokenize: tokenize, detectLang: detectLang, renderLine: renderLine, esc: esc,
    unifiedPatch: unifiedPatch, applyPatch: applyPatch, diff3: diff3, structuralDiff: structuralDiff, canonicalJson: canonicalJson, canon: canon,
    parseCsv: parseCsv, detectDelimiter: detectDelimiter, tableDiff: tableDiff, readZip: readZip, isProbablyText: isProbablyText, splitLines: splitLines, normalizeLine: normalizeLine, DEFAULT_OPTS: DEFAULT_OPTS };
});
