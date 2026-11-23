/* Layerbit streaming file reader: read a File or Blob of any size in slices,
 * without holding it in memory. No DOM; works in a page, in a Web Worker
 * and in Node 18+ (window.LBStream / self.LBStream / module.exports).
 *
 * chunks(blob, {chunkSize, signal, onProgress})
 *     async iterator of {offset, bytes}; Blob.slice reads one slice at a time
 * lines(blob, {chunkSize, encoding, signal, onProgress})
 *     async iterator of {number, text}; CRLF, LF and bare CR end a line, a
 *     line split across slices and a character split across slices are
 *     joined, and the last line needs no newline. The returned iterator's
 *     .encoding is the label used (detected from the first 64 KB unless
 *     given: BOM, then zero bytes for UTF-16, then strict UTF-8, else
 *     Windows-1252).
 * detectEncoding(bytes) -> 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
 *
 * Cancel with an AbortController: the next read throws an AbortError.
 * A tool that must not block the page runs this inside a Worker and posts
 * results back in batches.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBStream = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULT_CHUNK = 4 << 20;

  function abortError() { var e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; }
  function check(signal) { if (signal && signal.aborted) throw abortError(); }
  function readSlice(blob, start, end) { return blob.slice(start, end).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }

  function chunks(blob, opts) {
    opts = opts || {};
    var size = blob.size, step = opts.chunkSize || DEFAULT_CHUNK, offset = 0;
    var it = {};
    it.next = function () {
      check(opts.signal);
      if (offset >= size) return Promise.resolve({ done: true, value: undefined });
      var start = offset, end = Math.min(size, offset + step);
      offset = end;
      return readSlice(blob, start, end).then(function (bytes) {
        check(opts.signal);
        if (opts.onProgress) opts.onProgress(end, size);
        return { done: false, value: { offset: start, bytes: bytes } };
      });
    };
    it[Symbol.asyncIterator] = function () { return it; };
    return it;
  }

  function detectEncoding(u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return 'utf-8';
    if (u8[0] === 0xFF && u8[1] === 0xFE) return 'utf-16le';
    if (u8[0] === 0xFE && u8[1] === 0xFF) return 'utf-16be';
    var n = Math.min(u8.length, 4096) & ~1, ze = 0, zo = 0;
    for (var i = 0; i < n; i += 2) { if (u8[i] === 0) ze++; if (u8[i + 1] === 0) zo++; }
    if (n >= 4 && zo > n / 2 * 0.3 && ze < n / 2 * 0.05) return 'utf-16le';
    if (n >= 4 && ze > n / 2 * 0.3 && zo < n / 2 * 0.05) return 'utf-16be';
    // strict UTF-8 on the sample; a sequence cut at the end of the sample is fine
    var end = u8.length, k = end - 1, back = 0;
    while (k >= 0 && back < 3 && (u8[k] & 0xC0) === 0x80) { k--; back++; }
    if (k >= 0 && u8[k] >= 0xC0) end = k;
    try { new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(0, end)); return 'utf-8'; }
    catch (e) { return 'windows-1252'; }
  }

  function lines(blob, opts) {
    opts = opts || {};
    var src = chunks(blob, opts), decoder = null, buf = '', number = 0, queue = [], finished = false, pendingCR = false;
    var it = { encoding: opts.encoding || null };
    function push(text, final) {
      buf += text;
      var start = 0;
      for (var i = 0; i < buf.length; i++) {
        var c = buf.charCodeAt(i);
        if (c === 10 || c === 13) {
          if (c === 10 && pendingCR && i === start && i === 0) { pendingCR = false; start = i + 1; continue; }
          queue.push({ number: ++number, text: buf.slice(start, i) });
          if (c === 13) { if (i + 1 < buf.length) { if (buf.charCodeAt(i + 1) === 10) i++; } else pendingCR = true; }
          start = i + 1;
        } else pendingCR = false;
      }
      buf = buf.slice(start);
      if (final && buf.length) { queue.push({ number: ++number, text: buf }); buf = ''; }
    }
    function pull() {
      if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
      if (finished) return Promise.resolve({ done: true, value: undefined });
      // the encoding is decided once, from the first 64 KB of the file
      if (!decoder) return (it.encoding ? Promise.resolve(it.encoding) : readSlice(blob, 0, Math.min(blob.size, 65536)).then(detectEncoding)).then(function (label) {
        it.encoding = label; decoder = new TextDecoder(label); return pull();
      });
      return src.next().then(function (r) {
        if (r.done) {
          finished = true;
          push(decoder.decode(), true);
          return pull();
        }
        push(decoder.decode(r.value.bytes, { stream: true }), false);
        return pull();
      });
    }
    it.next = pull;
    it[Symbol.asyncIterator] = function () { return it; };
    return it;
  }

  return { chunks: chunks, lines: lines, detectEncoding: detectEncoding, DEFAULT_CHUNK: DEFAULT_CHUNK };
});
