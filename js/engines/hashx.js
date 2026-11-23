/* Layerbit checksum lists: the text formats of sha256sum, md5sum, b2sum and
 * the BSD "SHA256 (file) = digest" style, and comparing sets of files by
 * digest. Pure functions, no DOM. Browser (window.LBHashX), Worker, Node.
 *
 * ALGS                       -> [{name, hexLen, crypto, wasm}] every digest the Hash Generator offers
 * algForLength(len, hint)    -> algorithm name for a hex digest of that length,
 *                               preferring one named in hint (a file name such as SHA3-256SUMS)
 * parseSums(text, fileName)  -> {entries: [{digest, path, alg, line}], errors: [{line, text}]}
 * formatSums(rows, alg, style) -> "digest  path" lines (GNU, with \ escaping) or BSD style
 * relPaths(paths)            -> the paths without their common top folder, with / separators
 * compareSets(a, b)          -> [{path, status: same | different | onlyA | onlyB, a, b}]
 * checkSums(entries, files)  -> [{path, status: OK | FAILED | MISSING, expected, actual, alg}]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBHashX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ALGS = [
    { name: 'MD5', hexLen: 32, crypto: true, wasm: 'createMD5', bsd: 'MD5' },
    { name: 'SHA-1', hexLen: 40, crypto: true, wasm: 'createSHA1', bsd: 'SHA1' },
    { name: 'SHA-256', hexLen: 64, crypto: true, wasm: 'createSHA256', bsd: 'SHA256' },
    { name: 'SHA-384', hexLen: 96, crypto: true, wasm: 'createSHA384', bsd: 'SHA384' },
    { name: 'SHA-512', hexLen: 128, crypto: true, wasm: 'createSHA512', bsd: 'SHA512' },
    { name: 'SHA3-256', hexLen: 64, crypto: true, wasm: 'createSHA3', arg: 256, bsd: 'SHA3-256' },
    { name: 'SHA3-512', hexLen: 128, crypto: true, wasm: 'createSHA3', arg: 512, bsd: 'SHA3-512' },
    { name: 'BLAKE2b-512', hexLen: 128, crypto: true, wasm: 'createBLAKE2b', arg: 512, bsd: 'BLAKE2b' },
    { name: 'BLAKE2s-256', hexLen: 64, crypto: true, wasm: 'createBLAKE2s', arg: 256, bsd: 'BLAKE2s' },
    { name: 'BLAKE3', hexLen: 64, crypto: true, wasm: 'createBLAKE3', bsd: 'BLAKE3' },
    { name: 'RIPEMD-160', hexLen: 40, crypto: true, wasm: 'createRIPEMD160', bsd: 'RMD160' },
    { name: 'XXH64', hexLen: 16, crypto: false, wasm: 'createXXHash64', bsd: 'XXH64' },
    { name: 'XXH3', hexLen: 16, crypto: false, wasm: 'createXXHash3', bsd: 'XXH3' },
    { name: 'XXH128', hexLen: 32, crypto: false, wasm: 'createXXHash128', bsd: 'XXH128' },
    { name: 'CRC32', hexLen: 8, crypto: false, wasm: 'createCRC32', bsd: 'CRC32' },
    { name: 'CRC32C', hexLen: 8, crypto: false, wasm: 'createCRC32', arg: 0x82F63B78, bsd: 'CRC32C' }
  ];
  var DEFAULT_BY_LEN = { 8: 'CRC32', 16: 'XXH64', 32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' };
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  function byName(n) { var k = norm(n); for (var i = 0; i < ALGS.length; i++) if (norm(ALGS[i].name) === k || norm(ALGS[i].bsd) === k) return ALGS[i]; return null; }
  function algForLength(len, hint) {
    var h = norm(hint);
    if (h) {
      // longest name first, so "sha3256" is not read as "sha256"
      var named = ALGS.slice().sort(function (a, b) { return norm(b.name).length - norm(a.name).length; });
      for (var i = 0; i < named.length; i++) { var a = named[i]; if (a.hexLen === len && (h.indexOf(norm(a.name)) >= 0 || h.indexOf(norm(a.bsd)) >= 0)) return a.name; }
      if (/b2/.test(h) && len === 128) return 'BLAKE2b-512';
    }
    return DEFAULT_BY_LEN[len] || null;
  }
  function unescapeName(s) { return s.replace(/\\(\\|n|r)/g, function (m, c) { return c === 'n' ? '\n' : c === 'r' ? '\r' : '\\'; }); }
  function parseSums(text, fileName) {
    var entries = [], errors = [];
    String(text).split(/\r\n|\n|\r/).forEach(function (line, i) {
      if (!line.trim() || /^\s*#/.test(line)) return;
      var m = /^(\\?)([0-9a-fA-F]{8,128}) [ *](.+)$/.exec(line);
      if (m) {
        var digest = m[2].toLowerCase(), path = m[1] ? unescapeName(m[3]) : m[3];
        entries.push({ digest: digest, path: path, alg: algForLength(digest.length, fileName), line: i + 1 });
        return;
      }
      var b = /^(\\?)([A-Za-z0-9-]+) \((.+)\) = ([0-9a-fA-F]+)$/.exec(line);
      if (b) {
        var a = byName(b[2]), d = b[4].toLowerCase();
        entries.push({ digest: d, path: b[1] ? unescapeName(b[3]) : b[3], alg: a ? a.name : algForLength(d.length, b[2]), line: i + 1 });
        return;
      }
      errors.push({ line: i + 1, text: line });
    });
    return { entries: entries, errors: errors };
  }
  function formatSums(rows, alg, style) {
    var a = byName(alg) || { bsd: alg };
    return rows.map(function (r) {
      var needs = /[\\\n\r]/.test(r.path), p = needs ? r.path.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r') : r.path;
      return style === 'bsd' ? (needs ? '\\' : '') + a.bsd + ' (' + p + ') = ' + r.digest + '\n' : (needs ? '\\' : '') + r.digest + '  ' + p + '\n';
    }).join('');
  }
  function relPaths(paths) {
    var ps = paths.map(function (p) { return String(p).replace(/\\/g, '/'); });
    if (ps.length < 1) return ps;
    var first = ps[0].split('/');
    if (first.length > 1 && ps.every(function (p) { var s = p.split('/'); return s.length > 1 && s[0] === first[0]; })) return ps.map(function (p) { return p.slice(first[0].length + 1); });
    return ps;
  }
  function compareSets(a, b) {
    var map = {}, out = [];
    a.forEach(function (x) { map['$' + x.path] = { path: x.path, a: x.digest }; });
    b.forEach(function (x) { var k = '$' + x.path; if (map[k]) map[k].b = x.digest; else map[k] = { path: x.path, b: x.digest }; });
    Object.keys(map).forEach(function (k) {
      var r = map[k];
      r.status = r.a === undefined ? 'onlyB' : r.b === undefined ? 'onlyA' : r.a === r.b ? 'same' : 'different';
      out.push(r);
    });
    return out.sort(function (x, y) { return x.path < y.path ? -1 : x.path > y.path ? 1 : 0; });
  }
  function checkSums(entries, files) {
    var byPath = {}, byName = {};
    files.forEach(function (f) {
      var p = String(f.path).replace(/\\/g, '/');
      byPath[p] = f;
      var base = p.split('/').pop(); (byName[base] = byName[base] || []).push(f);
    });
    return entries.map(function (e) {
      var want = e.path.replace(/\\/g, '/').replace(/^\.\//, '');
      var f = byPath[want] || null;
      if (!f) { var suffix = Object.keys(byPath).filter(function (p) { return p === want || p.slice(-(want.length + 1)) === '/' + want; }); if (suffix.length === 1) f = byPath[suffix[0]]; }
      if (!f) { var cands = byName[want.split('/').pop()] || []; if (cands.length === 1) f = cands[0]; }
      if (!f) return { path: e.path, status: 'MISSING', expected: e.digest, alg: e.alg };
      return { path: e.path, status: f.digest === e.digest ? 'OK' : 'FAILED', expected: e.digest, actual: f.digest, alg: e.alg, file: f };
    });
  }
  return { ALGS: ALGS, byName: byName, algForLength: algForLength, parseSums: parseSums, formatSums: formatSums, relPaths: relPaths, compareSets: compareSets, checkSums: checkSums };
});
