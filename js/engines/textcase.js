/* Layerbit text engine (UMD: window.LBText / module.exports).
   Case conversion that understands identifiers (camelCase, snake_case,
   kebab-case, acronyms like XMLHttpRequest, digits), title case with the
   AP/Chicago small-word rules, slugs with accent folding, and text statistics
   (graphemes, words, sentences, reading time, keyword density). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBText = factory();
})(this, function () {
  'use strict';

  var hasSeg = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

  /** Splits an identifier or phrase into lower-case-agnostic words:
   *  "XMLHttpRequest2Go" -> ["XML", "Http", "Request", "2", "Go"],
   *  "user_id-value.name" -> ["user", "id", "value", "name"]. */
  function words(s) {
    if (!s) return [];
    var out = [];
    String(s)
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')          // fooBar, 2Go
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')           // XMLHttp -> XML Http
      .replace(/(\p{L})(\p{N})/gu, '$1 $2')                    // v2 -> v 2
      .replace(/(\p{N})(\p{L})/gu, '$1 $2')
      .split(/[^\p{L}\p{N}\p{M}']+/u)
      .forEach(function (w) { w = w.replace(/^'+|'+$/g, ''); if (w) out.push(w); });
    return out;
  }
  function cap(w) { return w ? w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase() : w; }
  function lower(w) { return w.toLocaleLowerCase(); }

  var SMALL = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|v\.?|vs\.?|via|with|up|out|off|over|into|onto|from|than|so|yet)$/i;

  /** Title case on prose: keeps punctuation and spacing, lower-cases small
   *  words except first/last and after a colon, preserves ALLCAPS acronyms
   *  and words with inner capitals (iPhone, McDonald). */
  function titleCase(text) {
    return String(text).split('\n').map(function (line) {
      var tokens = line.split(/(\s+)/), wordIdx = [], i;
      for (i = 0; i < tokens.length; i++) if (/\S/.test(tokens[i])) wordIdx.push(i);
      var afterColon = true;
      wordIdx.forEach(function (ti, n) {
        var tok = tokens[ti], m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}\p{M}'’.-]*)(.*)$/u.exec(tok);
        if (!m) { afterColon = /[:—–?!]$/.test(tok); return; }
        var core = m[2], isFirst = n === 0 || afterColon, isLast = n === wordIdx.length - 1;
        var keep = /\p{Lu}/u.test(core.slice(1)) && /\p{Ll}/u.test(core) || (core.length > 1 && core === core.toUpperCase() && /\p{Lu}/u.test(core));
        var out;
        if (keep) out = core;
        else if (!isFirst && !isLast && SMALL.test(core)) out = core.toLowerCase();
        else out = core.split('-').map(function (p) { return p && SMALL.test(p) && !isFirst && !isLast ? p.toLowerCase() : cap(p); }).join('-');
        tokens[ti] = m[1] + out + m[3];
        afterColon = /[:—–?!]$/.test(tok);
      });
      return tokens.join('');
    }).join('\n');
  }
  function sentenceCase(text) {
    var lowered = String(text).toLocaleLowerCase();
    return lowered.replace(/(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu, function (m, pre, ch) { return pre + ch.toLocaleUpperCase(); })
      .replace(/\bi\b/g, 'I');
  }
  function fold(s) { return s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ł/g, 'l'); }

  var CASES = {
    camel: function (w) { return w.map(function (x, i) { return i ? cap(x) : lower(x); }).join(''); },
    pascal: function (w) { return w.map(cap).join(''); },
    snake: function (w) { return w.map(lower).join('_'); },
    constant: function (w) { return w.map(function (x) { return x.toLocaleUpperCase(); }).join('_'); },
    kebab: function (w) { return w.map(lower).join('-'); },
    cobol: function (w) { return w.map(function (x) { return x.toLocaleUpperCase(); }).join('-'); },
    train: function (w) { return w.map(cap).join('-'); },
    dot: function (w) { return w.map(lower).join('.'); },
    path: function (w) { return w.map(lower).join('/'); },
    space: function (w) { return w.map(lower).join(' '); }
  };
  var LABELS = { camel: 'camelCase', pascal: 'PascalCase', snake: 'snake_case', constant: 'CONSTANT_CASE', kebab: 'kebab-case', cobol: 'COBOL-CASE', train: 'Train-Case', dot: 'dot.case', path: 'path/case', space: 'space case', title: 'Title Case', sentence: 'Sentence case', upper: 'UPPER CASE', lower: 'lower case', slug: 'url-slug', alternating: 'aLtErNaTiNg', inverse: 'iNVERSE cASE' };

  /** Converts text. Identifier styles are applied per line, so a list of
   *  names converts as a list. */
  function convert(text, style) {
    text = String(text == null ? '' : text);
    switch (style) {
      case 'upper': return text.toLocaleUpperCase();
      case 'lower': return text.toLocaleLowerCase();
      case 'title': return titleCase(text);
      case 'sentence': return sentenceCase(text);
      case 'inverse': return Array.from(text).map(function (c) { var u = c.toLocaleUpperCase(); return c === u ? c.toLocaleLowerCase() : u; }).join('');
      case 'alternating': var k = 0; return Array.from(text).map(function (c) { if (!/\p{L}/u.test(c)) return c; return (k++ % 2) ? c.toLocaleUpperCase() : c.toLocaleLowerCase(); }).join('');
      case 'slug': return text.split('\n').map(function (l) { return CASES.kebab(words(fold(l)).map(function (w) { return w.replace(/'/g, ''); })); }).join('\n');
      default:
        if (!CASES[style]) throw new Error('Unknown case: ' + style);
        return text.split('\n').map(function (l) { return CASES[style](words(l)); }).join('\n');
    }
  }
  /** Guesses the naming convention of an identifier. */
  function detect(s) {
    s = String(s).trim();
    if (!s || /\s/.test(s) && !/^[\p{Lu}\s]+$/u.test(s)) return /\s/.test(s) ? 'text' : '';
    if (/^\p{Lu}[\p{Lu}\p{N}]*(_[\p{Lu}\p{N}]+)+$/u.test(s)) return 'constant';
    if (/^[\p{Ll}\p{N}]+(_[\p{Ll}\p{N}]+)+$/u.test(s)) return 'snake';
    if (/^[\p{Ll}\p{N}]+(-[\p{Ll}\p{N}]+)+$/u.test(s)) return 'kebab';
    if (/^\p{Lu}[\p{Lu}\p{N}]*(-[\p{Lu}\p{N}]+)+$/u.test(s)) return 'cobol';
    if (/^\p{Lu}\p{Ll}*(-\p{Lu}\p{Ll}*)+$/u.test(s)) return 'train';
    if (/^[\p{Ll}\p{N}]+(\.[\p{Ll}\p{N}]+)+$/u.test(s)) return 'dot';
    if (/^\p{Ll}[\p{Ll}\p{N}]*(\p{Lu}[\p{Ll}\p{N}]*)+$/u.test(s)) return 'camel';
    if (/^\p{Lu}\p{Ll}[\p{L}\p{N}]*$/u.test(s) && /\p{Lu}/u.test(s.slice(1))) return 'pascal';
    if (/^\p{Lu}[\p{Ll}\p{N}]+$/u.test(s)) return 'pascal';
    if (/^[\p{Ll}\p{N}]+$/u.test(s)) return 'lower';
    if (/^[\p{Lu}\p{N}]+$/u.test(s)) return 'upper';
    return '';
  }

  // ------------------------------------------------------------- statistics
  var STOP = ('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves').split(' ');
  var STOPSET = {}; STOP.forEach(function (w) { STOPSET[w] = 1; });
  function graphemes(s) {
    if (!hasSeg) return Array.from(s).length;
    var n = 0, it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s);
    for (var x of it) n++; // eslint-disable-line no-unused-vars
    return n;
  }
  function wordList(s) {
    if (hasSeg) {
      var out = [];
      for (var seg of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(s)) if (seg.isWordLike) out.push(seg.segment);
      return out;
    }
    return s.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu) || [];
  }
  function stats(s, opts) {
    s = String(s == null ? '' : s); opts = opts || {};
    var wpm = opts.wpm || 238, spm = opts.speakWpm || 150;
    var w = wordList(s), lines = s ? s.split(/\r\n|\r|\n/) : [];
    var sentences = s.trim() ? (s.replace(/\b(e\.g|i\.e|etc|mr|mrs|ms|dr|vs|no|fig|inc|ltd)\./gi, '$1').match(/[^.!?…]+(?:[.!?…]+|$)/g) || []).filter(function (x) { return /[\p{L}\p{N}]/u.test(x); }).length : 0;
    var paragraphs = s.trim() ? s.trim().split(/\n\s*\n/).filter(function (p) { return p.trim(); }).length : 0;
    var freq = {}, total = 0, longest = '';
    w.forEach(function (x) {
      var k = x.toLocaleLowerCase().replace(/[’']s$/, '');
      if (Array.from(x).length > Array.from(longest).length) longest = x;
      if (STOPSET[k] || /^\p{N}+$/u.test(k) || k.length < 2) return;
      freq[k] = (freq[k] || 0) + 1; total++;
    });
    var top = Object.keys(freq).map(function (k) { return { word: k, count: freq[k], pct: w.length ? freq[k] / w.length * 100 : 0 }; })
      .sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); }).slice(0, opts.top || 12);
    var letters = w.reduce(function (n, x) { return n + Array.from(x).length; }, 0);
    var syll = w.reduce(function (n, x) { return n + syllables(x); }, 0);
    var fre = w.length && sentences ? 206.835 - 1.015 * (w.length / sentences) - 84.6 * (syll / w.length) : null;
    return {
      characters: graphemes(s), charactersNoSpaces: graphemes(s.replace(/\s+/g, '')), codeUnits: s.length,
      bytes: typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length,
      words: w.length, uniqueWords: Object.keys(w.reduce(function (o, x) { o[x.toLocaleLowerCase()] = 1; return o; }, {})).length,
      sentences: sentences, paragraphs: paragraphs, lines: lines.length, blankLines: lines.filter(function (l) { return !l.trim(); }).length,
      avgWordLength: w.length ? letters / w.length : 0, avgSentenceWords: sentences ? w.length / sentences : 0, longestWord: longest,
      readingSeconds: Math.round(w.length / wpm * 60), speakingSeconds: Math.round(w.length / spm * 60),
      fleschReadingEase: fre == null ? null : Math.round(fre * 10) / 10, keywords: top, contentWords: total
    };
  }
  /** Heuristic English syllable count (for readability scores only). */
  function syllables(word) {
    var w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    var m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }

  // ----------------------------------------------------------- line tools
  function lineOp(text, op) {
    var lines = String(text).split(/\r\n|\r|\n/), seen = {};
    switch (op) {
      case 'trim': return lines.map(function (l) { return l.trim(); }).join('\n');
      case 'dedupe': return lines.filter(function (l) { if (seen[l]) return false; seen[l] = 1; return true; }).join('\n');
      case 'dropBlank': return lines.filter(function (l) { return l.trim(); }).join('\n');
      case 'sortAsc': return lines.slice().sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare).join('\n');
      case 'sortDesc': return lines.slice().sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare).reverse().join('\n');
      case 'reverse': return lines.slice().reverse().join('\n');
      case 'squeeze': return String(text).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
      case 'unwrap': return String(text).replace(/([^\n])\n(?!\n)/g, '$1 ');
      default: throw new Error('Unknown line operation: ' + op);
    }
  }

  return { words: words, convert: convert, detect: detect, titleCase: titleCase, sentenceCase: sentenceCase, stats: stats, syllables: syllables, lineOp: lineOp, labels: LABELS, styles: Object.keys(LABELS) };
});
