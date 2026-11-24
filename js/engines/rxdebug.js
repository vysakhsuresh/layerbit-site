/* Layerbit regex debugger: a backtracking matcher over LBRegex.parse()'s AST
 * that records every step, so a page can replay how a JavaScript regex finds
 * (or fails to find) a match. Pure functions, no DOM. Browser and Node.
 *
 * trace(ast, flags, text, {maxSteps, from}) ->
 *   { steps: [{kind, start, end, pos, note}], match: {start, end, groups} | null,
 *     stopped: bool, backtracks: n }
 *   kind: 'begin' (an attempt at a start position), 'try' (a token at pos), 'ok', 'fail',
 *         'backtrack' (giving up an iteration or trying the next alternative), 'success'
 *   start/end locate the token in the pattern source.
 * Follows ECMAScript semantics for the constructs the parser produces: characters,
 * classes, \d\w\s, ., anchors, \b, groups, named groups, alternation, greedy and lazy
 * quantifiers (with the empty-iteration rule), backreferences and lookaround.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBRxDebug = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LT = /[\n\r\u2028\u2029]/;
  var SETS = { d: /\d/, D: /\D/, w: /\w/, W: /\W/, s: /\s/, S: /\S/ };
  function Stop() {}

  function trace(ast, flags, text, opts) {
    opts = opts || {};
    var maxSteps = opts.maxSteps || 100000, steps = [], backtracks = 0;
    var ci = flags.indexOf('i') >= 0, multi = flags.indexOf('m') >= 0, dotAll = flags.indexOf('s') >= 0, uni = flags.indexOf('u') >= 0;
    function rec(kind, node, pos, note) { if (steps.length >= maxSteps) throw new Stop(); steps.push({ kind: kind, start: node && node.start, end: node && node.end, pos: pos, note: note || '' }); }
    var fold = function (c) { return ci ? c.toLowerCase() : c; };
    function eqChar(a, b) { return a === b || (ci && (a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase())); }
    function classItem(it, ch) {
      if (it.type === 'char') return eqChar(it.value, ch);
      if (it.type === 'range') { var c = ch.codePointAt(0), lo = it.from.codePointAt(0), hi = it.to.codePointAt(0); if (c >= lo && c <= hi) return true; if (!ci) return false; var l = ch.toLowerCase().codePointAt(0), u = ch.toUpperCase().codePointAt(0); return (l >= lo && l <= hi) || (u >= lo && u <= hi); }
      if (it.type === 'set') return SETS[it.value].test(ch);
      if (it.type === 'prop') { try { return new RegExp('\\' + (it.negate ? 'P' : 'p') + '{' + it.value + '}', 'u').test(ch); } catch (e) { return false; } }
      return false;
    }
    function isWord(p) { return p >= 0 && p < text.length && /\w/.test(text[p]); }
    // m(node, pos, caps, k): try node at pos, then continuation k(newPos, caps)
    function m(node, pos, caps, k) {
      switch (node.type) {
        case 'seq': return seq(node.items, 0, pos, caps, k);
        case 'alt':
          for (var b = 0; b < node.branches.length; b++) {
            if (b) { backtracks++; rec('backtrack', node.branches[b], pos, 'try alternative ' + (b + 1)); }
            if (m(node.branches[b], pos, caps, k)) return true;
          }
          return false;
        case 'char': case 'dot': case 'set': case 'class': case 'prop': {
          rec('try', node, pos);
          var ch = text[pos], ok = false;
          if (pos < text.length) {
            if (node.type === 'char') ok = eqChar(node.value, ch);
            else if (node.type === 'dot') ok = dotAll || !LT.test(ch);
            else if (node.type === 'set') ok = SETS[node.value].test(ch);
            else if (node.type === 'prop') ok = classItem(node, ch);
            else { ok = node.items.some(function (it) { return classItem(it, ch); }); if (node.negate) ok = !ok; }
          }
          if (!ok) { rec('fail', node, pos); return false; }
          rec('ok', node, pos + 1);
          return k(pos + 1, caps);
        }
        case 'anchor': {
          rec('try', node, pos);
          var ok2 = node.kind === 'start' ? pos === 0 || (multi && LT.test(text[pos - 1])) :
            node.kind === 'end' ? pos === text.length || (multi && LT.test(text[pos])) :
            node.kind === 'wordb' ? isWord(pos - 1) !== isWord(pos) : isWord(pos - 1) === isWord(pos);
          if (!ok2) { rec('fail', node, pos); return false; }
          rec('ok', node, pos);
          return k(pos, caps);
        }
        case 'group': {
          if (!node.capture) return m(node.body, pos, caps, k);
          return m(node.body, pos, caps, function (p2, c2) { var c3 = c2.slice(); c3[node.index] = [pos, p2]; return k(p2, c3); });
        }
        case 'look': {
          rec('try', node, pos, (node.ahead ? 'look-ahead' : 'look-behind') + (node.negative ? ', negative' : ''));
          var found = null;
          if (node.ahead) { m(node.body, pos, caps, function (p2, c2) { found = c2; return true; }); }
          else { for (var st = pos; st >= 0 && !found; st--) m(node.body, st, caps, function (p2, c2) { if (p2 === pos) { found = c2; return true; } return false; }); }
          if (node.negative ? found : !found) { rec('fail', node, pos); return false; }
          rec('ok', node, pos);
          return k(pos, node.negative ? caps : found);
        }
        case 'backref': {
          rec('try', node, pos);
          var gi = node.name ? ast.names.indexOf(node.name) + 1 : node.index, g = caps[gi];
          if (!g) { rec('ok', node, pos, 'group not set: matches empty'); return k(pos, caps); }
          var sub = text.slice(g[0], g[1]), here = text.substr(pos, sub.length);
          if (here.length === sub.length && (ci ? fold(here) === fold(sub) : here === sub)) { rec('ok', node, pos + sub.length); return k(pos + sub.length, caps); }
          rec('fail', node, pos); return false;
        }
        case 'quant': return quant(node, 0, pos, caps, k);
        default: return k(pos, caps);
      }
    }
    function seq(items, i, pos, caps, k) { if (i >= items.length) return k(pos, caps); return m(items[i], pos, caps, function (p2, c2) { return seq(items, i + 1, p2, c2, k); }); }
    function quant(node, count, pos, caps, k) {
      var max = node.max === null ? Infinity : node.max;
      var more = function () {
        if (count >= max) return false;
        return m(node.child, pos, caps, function (p2, c2) {
          if (p2 === pos && count >= node.min) return false;   // an empty iteration ends the loop
          return quant(node, count + 1, p2, c2, k);
        });
      };
      if (count < node.min) return more();
      if (node.lazy) {
        if (k(pos, caps)) return true;
        backtracks++; rec('backtrack', node, pos, 'lazy: take one more');
        return more();
      }
      if (more()) return true;
      if (count > node.min || (count === node.min && count < max)) { backtracks++; rec('backtrack', node, pos, 'give back: ' + count + ' iteration' + (count === 1 ? '' : 's')); }
      return k(pos, caps);
    }
    var match = null, stopped = false;
    try {
      for (var s = opts.from || 0; s <= text.length && !match; s++) {
        rec('begin', { start: 0, end: 0 }, s, 'attempt at position ' + s);
        m(ast, s, [], function (p2, caps) { match = { start: s, end: p2, groups: caps }; return true; });
        if (uni && s < text.length && text.codePointAt(s) > 0xffff) s++;
      }
      if (match) steps.push({ kind: 'success', start: 0, end: 0, pos: match.end, note: 'match at ' + match.start + '–' + match.end });
    } catch (e) { if (e instanceof Stop) stopped = true; else throw e; }
    return { steps: steps, match: match, stopped: stopped, backtracks: backtracks };
  }
  return { trace: trace };
});
