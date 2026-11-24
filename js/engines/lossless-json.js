/* Layerbit lossless JSON: parse and stringify without changing numbers.
 * Pure functions, no DOM. Browser (window.LBLossless) and Node.
 *
 * JSON.parse turns 12345678901234567890 into 12345678901234567000, 1e400
 * into Infinity (written back as null) and -0 into 0. Here a number is kept
 * as a LosslessNumber holding its source text, and stringify writes that
 * text back untouched, so formatting a document never changes its data.
 *
 * parse(text)            -> value (numbers as LosslessNumber); SyntaxError like JSON.parse
 * stringify(v, indent)   -> text; LosslessNumbers written as written
 * sortKeys(v)            -> deep copy with object keys sorted
 * toNative(v)            -> plain JavaScript value (numbers as Number) for analysis
 * isUnsafe(raw)          -> true when Number(raw) would not write back as the same value
 * unsafeNumbers(v)       -> the source text of every unsafe number in a parsed value
 * canonicalNumber(raw)   -> one spelling per value: "1", "1.0" and "1e0" agree
 * inferValue(cell)       -> CSV cell to a JSON value without ever changing it
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBLossless = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function LosslessNumber(raw) { this.value = raw; this.isLosslessNumber = true; }
  LosslessNumber.prototype.valueOf = function () { return Number(this.value); };
  LosslessNumber.prototype.toString = function () { return this.value; };
  LosslessNumber.prototype.toJSON = function () { return Number(this.value); };
  function isLosslessNumber(v) { return !!(v && v.isLosslessNumber === true); }

  // an own property even for "__proto__", which plain assignment would turn
  // into the object's prototype
  function setKey(obj, k, v) {
    if (k === '__proto__') Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
    else obj[k] = v;
  }

  function parse(text) {
    text = String(text);
    var i = 0, n = text.length;
    function fail(msg) { throw new SyntaxError(msg + ' in JSON at position ' + i); }
    function ws() { while (i < n) { var c = text.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } }
    function str() {
      var start = i; i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') i++;
        else if (text.charCodeAt(i) < 32) fail('Bad control character in string literal');
        i++;
      }
      if (i >= n) fail('Unterminated string in JSON');
      i++;
      return JSON.parse(text.slice(start, i));
    }
    var NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    function value(depth) {
      if (depth > 10000) fail('Nesting is too deep');
      ws();
      var c = text[i];
      if (c === '{') {
        i++; var obj = {}; ws();
        if (text[i] === '}') { i++; return obj; }
        for (;;) {
          ws(); if (text[i] !== '"') fail('Expected double-quoted property name');
          var k = str(); ws();
          if (text[i] !== ':') fail("Expected ':' after property name");
          i++; setKey(obj, k, value(depth + 1)); ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; return obj; }
          fail("Expected ',' or '}' after property value");
        }
      }
      if (c === '[') {
        i++; var arr = []; ws();
        if (text[i] === ']') { i++; return arr; }
        for (;;) {
          arr.push(value(depth + 1)); ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; return arr; }
          fail("Expected ',' or ']' after array element");
        }
      }
      if (c === '"') return str();
      NUM.lastIndex = i;
      var m = NUM.exec(text);
      if (m && m[0] && m[0] !== '-') {
        i += m[0].length;
        if (/[\d.eE+\-]/.test(text[i] || '')) fail('Unexpected number');
        return new LosslessNumber(m[0]);
      }
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      fail(i >= n ? 'Unexpected end of JSON input' : 'Unexpected token ' + JSON.stringify(c));
    }
    var v = value(0); ws();
    if (i < n) fail('Unexpected non-whitespace character after JSON');
    return v;
  }

  // The native serializer does the work; numbers kept as text are swapped in
  // through a token unique to this call. The replacer reads the holder (this[k])
  // because JSON.stringify applies toJSON before the replacer sees a value.
  function stringify(v, indent) {
    if (typeof indent === 'number') indent = indent > 0 ? Math.min(indent, 10) : undefined;
    else if (!indent) indent = undefined;
    var tok = '\u0001LN' + Math.random().toString(36).slice(2) + ':', used = false;
    var out = JSON.stringify(v, function (k, x) { var o = this[k]; if (isLosslessNumber(o)) { used = true; return tok + o.value; } return x; }, indent);
    if (out === undefined) return 'null';
    if (!used) return out;
    var esc = JSON.stringify(tok).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return out.replace(new RegExp('"' + esc + '([^"]*)"', 'g'), '$1');
  }


  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object' && !isLosslessNumber(v)) {
      var o = {}; Object.keys(v).sort().forEach(function (k) { setKey(o, k, sortKeys(v[k])); }); return o;
    }
    return v;
  }
  function toNative(v) {
    if (isLosslessNumber(v)) return Number(v.value);
    if (Array.isArray(v)) return v.map(toNative);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { setKey(o, k, toNative(v[k])); }); return o; }
    return v;
  }

  function canonicalNumber(raw) {
    var m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(raw));
    if (!m) return String(raw);
    var digits = (m[2] + (m[3] || '')).replace(/^0+/, ''), exp = parseInt(m[4] || '0', 10) - (m[3] || '').length;
    if (!digits) return '0';
    var t = digits.replace(/0+$/, ''); exp += digits.length - t.length;
    return (m[1] ? '-' : '') + t + 'e' + exp;
  }
  // Unsafe: the JavaScript number would write back as a different value
  // (rounding, Infinity, or -0 becoming 0). 1.10 vs 1.1 is the same value.
  function isUnsafe(raw) {
    raw = String(raw);
    var x = Number(raw);
    if (!isFinite(x)) return true;
    if (x === 0) return /^-/.test(raw);
    return canonicalNumber(String(x).replace(/^(-?\d+(?:\.\d+)?)e\+?/i, '$1e')) !== canonicalNumber(raw);
  }
  function unsafeNumbers(v, out) {
    out = out || [];
    if (isLosslessNumber(v)) { if (isUnsafe(v.value)) out.push(v.value); }
    else if (Array.isArray(v)) v.forEach(function (x) { unsafeNumbers(x, out); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { unsafeNumbers(v[k], out); });
    return out;
  }

  // CSV cell -> JSON value, only when nothing about the value changes:
  // integers and decimals written the way JavaScript writes them back, with
  // no leading zero, no + sign and at most 15 significant digits; true,
  // false and null. Everything else stays text.
  function inferValue(s) {
    if (typeof s !== 'string') return s;
    var low = s.toLowerCase();
    if (low === 'true') return true;
    if (low === 'false') return false;
    if (low === 'null') return null;
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)) return s;
    if (s.replace(/^-|\./g, '').replace(/^0+/, '').length > 15) return s;
    var x = Number(s);
    return String(x) === s ? x : s;
  }

  return { LosslessNumber: LosslessNumber, isLosslessNumber: isLosslessNumber, parse: parse, stringify: stringify, sortKeys: sortKeys, toNative: toNative, canonicalNumber: canonicalNumber, isUnsafe: isUnsafe, unsafeNumbers: unsafeNumbers, inferValue: inferValue };
});
