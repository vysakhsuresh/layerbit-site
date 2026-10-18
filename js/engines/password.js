/* Layerbit password engine (UMD: window.LBPass / module.exports).
   Unbiased generation from the platform CSPRNG (crypto.getRandomValues with
   rejection sampling), passphrases from a supplied word list, PINs, exact
   entropy for generated secrets, and a pattern-aware strength estimate for
   passwords people type (common passwords, keyboard walks, sequences,
   repeats, dates, leetspeak). Pure functions apart from the RNG. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('crypto').webcrypto);
  else root.LBPass = factory(root.crypto);
})(this, function (cryptoObj) {
  'use strict';
  var SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!#$%&()*+,-./:;<=>?@[]^_{|}~' };
  var AMBIGUOUS = 'Il1O0o|`\'"';

  /** Uniform integer in [0, n) with no modulo bias. */
  function randomInt(n) {
    if (!(n > 0 && n <= 4294967296)) throw new Error('range');
    var limit = Math.floor(4294967296 / n) * n, buf = new Uint32Array(1);
    do { cryptoObj.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }
  function uniq(s) { return Array.from(new Set(Array.from(s))).join(''); }
  function pools(o) {
    var out = [];
    ['lower', 'upper', 'digits', 'symbols'].forEach(function (k) {
      if (!o[k]) return;
      var set = k === 'symbols' && o.customSymbols ? uniq(o.customSymbols) : SETS[k];
      if (o.excludeAmbiguous) set = Array.from(set).filter(function (c) { return AMBIGUOUS.indexOf(c) < 0; }).join('');
      if (o.exclude) set = Array.from(set).filter(function (c) { return o.exclude.indexOf(c) < 0; }).join('');
      if (set) out.push(set);
    });
    return out;
  }
  /** Generates one password. Options: length, lower, upper, digits, symbols,
   *  customSymbols, excludeAmbiguous, exclude, requireEach, noRepeats. */
  function generate(o) {
    o = Object.assign({ length: 20, lower: true, upper: true, digits: true, symbols: true, requireEach: true }, o || {});
    var ps = pools(o), all = uniq(ps.join(''));
    if (!all) throw new Error('Choose at least one character set.');
    if (o.length < 1 || o.length > 1024) throw new Error('Length must be 1-1024.');
    if (o.noRepeats && o.length > all.length) throw new Error('Only ' + all.length + ' distinct characters are available, so a ' + o.length + '-character password cannot avoid repeats.');
    if (o.requireEach && ps.length > o.length) throw new Error('Length ' + o.length + ' is too short to include all ' + ps.length + ' chosen character sets.');
    for (var attempt = 0; attempt < 10000; attempt++) {
      var chars = [], pool = Array.from(all);
      for (var i = 0; i < o.length; i++) {
        var j = randomInt(pool.length);
        chars.push(pool[j]);
        if (o.noRepeats) pool.splice(j, 1);
      }
      var pw = chars.join('');
      // rejection keeps the distribution uniform over passwords that satisfy the rule
      if (!o.requireEach || ps.every(function (set) { return Array.from(pw).some(function (c) { return set.indexOf(c) >= 0; }); })) return pw;
    }
    throw new Error('Could not satisfy the rules; relax them.');
  }
  /** Entropy (bits) of a password produced by generate() with these options. */
  function entropy(o) {
    o = Object.assign({ length: 20, lower: true, upper: true, digits: true, symbols: true }, o || {});
    var n = uniq(pools(o).join('')).length;
    if (!n) return 0;
    if (o.noRepeats) { var b = 0; for (var i = 0; i < o.length; i++) b += Math.log2(n - i); return b; }
    return o.length * Math.log2(n);
  }
  /** Passphrase from a word list. Options: words, separator, capitalize, number, symbol. */
  function passphrase(list, o) {
    o = Object.assign({ words: 6, separator: '-', capitalize: false, number: false, symbol: false }, o || {});
    if (!list || list.length < 2) throw new Error('The word list has not loaded.');
    var ws = [];
    for (var i = 0; i < o.words; i++) { var w = list[randomInt(list.length)]; ws.push(o.capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w); }
    if (o.number) ws[randomInt(ws.length)] += String(randomInt(10));
    if (o.symbol) { var sy = '!#$%&*+?@'; ws[randomInt(ws.length)] += sy[randomInt(sy.length)]; }
    return ws.join(o.separator);
  }
  function passphraseEntropy(listSize, o) {
    o = Object.assign({ words: 6 }, o || {});
    var b = o.words * Math.log2(listSize);
    if (o.number) b += Math.log2(10) + Math.log2(o.words);
    if (o.symbol) b += Math.log2(9) + Math.log2(o.words);
    return b;
  }
  function pin(len) { var s = ''; for (var i = 0; i < len; i++) s += String(randomInt(10)); return s; }

  // ------------------------------------------------------- strength estimate
  var COMMON = ('123456 password 123456789 12345678 12345 qwerty 1234567 111111 1234567890 123123 abc123 1234 password1 iloveyou 1q2w3e4r 000000 qwerty123 zaq12wsx dragon sunshine princess letmein 654321 monkey 27653 1qaz2wsx 123321 qwertyuiop superman asdfghjkl trustno1 welcome admin admin123 login master hello freedom whatever shadow football baseball michael jordan harley ranger buster soccer hockey killer george charlie andrew michelle jessica pepper daniel access 696969 batman starwars passw0rd p@ssw0rd p@ssword qazwsx 112233 121212 666666 7777777 987654321 secret summer winter spring autumn love test test123 changeme default root toor guest user pass computer internet samsung apple google facebook linkedin microsoft cheese chocolate cookie purple orange yellow banana flower').split(' ');
  var COMMONSET = {}; COMMON.forEach(function (w, i) { COMMONSET[w] = i + 1; });
  var KEYROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsxedcrfvtgbyhnujmikolp', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p'];
  var LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't' };
  function unleet(s) { return s.replace(/[4@31!0$57+]/g, function (c) { return LEET[c]; }); }
  function poolSize(s) {
    var n = 0;
    if (/[a-z]/.test(s)) n += 26; if (/[A-Z]/.test(s)) n += 26; if (/[0-9]/.test(s)) n += 10;
    if (/[^a-zA-Z0-9\s]/.test(s)) n += 33; if (/\s/.test(s)) n += 1; if (/[^\x00-\x7f]/.test(s)) n += 100;
    return n || 1;
  }
  /** Finds low-entropy segments; returns [{start, end, kind, bits}]. */
  function patterns(pw) {
    var out = [], low = pw.toLowerCase(), un = unleet(low), i, j;
    // common passwords and their leet forms, as whole or as substrings of 4+
    for (i = 0; i < low.length; i++) for (j = low.length; j >= i + 4; j--) {
      var seg = low.slice(i, j), useg = un.slice(i, j);
      var rank = COMMONSET[seg] || COMMONSET[useg];
      if (rank) { out.push({ start: i, end: j, kind: 'common password "' + pw.slice(i, j) + '"', bits: Math.log2(rank * (seg === useg ? 1 : 4) * 2) }); i = j - 1; break; }
    }
    // keyboard walks and sequences (3+), forwards or backwards
    function runs(alpha, kind) {
      for (var a = 0; a < low.length - 2; a++) {
        var len = 1;
        while (a + len < low.length) {
          var p = alpha.indexOf(low[a + len - 1]), q = alpha.indexOf(low[a + len]);
          if (p < 0 || q < 0 || Math.abs(q - p) !== 1 || (len > 1 && (q - p) !== (alpha.indexOf(low[a + 1]) - alpha.indexOf(low[a])))) break;
          len++;
        }
        if (len >= 3) { out.push({ start: a, end: a + len, kind: kind + ' "' + pw.slice(a, a + len) + '"', bits: Math.log2(alpha.length * 2 * len) }); a += len - 1; }
      }
    }
    KEYROWS.forEach(function (r) { runs(r, 'keyboard pattern'); });
    runs('abcdefghijklmnopqrstuvwxyz', 'sequence'); runs('0123456789', 'sequence');
    // repeats: aaa, abcabc
    var rep = /(.+?)\1{2,}|(.{2,})\2+/g, m;
    while ((m = rep.exec(pw))) out.push({ start: m.index, end: m.index + m[0].length, kind: 'repeat "' + m[0] + '"', bits: Math.log2(poolSize(m[1] || m[2]) * Math.pow(poolSize(m[1] || m[2]), (m[1] || m[2]).length > 1 ? 1 : 0) + 1) + Math.log2(m[0].length) });
    // years and dates
    var dt = /(19\d\d|20[0-4]\d)|\b(\d{1,2})[\/.-]?(\d{1,2})[\/.-]?(\d{2}|\d{4})\b/g;
    while ((m = dt.exec(pw))) out.push({ start: m.index, end: m.index + m[0].length, kind: (m[1] ? 'year "' : 'date "') + m[0] + '"', bits: m[1] ? Math.log2(150) : Math.log2(365 * 100) });
    return out;
  }
  /** Estimates guesses as the cheapest cover of the password by patterns and
   *  brute-force characters (dynamic programming over positions). */
  function strength(pw) {
    pw = String(pw || '');
    if (!pw) return { bits: 0, score: 0, label: 'Empty', findings: [], crack: {} };
    var chars = Array.from(pw), n = pw.length, perChar = Math.log2(poolSize(pw));
    var ps = patterns(pw), best = new Array(n + 1).fill(Infinity), via = new Array(n + 1).fill(null);
    best[0] = 0;
    for (var i = 1; i <= n; i++) {
      if (best[i - 1] + perChar < best[i]) { best[i] = best[i - 1] + perChar; via[i] = null; }
      ps.forEach(function (p) { if (p.end === i && best[p.start] + p.bits < best[i]) { best[i] = best[p.start] + p.bits; via[i] = p; } });
    }
    var used = [], k = n;
    while (k > 0) { if (via[k]) { used.unshift(via[k]); k = via[k].start; } else k--; }
    var bits = Math.max(0, best[n] + (used.length > 1 ? Math.log2(used.length) : 0));
    var score = bits < 28 ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    var guesses = Math.pow(2, bits);
    return {
      bits: Math.round(bits * 10) / 10, score: score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score],
      length: chars.length, pool: poolSize(pw), findings: used.map(function (u) { return u.kind; }),
      crack: { onlineThrottled: guesses / 2 / (100 / 3600), onlineFast: guesses / 2 / 10, offlineSlow: guesses / 2 / 1e4, offlineFast: guesses / 2 / 1e10 }
    };
  }
  function humanTime(sec) {
    if (!isFinite(sec) || sec >= 31536000 * 1e6) return 'effectively never';
    if (sec < 1) return 'instantly';
    var units = [['year', 31536000], ['month', 2628000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    if (sec >= 31536000 * 100) { var c = Math.floor(sec / 31536000 / 100); return c.toLocaleString('en') + (c === 1 ? ' century' : ' centuries'); }
    for (var i = 0; i < units.length; i++) if (sec >= units[i][1]) { var v = Math.floor(sec / units[i][1]); return v + ' ' + units[i][0] + (v === 1 ? '' : 's'); }
    return 'instantly';
  }
  return { generate: generate, entropy: entropy, passphrase: passphrase, passphraseEntropy: passphraseEntropy, pin: pin, strength: strength, humanTime: humanTime, randomInt: randomInt, sets: SETS, ambiguous: AMBIGUOUS };
});
