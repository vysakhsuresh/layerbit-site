/* Layerbit Base64 engine: encoding with MIME/PEM line wrapping, tolerant
 * decoding that reports where input goes wrong, file-type detection from
 * magic bytes, a hex dump, text encodings beyond UTF-8, and streaming over
 * Blobs so 100 MB+ files never become one giant string. Pure functions;
 * browser (window.LBB64), Worker and Node 18+.
 *
 * encode(bytes, {urlSafe, wrap, newline}) -> string      wrap: 0, 64 (PEM) or 76 (MIME)
 * decode(text) -> Uint8Array    (throws Error with .position for the first bad character)
 * magic(bytes) -> {mime, ext, name} | null
 * hexdump(bytes, {max, offset}) -> string
 * textToBytes(text, encoding) / bytesToText(bytes, encoding)
 *   encodings: utf-8, utf-8-bom, utf-16le, utf-16be, windows-1252, iso-8859-1
 * encodeBlob(blob, opts, onProgress) -> Promise<Blob>   (text/plain Base64)
 * decodeBlob(blob, onProgress) -> Promise<Blob>         (bytes, typed from magic)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBB64 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var REV = new Int16Array(256).fill(-1);
  for (var i = 0; i < 64; i++) REV[A.charCodeAt(i)] = i;
  REV[45] = 62; REV[95] = 63;   // - and _ (base64url)

  function raw(bytes) {
    var out = [], n = bytes.length, i = 0, CH = 3 * 8192;
    for (; i + 2 < n;) {
      var end = Math.min(n - (n - i) % 3, i + CH), s = '';
      for (; i < end; i += 3) { var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; s += A[v >> 18] + A[(v >> 12) & 63] + A[(v >> 6) & 63] + A[v & 63]; }
      out.push(s);
    }
    if (n - i === 1) { var a = bytes[i]; out.push(A[a >> 2] + A[(a & 3) << 4] + '=='); }
    else if (n - i === 2) { var b = (bytes[i] << 8) | bytes[i + 1]; out.push(A[b >> 10] + A[(b >> 4) & 63] + A[(b & 15) << 2] + '='); }
    return out.join('');
  }
  function shape(s, opts) {
    opts = opts || {};
    if (opts.urlSafe) s = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    var w = opts.wrap | 0;
    if (w > 0 && s.length > w) { var nl = opts.newline || '\r\n', parts = []; for (var i = 0; i < s.length; i += w) parts.push(s.slice(i, i + w)); s = parts.join(nl); }
    return s;
  }
  function encode(bytes, opts) { return shape(raw(bytes), opts); }

  function decode(text) {
    var s = String(text), n = s.length, out = new Uint8Array(Math.ceil(n * 3 / 4)), o = 0, acc = 0, bits = 0, pad = 0, count = 0;
    for (var i = 0; i < n; i++) {
      var c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) continue;
      if (c === 61) { pad++; continue; }
      var v = c < 256 ? REV[c] : -1;
      if (v < 0 || pad) {
        var e = new Error(pad ? 'Data after the = padding at position ' + (i + 1) : 'Character "' + s[i] + '" at position ' + (i + 1) + ' is not Base64');
        e.position = i; throw e;
      }
      acc = (acc << 6) | v; bits += 6; count++;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    if (count % 4 === 1) { var e2 = new Error('The input is one character too long or too short: ' + count + ' Base64 characters cannot be decoded'); e2.position = n; throw e2; }
    return out.subarray(0, o);
  }

  // ---------------------------------------------------------------- magic
  function has(b, off, sig) { if (b.length < off + sig.length) return false; for (var i = 0; i < sig.length; i++) if (sig[i] !== null && b[off + i] !== sig[i]) return false; return true; }
  function ascii(b, off, len) { var s = ''; for (var i = off; i < Math.min(b.length, off + len); i++) s += String.fromCharCode(b[i]); return s; }
  function zipKind(b) {
    // the first entry's name says which Office or archive format it is
    var name = has(b, 0, [0x50, 0x4b, 3, 4]) ? ascii(b, 30, b[26] | (b[27] << 8)) : '';
    var head = ascii(b, 0, Math.min(b.length, 4096));
    if (name === 'mimetype') { if (/application\/epub\+zip/.test(head)) return { mime: 'application/epub+zip', ext: 'epub', name: 'EPUB e-book' }; if (/opendocument\.text/.test(head)) return { mime: 'application/vnd.oasis.opendocument.text', ext: 'odt', name: 'OpenDocument text' }; }
    if (/word\//.test(head)) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', name: 'Word document' };
    if (/xl\//.test(head)) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', name: 'Excel workbook' };
    if (/ppt\//.test(head)) return { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', name: 'PowerPoint presentation' };
    if (/AndroidManifest\.xml/.test(head)) return { mime: 'application/vnd.android.package-archive', ext: 'apk', name: 'Android package' };
    if (/META-INF\//.test(head)) return { mime: 'application/java-archive', ext: 'jar', name: 'Java archive' };
    return { mime: 'application/zip', ext: 'zip', name: 'ZIP archive' };
  }
  var SIGS = [
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png', 'png', 'PNG image'],
    [[0xff, 0xd8, 0xff], 'image/jpeg', 'jpg', 'JPEG image'],
    [[0x47, 0x49, 0x46, 0x38], 'image/gif', 'gif', 'GIF image'],
    [[0x42, 0x4d], 'image/bmp', 'bmp', 'BMP image', function (b) { return b.length > 14 && (b[14] === 12 || b[14] === 40 || b[14] === 56 || b[14] === 108 || b[14] === 124); }],
    [[0, 0, 1, 0], 'image/x-icon', 'ico', 'Windows icon'],
    [[0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf', 'pdf', 'PDF document'],
    [[0x1f, 0x8b], 'application/gzip', 'gz', 'gzip data'],
    [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 'application/x-7z-compressed', '7z', '7-Zip archive'],
    [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], 'application/vnd.rar', 'rar', 'RAR archive'],
    [[0x42, 0x5a, 0x68], 'application/x-bzip2', 'bz2', 'bzip2 data'],
    [[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 'application/x-xz', 'xz', 'xz data'],
    [[0x28, 0xb5, 0x2f, 0xfd], 'application/zstd', 'zst', 'Zstandard data'],
    [[0x49, 0x44, 0x33], 'audio/mpeg', 'mp3', 'MP3 audio (ID3)'],
    [[0xff, 0xfb], 'audio/mpeg', 'mp3', 'MP3 audio'],
    [[0x4f, 0x67, 0x67, 0x53], 'audio/ogg', 'ogg', 'Ogg media'],
    [[0x66, 0x4c, 0x61, 0x43], 'audio/flac', 'flac', 'FLAC audio'],
    [[0x1a, 0x45, 0xdf, 0xa3], 'video/webm', 'webm', 'WebM / Matroska video'],
    [[0x77, 0x4f, 0x46, 0x46], 'font/woff', 'woff', 'WOFF font'],
    [[0x77, 0x4f, 0x46, 0x32], 'font/woff2', 'woff2', 'WOFF2 font'],
    [[0x00, 0x01, 0x00, 0x00, 0x00], 'font/ttf', 'ttf', 'TrueType font'],
    [[0x4f, 0x54, 0x54, 0x4f], 'font/otf', 'otf', 'OpenType font'],
    [[0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66], 'application/vnd.sqlite3', 'sqlite', 'SQLite database'],
    [[0x00, 0x61, 0x73, 0x6d], 'application/wasm', 'wasm', 'WebAssembly module'],
    [[0x7f, 0x45, 0x4c, 0x46], 'application/x-elf', 'elf', 'ELF executable (Linux)'],
    [[0x4d, 0x5a], 'application/vnd.microsoft.portable-executable', 'exe', 'Windows executable (PE)'],
    [[0xca, 0xfe, 0xba, 0xbe], 'application/java-vm', 'class', 'Java class file'],
    [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'application/x-ole-storage', 'doc', 'Old Office document (OLE)'],
    [[0x30, 0x82], 'application/pkix-cert', 'der', 'DER certificate or key (ASN.1)']
  ];
  function magic(b) {
    if (!b || !b.length) return null;
    if (has(b, 0, [0x50, 0x4b, 3, 4]) || has(b, 0, [0x50, 0x4b, 5, 6])) return zipKind(b);
    if (has(b, 0, [0x52, 0x49, 0x46, 0x46])) {
      var t = ascii(b, 8, 4);
      if (t === 'WEBP') return { mime: 'image/webp', ext: 'webp', name: 'WebP image' };
      if (t === 'WAVE') return { mime: 'audio/wav', ext: 'wav', name: 'WAV audio' };
      if (t === 'AVI ') return { mime: 'video/x-msvideo', ext: 'avi', name: 'AVI video' };
    }
    if (ascii(b, 4, 4) === 'ftyp') {
      var brand = ascii(b, 8, 4);
      if (/^(avif|avis)$/.test(brand)) return { mime: 'image/avif', ext: 'avif', name: 'AVIF image' };
      if (/^(heic|heix|mif1)$/.test(brand)) return { mime: 'image/heic', ext: 'heic', name: 'HEIC image' };
      if (/^M4A/.test(brand)) return { mime: 'audio/mp4', ext: 'm4a', name: 'M4A audio' };
      if (/^qt/.test(brand)) return { mime: 'video/quicktime', ext: 'mov', name: 'QuickTime video' };
      return { mime: 'video/mp4', ext: 'mp4', name: 'MP4 video' };
    }
    for (var i = 0; i < SIGS.length; i++) { var s = SIGS[i]; if (has(b, 0, s[0]) && (!s[4] || s[4](b))) return { mime: s[1], ext: s[2], name: s[3] }; }
    // text formats
    var head = ascii(b, 0, 512).replace(/^﻿|^\xef\xbb\xbf/, '').trimStart();
    if (/^-----BEGIN [A-Z0-9 ]+-----/.test(head)) return { mime: 'application/x-pem-file', ext: 'pem', name: 'PEM text (' + /^-----BEGIN ([A-Z0-9 ]+)-----/.exec(head)[1].toLowerCase() + ')' };
    if (/^<svg[\s>]/i.test(head) || (/^<\?xml/.test(head) && /<svg[\s>]/i.test(head))) return { mime: 'image/svg+xml', ext: 'svg', name: 'SVG image' };
    if (/^<\?xml/.test(head)) return { mime: 'application/xml', ext: 'xml', name: 'XML document' };
    if (/^<!doctype html|^<html[\s>]/i.test(head)) return { mime: 'text/html', ext: 'html', name: 'HTML document' };
    if (/^[\[{]/.test(head)) { try { JSON.parse(ascii(b, 0, b.length).replace(/^﻿/, '')); return { mime: 'application/json', ext: 'json', name: 'JSON' }; } catch (e) { /* not JSON */ } }
    return null;
  }

  // ------------------------------------------------------------- hex dump
  function hexdump(b, opts) {
    opts = opts || {};
    var max = Math.min(b.length, opts.max || 512), base = opts.offset || 0, lines = [];
    for (var i = 0; i < max; i += 16) {
      var hex = '', txt = '';
      for (var j = 0; j < 16; j++) {
        if (i + j < max) { var v = b[i + j]; hex += (v < 16 ? '0' : '') + v.toString(16) + ' '; txt += v >= 32 && v < 127 ? String.fromCharCode(v) : '.'; }
        else hex += '   ';
        if (j === 7) hex += ' ';
      }
      lines.push(('0000000' + (base + i).toString(16)).slice(-8) + '  ' + hex + ' |' + txt + '|');
    }
    return lines.join('\n');
  }

  // ------------------------------------------------------- text encodings
  var CP1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178 };
  var TO1252 = {}; Object.keys(CP1252).forEach(function (k) { TO1252[CP1252[k]] = +k; });
  function textToBytes(text, enc) {
    enc = (enc || 'utf-8').toLowerCase();
    var s = String(text), out, i;
    if (enc === 'utf-8' || enc === 'utf-8-bom') {
      var u = new TextEncoder().encode(s);
      if (enc === 'utf-8') return u;
      out = new Uint8Array(u.length + 3); out.set([0xef, 0xbb, 0xbf]); out.set(u, 3); return out;
    }
    if (enc === 'utf-16le' || enc === 'utf-16be') {
      out = new Uint8Array(s.length * 2);
      for (i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (enc === 'utf-16le') { out[2 * i] = c & 255; out[2 * i + 1] = c >> 8; } else { out[2 * i] = c >> 8; out[2 * i + 1] = c & 255; } }
      return out;
    }
    if (enc === 'windows-1252' || enc === 'iso-8859-1') {
      out = new Uint8Array(s.length); var bad = [];
      for (i = 0; i < s.length; i++) {
        var cp = s.charCodeAt(i), v = cp < 0x80 || (cp >= 0xa0 && cp < 0x100) || (enc === 'iso-8859-1' && cp >= 0x80 && cp < 0xa0) ? cp : (enc === 'windows-1252' ? TO1252[cp] : undefined);
        if (v === undefined) { bad.push(s[i]); v = 0x3f; }
        out[i] = v;
      }
      if (bad.length) { var e = new Error(bad.length + ' character' + (bad.length === 1 ? '' : 's') + ' cannot be written in ' + enc + ' (for example "' + bad[0] + '"), so ' + (bad.length === 1 ? 'it was' : 'they were') + ' replaced with ?'); e.bytes = out; throw e; }
      return out;
    }
    throw new Error('Unknown encoding ' + enc);
  }
  function bytesToText(bytes, enc) {
    enc = (enc || 'utf-8').toLowerCase();
    if (enc === 'utf-8-bom') enc = 'utf-8';
    if (enc === 'iso-8859-1') { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; }
    return new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(bytes);
  }

  // ------------------------------------------------------------ streaming
  async function encodeBlob(blob, opts, onProgress) {
    opts = opts || {};
    // a slice must be a multiple of 3 bytes, and of a whole wrapped line
    var w = opts.wrap | 0, per = w ? (w / 4) * 3 : 3, size = per * Math.max(1, Math.floor((1 << 22) / per)), parts = [], nl = opts.newline || '\r\n';
    for (var off = 0; off < blob.size; off += size) {
      var b = new Uint8Array(await blob.slice(off, off + size).arrayBuffer());
      var s = raw(b);
      if (opts.urlSafe) { s = s.replace(/\+/g, '-').replace(/\//g, '_'); if (off + size >= blob.size) s = s.replace(/=+$/, ''); }
      if (w) { var lines = []; for (var i = 0; i < s.length; i += w) lines.push(s.slice(i, i + w)); s = lines.join(nl) + (off + size < blob.size ? nl : ''); }
      parts.push(s);
      if (onProgress) onProgress(Math.min(blob.size, off + size), blob.size);
    }
    return new Blob(parts, { type: 'text/plain' });
  }
  async function decodeBlob(blob, onProgress) {
    var size = 1 << 22, parts = [], carry = '', first = null, seen = 0;
    for (var off = 0; off < blob.size; off += size) {
      var text = carry + new TextDecoder('latin1').decode(new Uint8Array(await blob.slice(off, off + size).arrayBuffer()));
      var clean = text.replace(/[\s]/g, '');
      if (off === 0) clean = clean.replace(/^data:[^,]*,/, '');
      var last = off + size >= blob.size, keep = last ? clean.length : clean.length - clean.length % 4;
      try { var bytes = decode(clean.slice(0, keep)); }
      catch (e) { if (e.position !== undefined) { e.message = e.message.replace(/position (\d+)/, function (_, p) { return 'position ' + (seen + +p).toLocaleString('en-US') + ' (ignoring line breaks)'; }); } throw e; }
      seen += keep;
      carry = clean.slice(keep);
      if (!first) first = bytes.slice(0, 4096);
      parts.push(bytes);
      if (onProgress) onProgress(Math.min(blob.size, off + size), blob.size);
    }
    var m = magic(first || new Uint8Array(0));
    var out = new Blob(parts, { type: m ? m.mime : 'application/octet-stream' });
    out.detected = m;
    return out;
  }

  return { encode: encode, decode: decode, magic: magic, hexdump: hexdump, textToBytes: textToBytes, bytesToText: bytesToText, encodeBlob: encodeBlob, decodeBlob: decodeBlob };
});
