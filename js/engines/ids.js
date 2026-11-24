/* Layerbit identifiers beyond UUID v3/v4/v5/v7 and ULID: UUID v1 and v6,
 * NanoID, KSUID, CUID2, Snowflake, and recognising/validating a list of
 * mixed ids. Pure functions; browser (window.LBIds) and Node.
 * Randomness comes from opts.random(n) -> Uint8Array (crypto by default).
 *
 * uuid1({ms, random}) / uuid6({ms, random})   random node with the multicast bit set
 * nanoid({size, alphabet, random})            unbiased (mask and retry)
 * ksuid({ms, random}) / parseKsuid(s) -> {ms, payload} | null
 * cuid2({length, random, hash}) -> Promise<string>   hash: async (string) -> hex SHA3-512
 * snowflake({ms, epoch, worker, sequence}) -> string / parseSnowflake(s, epoch) -> {ms, worker, sequence}
 * EPOCHS: {twitter, discord}
 * identify(s, {epoch}) -> {kind, valid, detail, ms?}
 * validate(lines, {expect, epoch}) -> {rows: [{line, value, kind, valid, detail, duplicateOf}], counts}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBIds = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function cryptoRandom(n) { var b = new Uint8Array(n); (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(b); return b; }
  var hex = function (b) { return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); };
  var layout = function (h) { return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); };
  var GREG = 122192928000000000n;   // 100 ns intervals from 1582-10-15 to 1970-01-01

  // ---------------------------------------------------------- UUID v1/v6
  var last = { ms: -1, n: 0 };
  function ticks(ms) {
    // up to 10,000 ids per millisecond stay unique and ordered
    if (ms === last.ms) last.n++; else { last.ms = ms; last.n = 0; }
    if (last.n > 9999) throw new Error('More than 10,000 time-based UUIDs in one millisecond');
    return BigInt(ms) * 10000n + BigInt(last.n) + GREG;
  }
  function tail(random) {
    var r = random(8);
    r[0] = (r[0] & 0x3f) | 0x80;   // variant, 14-bit clock sequence
    r[2] |= 0x01;                 // multicast bit: a random node, never a real MAC address (RFC 9562 §6.10)
    return hex(r);
  }
  function uuid1(o) {
    o = o || {};
    var t = ticks(o.ms == null ? Date.now() : o.ms), random = o.random || cryptoRandom;
    var low = (t & 0xffffffffn).toString(16).padStart(8, '0'), mid = ((t >> 32n) & 0xffffn).toString(16).padStart(4, '0'), hi = (((t >> 48n) & 0x0fffn) | 0x1000n).toString(16).padStart(4, '0');
    return layout(low + mid + hi + tail(random));
  }
  function uuid6(o) {
    o = o || {};
    var t = ticks(o.ms == null ? Date.now() : o.ms), random = o.random || cryptoRandom;
    var high = (t >> 12n).toString(16).padStart(12, '0'), low = ((t & 0xfffn) | 0x6000n).toString(16).padStart(4, '0');
    return layout(high + low + tail(random));
  }

  // --------------------------------------------------------------- NanoID
  var URL_ALPHA = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  function nanoid(o) {
    o = o || {};
    var size = o.size || 21, alpha = o.alphabet || URL_ALPHA, random = o.random || cryptoRandom;
    if (alpha.length < 2 || alpha.length > 256) throw new Error('The alphabet needs 2 to 256 characters');
    if (new Set(alpha).size !== alpha.length) throw new Error('The alphabet has a repeated character');
    var mask = (2 << (31 - Math.clz32((alpha.length - 1) | 1))) - 1, step = Math.ceil(1.6 * mask * size / alpha.length), id = '';
    while (true) {
      var bytes = random(step);
      for (var i = 0; i < step; i++) { var k = bytes[i] & mask; if (k < alpha.length) { id += alpha[k]; if (id.length === size) return id; } }
    }
  }

  // ---------------------------------------------------------------- KSUID
  var B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', KSUID_EPOCH = 1400000000;
  function ksuid(o) {
    o = o || {};
    var ms = o.ms == null ? Date.now() : o.ms, random = o.random || cryptoRandom;
    var secs = BigInt(Math.floor(ms / 1000) - KSUID_EPOCH);
    if (secs < 0n || secs > 0xffffffffn) throw new Error('KSUID covers 2014-05-13 to 2150');
    var n = (secs << 128n) | BigInt('0x' + hex(random(16))), s = '';
    while (n > 0n) { s = B62[Number(n % 62n)] + s; n /= 62n; }
    return s.padStart(27, '0');
  }
  function parseKsuid(s) {
    if (!/^[0-9A-Za-z]{27}$/.test(s)) return null;
    var n = 0n; for (var i = 0; i < 27; i++) n = n * 62n + BigInt(B62.indexOf(s[i]));
    if (n >> 160n) return null;
    return { ms: (Number(n >> 128n) + KSUID_EPOCH) * 1000, payload: (n & ((1n << 128n) - 1n)).toString(16).padStart(32, '0') };
  }

  // ---------------------------------------------------------------- CUID2
  var counter = null, fingerprint = null;
  function b36(random, n) { var s = ''; while (s.length < n) { var b = random(1)[0]; if (b < 252) s += (b % 36).toString(36); } return s; }
  async function cuid2(o) {
    o = o || {};
    var length = o.length || 24, random = o.random || cryptoRandom, hash = o.hash;
    if (!hash) throw new Error('cuid2 needs a SHA3-512 hash function');
    if (length < 2 || length > 32) throw new Error('CUID2 length is 2 to 32');
    var toB36 = async function (input) { var h = await hash(input); return BigInt('0x' + h).toString(36).slice(1); };
    if (counter === null) counter = Math.floor((random(4).reduce(function (a, b) { return a * 256 + b; }, 0) / 4294967296) * 476782367);
    if (fingerprint === null) fingerprint = (await toB36(b36(random, 32) + (typeof navigator !== 'undefined' ? navigator.userAgent : 'node'))).slice(0, 32);
    var letter = 'abcdefghijklmnopqrstuvwxyz'[random(1)[0] % 26];
    var input = Date.now().toString(36) + b36(random, length) + (counter++).toString(36) + fingerprint;
    return letter + (await toB36(input)).slice(1, length);
  }

  // ------------------------------------------------------------ Snowflake
  var EPOCHS = { twitter: 1288834974657, discord: 1420070400000 };
  var sf = { ms: -1, seq: 0 };
  function snowflake(o) {
    o = o || {};
    var ms = o.ms == null ? Date.now() : o.ms, epoch = o.epoch == null ? EPOCHS.twitter : o.epoch, worker = o.worker || 0;
    if (worker < 0 || worker > 1023) throw new Error('The machine id is 0 to 1023 (10 bits)');
    var seq = o.sequence;
    if (seq == null) { if (ms === sf.ms) sf.seq = (sf.seq + 1) & 4095; else { sf.ms = ms; sf.seq = 0; } seq = sf.seq; }
    var t = BigInt(ms - epoch);
    if (t < 0n) throw new Error('The time is before the epoch');
    return String((t << 22n) | (BigInt(worker) << 12n) | BigInt(seq));
  }
  function parseSnowflake(s, epoch) {
    if (!/^\d{1,20}$/.test(s)) return null;
    var n = BigInt(s); if (n >> 64n) return null;
    epoch = epoch == null ? EPOCHS.twitter : epoch;
    return { ms: Number(n >> 22n) + epoch, worker: Number((n >> 12n) & 1023n), datacenter: Number((n >> 17n) & 31n), machine: Number((n >> 12n) & 31n), sequence: Number(n & 4095n) };
  }

  // ------------------------------------------------------ identify a value
  var ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i, B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function iso(ms) { return isFinite(ms) ? new Date(ms).toISOString() : '?'; }
  function identify(s, o) {
    o = o || {};
    s = String(s).trim();
    var raw = s.replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/, '$1');
    if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(raw)) {
      var h = raw.replace(/-/g, '').toLowerCase(), v = parseInt(h[12], 16), variant = parseInt(h[16], 16);
      if (h === '0'.repeat(32)) return { kind: 'uuid-nil', valid: true, detail: 'Nil UUID' };
      if (h === 'f'.repeat(32)) return { kind: 'uuid-max', valid: true, detail: 'Max UUID' };
      if ((variant & 0xc) !== 0x8) return { kind: 'uuid', valid: false, detail: 'not the RFC 9562 variant (17th hex digit is ' + h[16] + ', expected 8, 9, a or b)' };
      if (v < 1 || v > 8) return { kind: 'uuid', valid: false, detail: 'version ' + v + ' does not exist' };
      var r = { kind: 'uuid-v' + v, valid: true, detail: 'UUID version ' + v };
      if (v === 7) { r.ms = parseInt(h.slice(0, 12), 16); r.detail += ', ' + iso(r.ms); }
      if (v === 1 || v === 6) {
        var t = v === 1 ? (BigInt('0x' + h.slice(13, 16)) << 48n) | (BigInt('0x' + h.slice(8, 12)) << 32n) | BigInt('0x' + h.slice(0, 8)) : (BigInt('0x' + h.slice(0, 12)) << 12n) | BigInt('0x' + h.slice(13, 16));
        r.ms = Number((t - GREG) / 10000n); r.detail += ', ' + iso(r.ms);
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)) r.detail += ' (not in canonical lowercase hyphenated form)';
      return r;
    }
    if (ULID.test(s)) { var n = 0n; for (var i = 0; i < 26; i++) n = (n << 5n) | BigInt(B32.indexOf(s[i].toUpperCase())); var ms = Number(n >> 80n); return { kind: 'ulid', valid: true, ms: ms, detail: 'ULID, ' + iso(ms) }; }
    var k = parseKsuid(s);
    if (k) return { kind: 'ksuid', valid: true, ms: k.ms, detail: 'KSUID, ' + iso(k.ms) };
    if (/^\d{15,20}$/.test(s)) { var p = parseSnowflake(s, o.epoch); if (p) return { kind: 'snowflake', valid: true, ms: p.ms, detail: 'Snowflake, ' + iso(p.ms) + ', machine ' + p.worker + ', sequence ' + p.sequence }; }
    if (/^[a-z][0-9a-z]{23}$/.test(s)) return { kind: 'cuid2', valid: true, detail: 'CUID2 shape (24 lowercase base-36 characters starting with a letter); CUID2 carries no readable data' };
    if (/^[A-Za-z0-9_-]{21}$/.test(s)) return { kind: 'nanoid', valid: true, detail: 'NanoID shape (21 URL-safe characters); NanoID carries no readable data' };
    return { kind: 'unknown', valid: false, detail: 'not a UUID, ULID, KSUID, Snowflake, CUID2 or NanoID' };
  }
  function validate(lines, o) {
    o = o || {};
    var seen = Object.create(null), rows = [], counts = { total: 0, valid: 0, invalid: 0, duplicates: 0, kinds: {} };
    lines.forEach(function (line, i) {
      var v = String(line).trim().replace(/^["']|["'],?$/g, '').replace(/,$/, '');
      if (!v) return;
      var id = identify(v, o), ok = id.valid;
      if (o.expect && o.expect !== 'any') {
        var match = o.expect === 'uuid' ? /^uuid/.test(id.kind) : id.kind === o.expect;
        if (!match) { ok = false; id.detail = 'expected ' + o.expect + ', found ' + id.kind + (id.kind === 'unknown' ? '' : ' (' + id.detail + ')'); }
      }
      var key = /^uuid/.test(id.kind) ? v.toLowerCase().replace(/[{}-]|^urn:uuid:/g, '') : id.kind === 'ulid' ? v.toUpperCase() : v;
      var dup = seen[key];
      if (dup === undefined) seen[key] = i + 1; else counts.duplicates++;
      counts.total++; if (ok) counts.valid++; else counts.invalid++;
      counts.kinds[id.kind] = (counts.kinds[id.kind] || 0) + 1;
      rows.push({ line: i + 1, value: v, kind: id.kind, valid: ok, detail: id.detail, ms: id.ms, duplicateOf: dup });
    });
    return { rows: rows, counts: counts };
  }

  return { uuid1: uuid1, uuid6: uuid6, nanoid: nanoid, ksuid: ksuid, parseKsuid: parseKsuid, cuid2: cuid2, snowflake: snowflake, parseSnowflake: parseSnowflake, EPOCHS: EPOCHS, identify: identify, validate: validate, URL_ALPHA: URL_ALPHA };
});
