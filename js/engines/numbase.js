/* Layerbit number engine (UMD: window.LBNum / module.exports).
   Arbitrary-precision integer parsing and formatting in bases 2-36 (BigInt),
   two's-complement views at fixed widths, byte order, IEEE-754 float decoding
   and encoding, and bitwise operations. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBNum = factory();
})(this, function () {
  'use strict';
  var DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
  var PREFIX = { '0x': 16, '0b': 2, '0o': 8 };

  /** Parses an integer string in `base` (2-36). Accepts a sign, 0x/0b/0o
   *  prefixes (which override base 10 / agree with the base), underscores,
   *  spaces, commas and apostrophes as digit separators, and a trailing h/b
   *  suffix (assembler style) when base is 'auto'. Returns BigInt or throws. */
  function parse(input, base) {
    var s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) throw new Error('Enter a number.');
    var neg = false;
    if (s[0] === '-' || s[0] === '+') { neg = s[0] === '-'; s = s.slice(1).trim(); }
    var b = base === 'auto' || base == null ? null : Number(base);
    var p = s.slice(0, 2);
    if (PREFIX[p] && (b == null || b === PREFIX[p] || b === 10)) { b = PREFIX[p]; s = s.slice(2); }
    else if (b == null && /^[0-9a-f]+h$/.test(s)) { b = 16; s = s.slice(0, -1); }
    else if (b == null && /^#[0-9a-f]+$/.test(s)) { b = 16; s = s.slice(1); }
    if (b == null) b = 10;
    if (!(b >= 2 && b <= 36)) throw new Error('Base must be between 2 and 36.');
    s = s.replace(/[\s_,']/g, '');
    if (!s) throw new Error('Enter a number.');
    var bb = BigInt(b), v = 0n;
    for (var i = 0; i < s.length; i++) {
      var d = DIGITS.indexOf(s[i]);
      if (d < 0 || d >= b) throw new Error('"' + s[i] + '" is not a valid base-' + b + ' digit (position ' + (i + 1) + ').');
      v = v * bb + BigInt(d);
    }
    return neg ? -v : v;
  }
  function format(v, base, opts) {
    opts = opts || {};
    var b = Number(base), neg = v < 0n, x = neg ? -v : v, s = x.toString(b);
    if (opts.upper) s = s.toUpperCase();
    if (opts.group) {
      var g = opts.group, out = '';
      for (var i = s.length; i > 0; i -= g) out = s.slice(Math.max(0, i - g), i) + (out ? (opts.sep || ' ') + out : '');
      s = out;
    }
    return (neg ? '-' : '') + (opts.prefix ? ({ 16: '0x', 2: '0b', 8: '0o' }[b] || '') : '') + s;
  }
  function bitLength(v) { if (v < 0n) v = -v - 1n; return v === 0n ? 0 : v.toString(2).length; }
  /** Smallest standard width (8/16/32/64/128/256) that holds v as signed or unsigned. */
  function fitWidth(v) {
    var widths = [8, 16, 32, 64, 128, 256];
    for (var i = 0; i < widths.length; i++) { var w = BigInt(widths[i]); if (v >= -(1n << (w - 1n)) && v < (1n << w)) return widths[i]; }
    return Math.ceil((bitLength(v) + 1) / 8) * 8;
  }
  /** Two's-complement interpretation at `width` bits. */
  function twos(v, width) {
    var w = BigInt(width), mod = 1n << w, u = ((v % mod) + mod) % mod, sgn = u >= (1n << (w - 1n)) ? u - mod : u;
    var overflow = v >= mod || v < -(1n << (w - 1n));
    return { unsigned: u, signed: sgn, bits: u.toString(2).padStart(width, '0'), overflow: overflow };
  }
  function bytes(u, width, littleEndian) {
    var n = width / 8, out = [];
    for (var i = 0; i < n; i++) out.push(Number((u >> BigInt(8 * i)) & 0xffn));
    if (!littleEndian) out.reverse();
    return out;
  }
  /** Reads the bit pattern of `u` as an IEEE-754 float: 64, 32, 16 (half),
   *  or 16 with kind 'bf16' (bfloat16: float32's sign and exponent, 7 mantissa bits). */
  function asFloat(u, width, kind) {
    var buf = new DataView(new ArrayBuffer(8));
    if (width === 32) { buf.setUint32(0, Number(u & 0xffffffffn)); return describeFloat(buf.getFloat32(0), u, 32); }
    if (width === 64) { buf.setBigUint64(0, u & 0xffffffffffffffffn); return describeFloat(buf.getFloat64(0), u, 64); }
    if (width === 16) { var h = Number(u & 0xffffn), f = kind === 'bf16' ? [8, 7] : [5, 10]; return describeFloat(decodeSmall(h, f[0], f[1]), BigInt(h), 16, f[0], f[1]); }
    return null;
  }
  // a small IEEE-754 format with eb exponent bits and mb mantissa bits
  function decodeSmall(h, eb, mb) {
    var sign = h >> (eb + mb) ? -1 : 1, e = (h >> mb) & ((1 << eb) - 1), m = h & ((1 << mb) - 1), bias = (1 << (eb - 1)) - 1;
    if (e === (1 << eb) - 1) return m ? NaN : sign * Infinity;
    if (e === 0) return sign * m * Math.pow(2, 1 - bias - mb);
    return sign * (1 + m / Math.pow(2, mb)) * Math.pow(2, e - bias);
  }
  function roundEven(v) { var f = Math.floor(v), d = v - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); }
  // one rounding, to nearest with ties to even, straight from the double
  function encodeSmall(x, eb, mb) {
    var top = 1 << (eb + mb), bias = (1 << (eb - 1)) - 1, emax = (1 << eb) - 1, inf = emax << mb;
    if (x !== x) return inf | (1 << (mb - 1));
    var sign = x < 0 || (x === 0 && 1 / x < 0) ? top : 0; x = Math.abs(x);
    if (x === Infinity) return sign | inf;
    if (x === 0) return sign;
    var e = Math.floor(Math.log2(x));
    if (Math.pow(2, e) > x) e--; else if (Math.pow(2, e + 1) <= x) e++;
    if (e < 1 - bias) {
      var sm = roundEven(x / Math.pow(2, 1 - bias - mb));
      return sign | sm;   // sm === 2^mb carries into the smallest normal exponent by itself
    }
    var m = roundEven((x / Math.pow(2, e) - 1) * Math.pow(2, mb));
    if (m === Math.pow(2, mb)) { m = 0; e++; }
    if (e + bias >= emax) return sign | inf;
    return sign | ((e + bias) << mb) | m;
  }
  function describeFloat(value, u, width, ebits, mbits) {
    var eb = ebits || (width === 32 ? 8 : 11), mb = mbits || (width === 32 ? 23 : 52), bias = (1 << (eb - 1)) - 1;
    var bits = u.toString(2).padStart(width, '0'), sign = bits[0], exp = bits.slice(1, 1 + eb), man = bits.slice(1 + eb);
    var e = parseInt(exp, 2), kind = e === 0 ? (/1/.test(man) ? 'subnormal' : 'zero') : e === (1 << eb) - 1 ? (/1/.test(man) ? 'NaN' : 'infinity') : 'normal';
    return { value: value, sign: sign, exponent: exp, mantissa: man, unbiased: kind === 'normal' ? e - bias : kind === 'subnormal' ? 1 - bias : null, kind: kind };
  }
  /** Bit pattern of a decimal number as float64, float32, float16 (16) or bfloat16 ('bf16'). */
  function floatBits(x, width) {
    if (width === 16) return BigInt(encodeSmall(x, 5, 10));
    if (width === 'bf16') return BigInt(encodeSmall(x, 8, 7));
    var buf = new DataView(new ArrayBuffer(8));
    if (width === 32) { buf.setFloat32(0, x); return BigInt(buf.getUint32(0)); }
    buf.setFloat64(0, x); return buf.getBigUint64(0);
  }
  function op(a, b, name, width) {
    var w = width ? BigInt(width) : null, mask = w ? (1n << w) - 1n : null, r;
    switch (name) {
      case 'and': r = a & b; break;
      case 'or': r = a | b; break;
      case 'xor': r = a ^ b; break;
      case 'not': if (!w) throw new Error('NOT needs a bit width.'); r = ~a & mask; break;
      case 'shl': r = a << b; break;
      case 'shr': r = a >> b; break;   // arithmetic on BigInt
      case 'add': r = a + b; break;
      case 'sub': r = a - b; break;
      case 'mul': r = a * b; break;
      case 'div': if (b === 0n) throw new Error('Division by zero.'); r = a / b; break;
      case 'mod': if (b === 0n) throw new Error('Division by zero.'); r = a % b; break;
      case 'pow': if (b < 0n || b > 4096n) throw new Error('Exponent must be 0-4096.'); r = a ** b; break;
      default: throw new Error('Unknown operation: ' + name);
    }
    return mask && name !== 'not' && (name === 'shl' || name === 'and' || name === 'or' || name === 'xor') ? r & mask : r;
  }
  function popcount(u) { var n = 0; u = u < 0n ? -u : u; while (u) { n += Number(u & 1n); u >>= 1n; } return n; }
  /** Characters for bytes that are printable ASCII, '.' otherwise. */
  function ascii(bs) { return bs.map(function (b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : '·'; }).join(''); }
  return { parse: parse, format: format, bitLength: bitLength, fitWidth: fitWidth, twos: twos, bytes: bytes, asFloat: asFloat, floatBits: floatBits, op: op, popcount: popcount, ascii: ascii };
});
