// MD5 (RFC 1321) for the browser. The Web Crypto API deliberately does not
// implement MD5, but it is still needed to check legacy download checksums,
// derive UUID v3 values, and match hashes produced by older systems - none
// of which is a security use. Do not use MD5 for anything that must resist
// collision attacks; see the hash generator page for why.
//
// Exposes window.md5(data) -> lowercase hex string, where data is a string
// (encoded as UTF-8), an ArrayBuffer, or a Uint8Array. Also md5Bytes(data)
// -> Uint8Array(16). Pure function, no dependencies.
(function () {
  'use strict';

  function toBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new TypeError('md5: expected string, ArrayBuffer or typed array');
  }

  // Per-round shift amounts and the sine-derived constants from the RFC.
  var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
           5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
           4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
           6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var K = new Int32Array(64);
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

  function md5Bytes(data) {
    var msg = toBytes(data);
    var len = msg.length;
    // Padding: 0x80, zeros to 56 mod 64, then the 64-bit little-endian bit length.
    var padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
    padded.set(msg);
    padded[len] = 0x80;
    var bitLenLo = (len * 8) >>> 0;
    var bitLenHi = Math.floor(len / 536870912) >>> 0; // len*8 / 2^32
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLenLo, true);
    view.setUint32(padded.length - 4, bitLenHi, true);

    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    var M = new Int32Array(16);

    for (var off = 0; off < padded.length; off += 64) {
      for (var j = 0; j < 16; j++) M[j] = view.getInt32(off + j * 4, true);
      var A = a0, B = b0, C = c0, D = d0;
      for (var r = 0; r < 64; r++) {
        var F, g;
        if (r < 16)      { F = (B & C) | (~B & D); g = r; }
        else if (r < 32) { F = (D & B) | (~D & C); g = (5 * r + 1) & 15; }
        else if (r < 48) { F = B ^ C ^ D;          g = (3 * r + 5) & 15; }
        else             { F = C ^ (B | ~D);       g = (7 * r) & 15; }
        var tmp = D; D = C; C = B;
        var x = (A + F + K[r] + M[g]) | 0;
        B = (B + ((x << S[r]) | (x >>> (32 - S[r])))) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new Uint8Array(16);
    var ov = new DataView(out.buffer);
    ov.setInt32(0, a0, true); ov.setInt32(4, b0, true); ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
    return out;
  }

  function md5(data) {
    var b = md5Bytes(data), s = '';
    for (var i = 0; i < 16; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }

  window.md5 = md5;
  window.md5Bytes = md5Bytes;
})();
