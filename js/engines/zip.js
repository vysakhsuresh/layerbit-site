/* Layerbit zip: a small writer (stored, no compression) and a reader for
 * stored entries. Pure functions; browser (window.LBZip), Worker and Node.
 * Compressed archives are read by the Diff Checker's readZip, which uses the
 * browser's DecompressionStream.
 *
 * crc32(bytes) -> CRC-32 (IEEE)
 * zipStore([{name, data: Uint8Array | string}]) -> Uint8Array (UTF-8 names)
 * unzipStored(bytes) -> {name: {data, crc, method}} for stored entries
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBZip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  /** files: [{name, data: Uint8Array | string}] -> a stored (uncompressed) zip. */
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, now = new Date();
    var dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      parts.push(new Uint8Array(lh.buffer), name, data); central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (t, p) { return t + p.length; }, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]), out = new Uint8Array(off + cdSize + 22), p = 0;
    all.forEach(function (x) { out.set(x, p); p += x.length; });
    return out;
  }

  function unzipStored(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = {}, eocd = -1, td = new TextDecoder();
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file');
    var p = dv.getUint32(eocd + 16, true), n = dv.getUint16(eocd + 10, true);
    for (var k = 0; k < n; k++) {
      var method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true);
      var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      var lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), start = off + 30 + lnl + lel;
      out[name] = { method: method, crc: crc, data: method === 0 ? u8.subarray(start, start + size) : null };
      p += 46 + nl + el + cl;
    }
    return out;
  }
  return { crc32: crc32, zipStore: zipStore, unzipStored: unzipStored };
});
