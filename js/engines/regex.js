/* Layerbit regex engine helpers. Pure functions, no DOM.
 *
 * parse(pattern, flags)   -> AST for ECMAScript regular expressions
 * explain(ast)            -> nested [{label, desc, children}] for the explanation panel
 * railroad(ast)           -> SVG markup of a railroad diagram
 * analyze(ast)            -> ReDoS findings: nested quantifiers, overlapping alternation,
 *                            adjacent overlapping repeats, with severity and advice
 * codegen(pattern, flags, lang) -> ready-to-paste snippet for 10 languages, with caveats
 * synthesize(positives, negatives) -> candidate patterns inferred from examples
 * runTests(pattern, flags, tests) -> per-test pass/fail
 *
 * Runs in the browser (window.LBRegex) and under Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBRegex = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ parser
  function parse(src, flags) {
    flags = flags || '';
    var i = 0, groupCount = 0, names = [];
    var unicode = flags.indexOf('u') >= 0 || flags.indexOf('v') >= 0;
    function peek(k) { return src[i + (k || 0)]; }
    function eof() { return i >= src.length; }
    function err(msg) { var e = new Error(msg + ' at position ' + i); e.pos = i; throw e; }

    function parseAlternation() {
      var start = i, branches = [parseSequence()];
      while (peek() === '|') { i++; branches.push(parseSequence()); }
      if (branches.length === 1) return branches[0];
      return { type: 'alt', branches: branches, start: start, end: i };
    }
    function parseSequence() {
      var start = i, items = [];
      while (!eof() && peek() !== '|' && peek() !== ')') items.push(parseQuantified());
      return { type: 'seq', items: items, start: start, end: i };
    }
    function parseQuantified() {
      var atom = parseAtom();
      var q = parseQuantifier();
      if (!q) return atom;
      if (atom.type === 'anchor' || atom.type === 'look') { if (atom.type === 'anchor') err('Nothing to repeat'); }
      q.child = atom; q.start = atom.start; q.end = i;
      return q;
    }
    function parseQuantifier() {
      var c = peek(), start = i, min, max;
      if (c === '*') { min = 0; max = Infinity; i++; }
      else if (c === '+') { min = 1; max = Infinity; i++; }
      else if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '{') {
        var m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (!m) return null;
        min = +m[1]; max = m[2] ? (m[3] === '' ? Infinity : +m[3]) : min;
        if (max < min) err('numbers out of order in {} quantifier');
        i += m[0].length;
      } else return null;
      var lazy = false;
      if (peek() === '?') { lazy = true; i++; }
      if (peek() === '*' || peek() === '+' || peek() === '?' || (peek() === '{' && /^\{\d+(,\d*)?\}/.test(src.slice(i)))) err('Nothing to repeat');
      return { type: 'quant', min: min, max: max, lazy: lazy, raw: src.slice(start, i) };
    }
    function parseAtom() {
      var c = peek(), start = i;
      if (c === '(') return parseGroup();
      if (c === '[') return parseClass();
      if (c === '.') { i++; return { type: 'dot', start: start, end: i }; }
      if (c === '^') { i++; return { type: 'anchor', kind: 'start', start: start, end: i }; }
      if (c === '$') { i++; return { type: 'anchor', kind: 'end', start: start, end: i }; }
      if (c === '\\') return parseEscape(false);
      if (c === ')') err('Unmatched \')\'');
      if (c === '*' || c === '+' || c === '?') err('Nothing to repeat');
      if (c === '{' && /^\{\d+(,\d*)?\}/.test(src.slice(i)) && unicode) err('Lone quantifier brackets');
      i++;
      return { type: 'char', value: c, start: start, end: i };
    }
    function parseGroup() {
      var start = i; i++; // (
      var node = { type: 'group', capture: true, start: start };
      if (peek() === '?') {
        i++;
        var c = peek();
        if (c === ':') { i++; node.capture = false; }
        else if (c === '=' || c === '!') { i++; node = { type: 'look', ahead: true, negative: c === '!', start: start }; }
        else if (c === '<' && (peek(1) === '=' || peek(1) === '!')) { node = { type: 'look', ahead: false, negative: peek(1) === '!', start: start }; i += 2; }
        else if (c === '<') { i++; var nm = ''; while (!eof() && peek() !== '>') nm += src[i++]; if (eof()) err('Invalid capture group name'); i++; if (!/^[A-Za-z_$][\w$]*$/.test(nm)) err('Invalid capture group name'); if (names.indexOf(nm) >= 0) err('Duplicate capture group name'); node.name = nm; names.push(nm); }
        else if (c === 'i' || c === 'm' || c === 's' || c === '-') { var mods = ''; while (!eof() && peek() !== ':' && peek() !== ')') mods += src[i++]; if (peek() !== ':') err('Invalid group'); i++; node.capture = false; node.modifiers = mods; }
        else err('Invalid group');
      }
      if (node.capture) node.index = ++groupCount;
      node.body = parseAlternation();
      if (peek() !== ')') err('Unterminated group');
      i++; node.end = i;
      return node;
    }
    function parseClass() {
      var start = i; i++;
      var node = { type: 'class', negate: false, items: [], start: start };
      if (peek() === '^') { node.negate = true; i++; }
      var first = true;
      while (!eof() && (peek() !== ']' || (first && false))) {
        first = false;
        var a = parseClassAtom();
        if (peek() === '-' && peek(1) !== ']' && peek(1) !== undefined) {
          i++;
          var b = parseClassAtom();
          if (a.type === 'char' && b.type === 'char') {
            if (cp(a.value) > cp(b.value)) err('Range out of order in character class');
            node.items.push({ type: 'range', from: a.value, to: b.value });
          } else { node.items.push(a); node.items.push({ type: 'char', value: '-' }); node.items.push(b); }
        } else node.items.push(a);
      }
      if (eof()) err('Unterminated character class');
      i++; node.end = i;
      return node;
    }
    function parseClassAtom() {
      if (peek() === '\\') return parseEscape(true);
      var ch = src[i++];
      return { type: 'char', value: ch };
    }
    function parseEscape(inClass) {
      var start = i; i++; // backslash
      if (eof()) err('\\ at end of pattern');
      var c = src[i++];
      var node = { start: start };
      if ('dDwWsS'.indexOf(c) >= 0) { node.type = 'set'; node.value = c; }
      else if (c === 'b' && !inClass) { node.type = 'anchor'; node.kind = 'wordb'; }
      else if (c === 'B' && !inClass) { node.type = 'anchor'; node.kind = 'nonwordb'; }
      else if (c === 'b' && inClass) { node.type = 'char'; node.value = '\b'; node.escaped = '\\b'; }
      else if (c === 'p' || c === 'P') {
        if (peek() !== '{') { if (unicode) err('Invalid property name'); node.type = 'char'; node.value = c; }
        else { var j = src.indexOf('}', i); if (j < 0) err('Invalid property name'); node.type = 'prop'; node.negate = c === 'P'; node.value = src.slice(i + 1, j); i = j + 1; if (!unicode) node.warn = 'needs the u flag'; }
      }
      else if (c === 'k' && peek() === '<' && !inClass) { var j2 = src.indexOf('>', i); if (j2 < 0) err('Invalid named reference'); node.type = 'backref'; node.name = src.slice(i + 1, j2); i = j2 + 1; }
      else if (/[1-9]/.test(c) && !inClass) { var num = c; while (/\d/.test(peek() || '')) num += src[i++]; node.type = 'backref'; node.index = +num; }
      else if (c === '0') { node.type = 'char'; node.value = '\0'; node.escaped = '\\0'; }
      else if (c === 'n') { node.type = 'char'; node.value = '\n'; node.escaped = '\\n'; }
      else if (c === 'r') { node.type = 'char'; node.value = '\r'; node.escaped = '\\r'; }
      else if (c === 't') { node.type = 'char'; node.value = '\t'; node.escaped = '\\t'; }
      else if (c === 'v') { node.type = 'char'; node.value = '\v'; node.escaped = '\\v'; }
      else if (c === 'f') { node.type = 'char'; node.value = '\f'; node.escaped = '\\f'; }
      else if (c === 'c' && /[A-Za-z]/.test(peek() || '')) { var l = src[i++]; node.type = 'char'; node.value = String.fromCharCode(l.toUpperCase().charCodeAt(0) - 64); node.escaped = '\\c' + l; }
      else if (c === 'x' && /^[0-9a-fA-F]{2}/.test(src.slice(i))) { node.type = 'char'; node.value = String.fromCharCode(parseInt(src.slice(i, i + 2), 16)); node.escaped = '\\x' + src.slice(i, i + 2); i += 2; }
      else if (c === 'u' && /^[0-9a-fA-F]{4}/.test(src.slice(i))) { node.type = 'char'; node.value = String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); node.escaped = '\\u' + src.slice(i, i + 4); i += 4; }
      else if (c === 'u' && peek() === '{' && unicode) { var j3 = src.indexOf('}', i); var hex = src.slice(i + 1, j3); if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) err('Invalid Unicode escape'); node.type = 'char'; node.value = String.fromCodePoint(parseInt(hex, 16)); node.escaped = '\\u{' + hex + '}'; i = j3 + 1; }
      else { if (unicode && /[A-Za-z0-9]/.test(c) && !(c === 'b' && inClass)) err('Invalid escape'); node.type = 'char'; node.value = c; node.escaped = '\\' + c; }
      node.end = i;
      return node;
    }
    function cp(s) { return s.codePointAt(0); }
    var ast = parseAlternation();
    if (!eof()) { if (peek() === ')') err('Unmatched \')\''); err('Unexpected character'); }
    ast.groupCount = groupCount; ast.names = names;
    return ast;
  }

  // ----------------------------------------------------------------- explain
  var SETS = { d: 'a digit 0-9', D: 'anything but a digit', w: 'a word character: letter, digit or underscore', W: 'anything but a word character', s: 'whitespace: space, tab, newline', S: 'anything but whitespace' };
  function charName(v, escaped) {
    if (escaped) return escaped;
    var map = { ' ': 'a space', '\n': 'a newline', '\t': 'a tab', '\r': 'a carriage return', '.': 'a literal dot', '-': 'a hyphen' };
    return map[v] || JSON.stringify(v).slice(1, -1).replace(/^"|"$/g, '') && ('"' + v + '"');
  }
  function describeClassItem(it) {
    if (it.type === 'range') return it.from + '-' + it.to + ' (' + it.from.codePointAt(0) + '…' + it.to.codePointAt(0) + ')';
    if (it.type === 'set') return '\\' + it.value + ' ' + SETS[it.value];
    if (it.type === 'prop') return '\\p{' + it.value + '}';
    return charName(it.value, it.escaped);
  }
  function quantDesc(q) {
    var r;
    if (q.min === 0 && q.max === Infinity) r = 'zero or more times';
    else if (q.min === 1 && q.max === Infinity) r = 'one or more times';
    else if (q.min === 0 && q.max === 1) r = 'optionally (zero or one time)';
    else if (q.max === Infinity) r = 'at least ' + q.min + ' times';
    else if (q.min === q.max) r = 'exactly ' + q.min + ' time' + (q.min === 1 ? '' : 's');
    else r = 'between ' + q.min + ' and ' + q.max + ' times';
    return r + (q.lazy ? ', as few as possible (lazy)' : q.max > q.min ? ', as many as possible (greedy)' : '');
  }
  function explain(node) {
    if (!node) return [];
    switch (node.type) {
      case 'alt': return [{ label: 'Alternation', desc: 'match any one of ' + node.branches.length + ' alternatives, tried left to right', children: node.branches.map(function (b, i) { return { label: 'Alternative ' + (i + 1), desc: '', children: explain(b) }; }) }];
      case 'seq': return node.items.length ? [].concat.apply([], node.items.map(explain)) : [{ label: '(empty)', desc: 'matches the empty string' }];
      case 'group': return [{ label: node.capture ? (node.name ? 'Named group <' + node.name + '>' : 'Capture group #' + node.index) : (node.modifiers ? 'Modifier group (?' + node.modifiers + ':…)' : 'Non-capturing group'), desc: node.capture ? 'captured as $' + (node.name ? '<' + node.name + '>' : node.index) : 'groups without capturing', children: explain(node.body) }];
      case 'look': return [{ label: (node.negative ? 'Negative ' : 'Positive ') + (node.ahead ? 'lookahead' : 'lookbehind'), desc: 'asserts that what ' + (node.ahead ? 'follows' : 'precedes') + (node.negative ? ' does not match' : ' matches') + ', without consuming it', children: explain(node.body) }];
      case 'quant': return [{ label: 'Repeat ' + node.raw, desc: quantDesc(node), children: explain(node.child) }];
      case 'class': return [{ label: (node.negate ? 'Negated character class' : 'Character class') + ' ' + '[' + (node.negate ? '^' : '') + '…]', desc: (node.negate ? 'one character NOT in: ' : 'one character from: ') + node.items.map(describeClassItem).join(', ') }];
      case 'char': return [{ label: node.escaped || node.value, desc: 'the literal character ' + charName(node.value, node.escaped) }];
      case 'dot': return [{ label: '.', desc: 'any character except line terminators (any character at all with the s flag)' }];
      case 'set': return [{ label: '\\' + node.value, desc: SETS[node.value] }];
      case 'prop': return [{ label: '\\' + (node.negate ? 'P' : 'p') + '{' + node.value + '}', desc: (node.negate ? 'any character without' : 'any character with') + ' the Unicode property ' + node.value + (node.warn ? ' (' + node.warn + ')' : '') }];
      case 'anchor': return [{ label: { start: '^', end: '$', wordb: '\\b', nonwordb: '\\B' }[node.kind], desc: { start: 'start of input (start of a line with the m flag)', end: 'end of input (end of a line with the m flag)', wordb: 'a word boundary: between a word character and a non-word character', nonwordb: 'not a word boundary' }[node.kind] }];
      case 'backref': return [{ label: node.name ? '\\k<' + node.name + '>' : '\\' + node.index, desc: 'the same text that group ' + (node.name ? '<' + node.name + '>' : '#' + node.index) + ' matched' }];
    }
    return [{ label: node.type, desc: '' }];
  }

  // ---------------------------------------------------------------- railroad
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function textW(s) { return Math.max(14, s.length * 7.6 + 16); }
  // every layout returns {w, h, y (baseline from top), draw(x, y0) -> svg}
  function box(label, cls, title) {
    var w = textW(label), h = 26;
    return { w: w, h: h, y: 13, draw: function (x, y) { return '<g class="rr ' + cls + '"><rect x="' + x + '" y="' + (y - 13) + '" width="' + w + '" height="26" rx="' + (cls === 'rr-term' ? 13 : 4) + '"/><text x="' + (x + w / 2) + '" y="' + (y + 4) + '" text-anchor="middle">' + esc(label) + '</text>' + (title ? '<title>' + esc(title) + '</title>' : '') + '</g>'; } };
  }
  function seqLayout(items) {
    if (!items.length) return { w: 20, h: 10, y: 5, draw: function (x, y) { return line(x, y, x + 20, y); } };
    var w = 0, above = 0, below = 0;
    items.forEach(function (it, k) { w += it.w + (k ? 14 : 0); above = Math.max(above, it.y); below = Math.max(below, it.h - it.y); });
    return { w: w, h: above + below, y: above, draw: function (x, y) { var s = '', cx = x; items.forEach(function (it, k) { if (k) { s += line(cx, y, cx + 14, y); cx += 14; } s += it.draw(cx, y); cx += it.w; }); return s; } };
  }
  function altLayout(branches) {
    var w = Math.max.apply(null, branches.map(function (b) { return b.w; })) + 40, h = 0;
    branches.forEach(function (b, k) { h += b.h + (k ? 10 : 0); });
    var first = branches[0];
    return { w: w, h: h, y: first.y, draw: function (x, y) {
      var s = '', cy = y - first.y;
      branches.forEach(function (b, k) {
        var by = cy + b.y, bx = x + 20 + (w - 40 - b.w) / 2;
        if (k === 0) { s += line(x, y, bx, by) + line(bx + b.w, by, x + w, y); }
        else { s += path('M' + x + ',' + y + ' q10,0 10,10 V' + (by - 10) + ' q0,10 10,10 H' + bx) + path('M' + (bx + b.w) + ',' + by + ' H' + (x + w - 20) + ' q10,0 10,-10 V' + (y + 10) + ' q0,-10 10,-10'); }
        s += b.draw(bx, by); cy += b.h + 10;
      });
      return s; } };
  }
  function quantLayout(inner, q) {
    var w = inner.w + 40, loop = q.max > 1 || q.max === Infinity, skip = q.min === 0;
    var h = inner.h + (loop ? 16 : 0) + (skip ? 16 : 0), y = inner.y + (skip ? 16 : 0);
    var lbl = q.raw + (q.lazy ? ' lazy' : '');
    return { w: w, h: h, y: y, draw: function (x, y0) {
      var ix = x + 20, s = line(x, y0, ix, y0) + inner.draw(ix, y0) + line(ix + inner.w, y0, x + w, y0);
      if (loop) { var by = y0 + (inner.h - inner.y) + 8; s += path('M' + (ix + inner.w + 10) + ',' + y0 + ' q10,0 10,10 V' + (by - 10) + ' q0,10 -10,10 H' + (ix - 0) + ' q-10,0 -10,-10 V' + (y0 + 10) + ' q0,-10 10,-10') + '<text class="rr-q" x="' + (x + w / 2) + '" y="' + (by + 12) + '" text-anchor="middle">' + esc(lbl) + '</text>'; }
      if (skip) { var ty = y0 - inner.y - 8; s += path('M' + x + ',' + y0 + ' q10,0 10,-10 V' + (ty + 10) + ' q0,-10 10,-10 H' + (x + w - 20) + ' q10,0 10,10 V' + (y0 - 10) + ' q0,10 10,10'); if (!loop) s += '<text class="rr-q" x="' + (x + w / 2) + '" y="' + (ty - 3) + '" text-anchor="middle">' + esc(lbl) + '</text>'; }
      return s; } };
  }
  function groupLayout(inner, label, cls) {
    var w = inner.w + 24, h = inner.h + 30, y = inner.y + 20;
    return { w: w, h: h, y: y, draw: function (x, y0) { return '<g class="rr-group ' + cls + '"><rect x="' + (x + 4) + '" y="' + (y0 - inner.y - 8) + '" width="' + (w - 8) + '" height="' + (inner.h + 16) + '" rx="6"/><text x="' + (x + 8) + '" y="' + (y0 - inner.y - 12) + '">' + esc(label) + '</text></g>' + line(x, y0, x + 12, y0) + inner.draw(x + 12, y0) + line(x + 12 + inner.w, y0, x + w, y0); } };
  }
  function line(x1, y1, x2, y2) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>'; }
  function path(d) { return '<path d="' + d + '" fill="none"/>'; }
  function layout(node) {
    switch (node.type) {
      case 'alt': return altLayout(node.branches.map(layout));
      case 'seq': return seqLayout(node.items.map(layout));
      case 'group': return groupLayout(layout(node.body), node.capture ? (node.name ? '<' + node.name + '>' : 'group ' + node.index) : (node.modifiers ? '(?' + node.modifiers + ':)' : 'non-capturing'), node.capture ? 'rr-cap' : 'rr-noncap');
      case 'look': return groupLayout(layout(node.body), (node.negative ? 'negative ' : '') + (node.ahead ? 'lookahead' : 'lookbehind'), 'rr-look');
      case 'quant': return quantLayout(layout(node.child), node);
      case 'class': return box('[' + (node.negate ? '^' : '') + node.items.map(function (it) { return it.type === 'range' ? it.from + '-' + it.to : it.type === 'set' ? '\\' + it.value : it.type === 'prop' ? '\\p{' + it.value + '}' : (it.escaped || it.value); }).join('') + ']', 'rr-class', explain(node)[0].desc);
      case 'char': return box(node.escaped || ({ ' ': '\u2423', '\n': '\u23ce', '\t': '\u21e5' }[node.value] || node.value), 'rr-term', explain(node)[0].desc);
      case 'dot': return box('any char', 'rr-nonterm', explain(node)[0].desc);
      case 'set': return box('\\' + node.value, 'rr-nonterm', SETS[node.value]);
      case 'prop': return box('\\' + (node.negate ? 'P' : 'p') + '{' + node.value + '}', 'rr-nonterm');
      case 'anchor': return box({ start: '^ start', end: 'end $', wordb: '\\b', nonwordb: '\\B' }[node.kind], 'rr-anchor', explain(node)[0].desc);
      case 'backref': return box(node.name ? '\\k<' + node.name + '>' : '\\' + node.index, 'rr-nonterm', explain(node)[0].desc);
    }
    return box(node.type, 'rr-nonterm');
  }
  function railroad(ast) {
    var l = layout(ast), pad = 20, w = l.w + pad * 2 + 40, h = l.h + pad * 2;
    var y = pad + l.y;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" class="railroad" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<circle cx="' + (pad) + '" cy="' + y + '" r="5" class="rr-end"/>' + line(pad + 5, y, pad + 20, y) + l.draw(pad + 20, y) + line(pad + 20 + l.w, y, w - pad - 5, y) + '<circle cx="' + (w - pad) + '" cy="' + y + '" r="5" class="rr-end"/></svg>';
    return s;
  }

  // ---------------------------------------------------------------- analysis
  // First-character set approximation: returns {any:true} or {chars:Set, sets:[..], negate} merged into a tester fn
  function firstSet(node) {
    switch (node.type) {
      case 'seq': { var out = { items: [], nullable: true }; for (var k = 0; k < node.items.length; k++) { var f = firstSet(node.items[k]); out.items = out.items.concat(f.items); if (!f.nullable) { out.nullable = false; break; } } return out; }
      case 'alt': { var o = { items: [], nullable: false }; node.branches.forEach(function (b) { var f = firstSet(b); o.items = o.items.concat(f.items); if (f.nullable) o.nullable = true; }); return o; }
      case 'group': return firstSet(node.body);
      case 'look': case 'anchor': return { items: [], nullable: true };
      case 'quant': { var fq = firstSet(node.child); return { items: fq.items, nullable: fq.nullable || node.min === 0 }; }
      case 'backref': return { items: [{ any: true }], nullable: true };
      default: return { items: [node], nullable: false };
    }
  }
  function matchesChar(item, ch) {
    if (item.any) return true;
    switch (item.type) {
      case 'char': return item.value === ch;
      case 'dot': return ch !== '\n';
      case 'set': return setTest(item.value, ch);
      case 'prop': return true;
      case 'class': { var hit = item.items.some(function (it) { return it.type === 'range' ? (ch >= it.from && ch <= it.to) : it.type === 'set' ? setTest(it.value, ch) : it.type === 'prop' ? true : it.value === ch; }); return item.negate ? !hit : hit; }
    }
    return false;
  }
  function setTest(v, ch) { var t = { d: /\d/, D: /\D/, w: /\w/, W: /\W/, s: /\s/, S: /\S/ }[v]; return t.test(ch); }
  var PROBE = 'aAzZ09_ -.,:;/\\@#!?\n\t"\'()[]{}<>=+*%$&|^~`éß日';
  function overlap(a, b) {
    for (var i = 0; i < PROBE.length; i++) { var ch = PROBE[i]; if (a.some(function (x) { return matchesChar(x, ch); }) && b.some(function (x) { return matchesChar(x, ch); })) return ch; }
    return null;
  }
  function hasUnboundedQuant(node) {
    if (!node) return false;
    if (node.type === 'quant' && (node.max === Infinity || node.max > 10)) return true;
    var kids = node.type === 'seq' ? node.items : node.type === 'alt' ? node.branches : node.body ? [node.body] : node.child ? [node.child] : [];
    return kids.some(hasUnboundedQuant);
  }
  function src(node, pattern) { return pattern.slice(node.start, node.end); }
  function analyze(ast, pattern) {
    var findings = [];
    function walk(node, insideQuant) {
      if (!node) return;
      if (node.type === 'quant') {
        var unbounded = node.max === Infinity || node.max > 10;
        if (unbounded && hasUnboundedQuant(node.child)) {
          findings.push({ severity: 'high', kind: 'nested', at: src(node, pattern), msg: 'Nested unbounded quantifier: ' + src(node, pattern), advice: 'A repeat inside a repeat lets the engine divide the same input between the two in exponentially many ways. Collapse it (e.g. (a+)+ → a+) or make the inner and outer parts unable to match the same characters.' });
        }
        // alternation under a quantifier with overlapping branches
        var body = node.child.type === 'group' ? node.child.body : node.child;
        if (unbounded && body.type === 'alt') {
          for (var i = 0; i < body.branches.length; i++) for (var j = i + 1; j < body.branches.length; j++) {
            var o = overlap(firstSet(body.branches[i]).items, firstSet(body.branches[j]).items);
            if (o !== null) { findings.push({ severity: 'high', kind: 'overlap-alt', at: src(node, pattern), msg: 'Overlapping alternatives repeated: ' + src(node, pattern) + ' (branches ' + (i + 1) + ' and ' + (j + 1) + ' can both start with ' + JSON.stringify(o) + ')', advice: 'When two alternatives can match the same text, every repetition doubles the ways to match. Make the branches mutually exclusive or merge them into one character class.' }); i = j = 99; }
          }
        }
      }
      if (node.type === 'seq') {
        for (var k = 0; k < node.items.length - 1; k++) {
          var a = node.items[k], b = node.items[k + 1];
          if (a.type === 'quant' && (a.max === Infinity || a.max > 10)) {
            var fa = firstSet(a.child).items, fb = firstSet(b).items;
            var o2 = overlap(fa, fb);
            if (o2 !== null && b.type === 'quant' && (b.max === Infinity || b.max > 10)) {
              findings.push({ severity: insideQuant ? 'high' : 'medium', kind: 'adjacent', at: src(a, pattern) + src(b, pattern), msg: 'Adjacent repeats that can match the same characters: ' + src(a, pattern) + ' followed by ' + src(b, pattern) + ' (both accept ' + JSON.stringify(o2) + ')', advice: 'The boundary between the two repeats is ambiguous, so a non-matching input makes the engine try every split: quadratic time, exponential if this sits inside another repeat. Add a required separator between them or make their character sets disjoint.' });
            }
          }
        }
      }
      var kids = node.type === 'seq' ? node.items : node.type === 'alt' ? node.branches : node.body ? [node.body] : node.child ? [node.child] : [];
      kids.forEach(function (kid) { walk(kid, insideQuant || (node.type === 'quant' && (node.max === Infinity || node.max > 10))); });
    }
    walk(ast, false);
    // dedupe by message
    var seen = {}; findings = findings.filter(function (f) { if (seen[f.msg]) return false; seen[f.msg] = 1; return true; });
    var worst = findings.some(function (f) { return f.severity === 'high'; }) ? 'high' : findings.length ? 'medium' : 'none';
    return { findings: findings, severity: worst, unanchored: !(ast.type === 'seq' && ast.items[0] && ast.items[0].type === 'anchor') };
  }

  // ----------------------------------------------------------------- codegen
  var LANGS = ['javascript', 'typescript', 'python', 'go', 'java', 'csharp', 'php', 'ruby', 'rust', 'shell'];
  function codegen(pattern, flags, lang, subject) {
    var g = flags.indexOf('g') >= 0, i = flags.indexOf('i') >= 0, m = flags.indexOf('m') >= 0, s = flags.indexOf('s') >= 0, u = flags.indexOf('u') >= 0;
    var caveats = [];
    var lookbehind = /\(\?<[=!]/.test(pattern), named = /\(\?<[A-Za-z]/.test(pattern), prop = /\\[pP]\{/.test(pattern), backref = /\\[1-9]|\\k</.test(pattern);
    var subj = subject && subject.length < 200 ? subject : 'your text here';
    var code;
    switch (lang) {
      case 'javascript': case 'typescript':
        code = 'const re = /' + pattern.replace(/\//g, '\\/') + '/' + flags + ';\n' + (lang === 'typescript' ? 'const text: string = ' : 'const text = ') + JSON.stringify(subj) + ';\n' + (g ? 'for (const m of text.matchAll(re)) {\n  console.log(m[0], m.index' + (named ? ', m.groups' : '') + ');\n}' : 'const m = text.match(re);\nif (m) console.log(m[0]' + (named ? ', m.groups' : '') + ');'); break;
      case 'python': {
        var pf = []; if (i) pf.push('re.IGNORECASE'); if (m) pf.push('re.MULTILINE'); if (s) pf.push('re.DOTALL');
        var py = pattern.replace(/\(\?<([A-Za-z_]\w*)>/g, '(?P<$1>').replace(/\\k<([A-Za-z_]\w*)>/g, '(?P=$1)');
        code = 'import re\n\npattern = re.compile(r' + pyRaw(py) + (pf.length ? ', ' + pf.join(' | ') : '') + ')\ntext = ' + JSON.stringify(subj) + '\n' + (g ? 'for m in pattern.finditer(text):\n    print(m.group(0), m.start()' + (named ? ', m.groupdict()' : '') + ')' : 'm = pattern.search(text)\nif m:\n    print(m.group(0)' + (named ? ', m.groupdict()' : '') + ')');
        if (named) caveats.push('Named groups use (?P<name>…) in Python; converted above.');
        if (prop) caveats.push("Python's re has no \\p{…}; install the `regex` module for Unicode properties.");
        break; }
      case 'go': {
        var gf = (i ? 'i' : '') + (m ? 'm' : '') + (s ? 's' : '');
        code = 'package main\n\nimport (\n\t"fmt"\n\t"regexp"\n)\n\nfunc main() {\n\tre := regexp.MustCompile(`' + (gf ? '(?' + gf + ')' : '') + pattern.replace(/`/g, '` + "`" + `') + '`)\n\ttext := ' + JSON.stringify(subj) + '\n' + (g ? '\tfor _, m := range re.FindAllStringSubmatch(text, -1) {\n\t\tfmt.Println(m[0])\n\t}' : '\tif m := re.FindStringSubmatch(text); m != nil {\n\t\tfmt.Println(m[0])\n\t}') + '\n}';
        if (lookbehind) caveats.push('Go (RE2) does not support lookbehind; this pattern will not compile there.');
        if (/\(\?[=!]/.test(pattern)) caveats.push('Go (RE2) does not support lookahead; this pattern will not compile there.');
        if (backref) caveats.push('Go (RE2) does not support backreferences.');
        if (named) caveats.push('Go names groups as (?P<name>…); (?<name>…) is accepted since Go 1.22.');
        break; }
      case 'java': {
        var jf = []; if (i) jf.push('Pattern.CASE_INSENSITIVE'); if (m) jf.push('Pattern.MULTILINE'); if (s) jf.push('Pattern.DOTALL'); if (u && i) jf.push('Pattern.UNICODE_CASE');
        code = 'import java.util.regex.*;\n\nPattern p = Pattern.compile(' + JSON.stringify(pattern) + (jf.length ? ', ' + jf.join(' | ') : '') + ');\nMatcher m = p.matcher(' + JSON.stringify(subj) + ');\n' + (g ? 'while (m.find()) {\n    System.out.println(m.group()' + (named ? ' + " " + m.group("name")' : '') + ');\n}' : 'if (m.find()) {\n    System.out.println(m.group());\n}');
        if (named) caveats.push('Java named groups must be alphanumeric (no underscore).');
        break; }
      case 'csharp': {
        var cf = []; if (i) cf.push('RegexOptions.IgnoreCase'); if (m) cf.push('RegexOptions.Multiline'); if (s) cf.push('RegexOptions.Singleline');
        code = 'using System.Text.RegularExpressions;\n\nvar re = new Regex(@"' + pattern.replace(/"/g, '""') + '"' + (cf.length ? ', ' + cf.join(' | ') : '') + ');\nvar text = ' + JSON.stringify(subj) + ';\n' + (g ? 'foreach (Match m in re.Matches(text))\n{\n    Console.WriteLine(m.Value' + (named ? ' + " " + m.Groups["name"].Value' : '') + ');\n}' : 'var m = re.Match(text);\nif (m.Success) Console.WriteLine(m.Value);');
        if (prop) caveats.push('.NET supports \\p{L}-style categories but not \\p{Script=…}.');
        break; }
      case 'php': {
        var delim = pattern.indexOf('~') < 0 ? '~' : '#';
        code = '<?php\n$re = \'' + delim + pattern.replace(/'/g, "\\'") + delim + (i ? 'i' : '') + (m ? 'm' : '') + (s ? 's' : '') + (u ? 'u' : '') + '\';\n$text = ' + JSON.stringify(subj) + ';\n' + (g ? 'if (preg_match_all($re, $text, $matches, PREG_SET_ORDER)) {\n    foreach ($matches as $m) {\n        echo $m[0], "\\n";\n    }\n}' : 'if (preg_match($re, $text, $m)) {\n    echo $m[0];\n}');
        break; }
      case 'ruby':
        code = 're = /' + pattern.replace(/\//g, '\\/') + '/' + (i ? 'i' : '') + (s ? 'm' : '') + '\ntext = ' + JSON.stringify(subj) + '\n' + (g ? 'text.scan(re) { |m| puts $~[0] }' : 'if (m = re.match(text))\n  puts m[0]\nend');
        if (m) caveats.push("Ruby's ^ and $ are always line anchors; use \\A and \\z for string anchors.");
        if (s) caveats.push("Ruby's /m is JavaScript's /s (dot matches newline).");
        break;
      case 'rust': {
        var rf = (i ? 'i' : '') + (m ? 'm' : '') + (s ? 's' : '');
        code = 'use regex::Regex;\n\nlet re = Regex::new(r"' + (rf ? '(?' + rf + ')' : '') + pattern.replace(/"/g, '\\"') + '").unwrap();\nlet text = ' + JSON.stringify(subj) + ';\n' + (g ? 'for m in re.find_iter(text) {\n    println!("{}", m.as_str());\n}' : 'if let Some(m) = re.find(text) {\n    println!("{}", m.as_str());\n}');
        if (lookbehind || /\(\?[=!]/.test(pattern)) caveats.push('The Rust regex crate has no lookaround; use fancy-regex for this pattern.');
        if (backref) caveats.push('The Rust regex crate has no backreferences; use fancy-regex.');
        break; }
      case 'shell':
        code = '# grep with Perl-compatible syntax (closest to JavaScript)\ngrep -P' + (i ? 'i' : '') + (g ? 'o' : '') + ' ' + shQuote(pattern) + ' file.txt\n\n# sed substitution (extended regex; no lookaround, no \\d — use [0-9])\nsed -E ' + shQuote('s/' + pattern.replace(/\//g, '\\/') + '/REPLACEMENT/' + (g ? 'g' : '') + (i ? 'I' : '')) + ' file.txt';
        caveats.push('sed/grep -E (POSIX ERE) lack \\d, \\w, lookaround and non-greedy quantifiers; grep -P (PCRE) supports them.');
        break;
      default: code = '';
    }
    if (u && lang !== 'javascript' && lang !== 'typescript' && lang !== 'php') caveats.push('The u flag has no direct equivalent; most engines are Unicode-aware by default.');
    return { code: code, caveats: caveats };
  }
  function pyRaw(p) { return p.indexOf("'") < 0 ? "'" + p + "'" : p.indexOf('"') < 0 ? '"' + p + '"' : "'''" + p + "'''"; }
  function shQuote(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

  // -------------------------------------------------------------- unit tests
  function runTests(pattern, flags, tests) {
    var re;
    try { re = new RegExp(pattern, flags.replace('g', '')); } catch (e) { return tests.map(function (t) { return { test: t, ok: false, error: e.message }; }); }
    return tests.map(function (t) {
      var m = re.exec(t.input);
      var ok = t.expect === 'match' ? !!m : t.expect === 'nomatch' ? !m : t.expect === 'full' ? (!!m && m[0] === t.input) : !!m;
      var detail = m ? m[0] : null;
      if (ok && t.group !== undefined && t.group !== '' && m) { var g = isNaN(+t.group) ? (m.groups && m.groups[t.group]) : m[+t.group]; ok = g === t.value; detail = g; }
      return { test: t, ok: ok, matched: !!m, detail: detail };
    });
  }

  // --------------------------------------------------------------- synthesis
  function classify(ch) {
    if (/\d/.test(ch)) return 'd';
    if (/[a-z]/.test(ch)) return 'l';
    if (/[A-Z]/.test(ch)) return 'U';
    if (/\s/.test(ch)) return 's';
    if (/[^\x00-\x7F]/.test(ch)) return 'x';
    return ch; // punctuation is its own class (literal)
  }
  function tokens(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = classify(str[i]);
      var last = out[out.length - 1];
      if (last && last.c === c && c.length === 1 && 'dlUsx'.indexOf(c) >= 0) { last.n++; last.text += str[i]; }
      else out.push({ c: c, n: 1, text: str[i] });
    }
    return out;
  }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }
  function classRe(c, min, max, strict) {
    var base = { d: '\\d', l: strict ? '[a-z]' : '[a-zA-Z]', U: strict ? '[A-Z]' : '[a-zA-Z]', s: '\\s', x: '[^\\x00-\\x7F]' }[c];
    if (!base) return reEsc(c);
    var q = min === max ? (min === 1 ? '' : '{' + min + '}') : max === Infinity ? (min <= 1 ? (min === 0 ? '*' : '+') : '{' + min + ',}') : '{' + min + ',' + max + '}';
    return base + q;
  }
  function synthesize(positives, negatives) {
    positives = positives.filter(function (s) { return s.length; }); negatives = negatives || [];
    if (!positives.length) return [];
    var cands = [];
    function add(name, pat, note) { if (cands.some(function (c) { return c.pattern === pat; })) return; cands.push({ name: name, pattern: pat, note: note }); }
    // 1. literal alternation
    add('Exact alternatives', '^(?:' + positives.map(reEsc).join('|') + ')$', 'Matches only the examples given.');
    // 2. token-shape patterns if all examples share a token-class sequence
    var toks = positives.map(tokens);
    var shapes = toks.map(function (t) { return t.map(function (x) { return x.c; }).join('\u0001'); });
    var sameShape = shapes.every(function (s) { return s === shapes[0]; });
    if (sameShape) {
      var merged = toks[0].map(function (t, k) { return { c: t.c, min: t.n, max: t.n, texts: [t.text] }; });
      toks.slice(1).forEach(function (t) { t.forEach(function (x, k) { merged[k].min = Math.min(merged[k].min, x.n); merged[k].max = Math.max(merged[k].max, x.n); merged[k].texts.push(x.text); }); });
      var exact = merged.map(function (m) { return m.texts.every(function (t) { return t === m.texts[0]; }) ? reEsc(m.texts[0]) : classRe(m.c, m.min, m.max, true); }).join('');
      add('Same shape, exact lengths', '^' + exact + '$', 'Each run keeps the length range seen in the examples; shared literal runs are kept verbatim.');
      var loose = merged.map(function (m) { return m.texts.every(function (t) { return t === m.texts[0]; }) && 'dlUsx'.indexOf(m.c) < 0 ? reEsc(m.texts[0]) : classRe(m.c, Math.min(1, m.min), Infinity, false); }).join('');
      add('Same shape, any length', '^' + loose + '$', 'Letters are case-insensitive classes and every run may be any length.');
      add('Same shape, unanchored', loose, 'Finds the shape anywhere in a larger text (use with the g flag).');
    } else {
      // generic: common prefix/suffix + wildcard
      var pre = commonPrefix(positives), suf = commonSuffix(positives.map(function (s) { return s.slice(pre.length); }));
      if (pre.length + suf.length >= 2) add('Common prefix and suffix', '^' + reEsc(pre) + '.*' + reEsc(suf) + '$', 'The examples do not share a shape; this keeps what they do share.');
      var allShape = positives.map(function (s) { return tokens(s).map(function (t) { return classRe(t.c, 1, Infinity, false); }).join(''); });
      add('Any of the shapes', '^(?:' + unique(allShape).join('|') + ')$', 'One alternative per distinct shape in the examples.');
    }
    // score
    cands.forEach(function (c) {
      var re; try { re = new RegExp(c.pattern); } catch (e) { c.ok = false; c.error = e.message; return; }
      c.posOk = positives.filter(function (p) { return re.test(p); }).length;
      c.negOk = negatives.filter(function (n) { return !re.test(n); }).length;
      c.ok = c.posOk === positives.length && c.negOk === negatives.length;
      c.score = (c.ok ? 1000 : 0) + c.posOk * 10 + c.negOk * 10 - c.pattern.length / 20 + (c.name.indexOf('Exact alternatives') === 0 ? -50 : 0);
    });
    cands.sort(function (a, b) { return b.score - a.score; });
    return cands;
  }
  function commonPrefix(a) { var p = a[0]; a.forEach(function (s) { var k = 0; while (k < p.length && k < s.length && p[k] === s[k]) k++; p = p.slice(0, k); }); return p; }
  function commonSuffix(a) { var p = a[0]; a.forEach(function (s) { var k = 0; while (k < p.length && k < s.length && p[p.length - 1 - k] === s[s.length - 1 - k]) k++; p = p.slice(p.length - k); }); return p; }
  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  return { parse: parse, explain: explain, railroad: railroad, analyze: analyze, codegen: codegen, LANGS: LANGS, runTests: runTests, synthesize: synthesize, esc: esc };
});
