/* Layerbit epochs: the other clocks a timestamp can be written in, converted
 * exactly through BigInt nanoseconds since the Unix epoch. Pure functions;
 * browser (window.LBEpochs) and Node.
 *
 * FORMATS: [{id, name, unit, epoch}]
 * toNs(id, text) -> BigInt ns since 1970-01-01T00:00:00Z   (throws Error with a readable message)
 * fromNs(id, ns) -> string  (the value in that format)
 * all(ns) -> {id: string}   every format at once, plus gpsWeek, filetimeHex
 * guess(text) -> [id]       formats a bare number plausibly is, most likely first
 * leapSeconds(unixSeconds) -> GPS-UTC offset in seconds at that instant
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBEpochs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 1000000000n, MS = 1000000n, DAY_NS = 86400n * NS;
  // seconds from each epoch to the Unix epoch
  var DOTNET0 = 62135596800n, FILETIME0 = 11644473600n, COCOA0 = 978307200n, GPS0 = 315964800n, HFS0 = 2082844800n;
  var FORMATS = [
    { id: 'unix', name: 'Unix seconds', unit: 's', epoch: '1970-01-01' },
    { id: 'unix_ms', name: 'Unix milliseconds', unit: 'ms', epoch: '1970-01-01' },
    { id: 'unix_us', name: 'Unix microseconds', unit: 'µs', epoch: '1970-01-01' },
    { id: 'unix_ns', name: 'Unix nanoseconds', unit: 'ns', epoch: '1970-01-01' },
    { id: 'dotnet', name: '.NET ticks (DateTime.Ticks)', unit: '100 ns', epoch: '0001-01-01' },
    { id: 'filetime', name: 'Windows FILETIME / LDAP / Active Directory', unit: '100 ns', epoch: '1601-01-01' },
    { id: 'excel', name: 'Excel serial date (1900 system)', unit: 'days', epoch: '1899-12-30' },
    { id: 'excel1904', name: 'Excel serial date (1904 system, old Mac)', unit: 'days', epoch: '1904-01-01' },
    { id: 'cocoa', name: 'Apple Cocoa / Core Data (NSDate)', unit: 's', epoch: '2001-01-01' },
    { id: 'gps', name: 'GPS time', unit: 's', epoch: '1980-01-06' },
    { id: 'webkit', name: 'WebKit / Chrome time', unit: 'µs', epoch: '1601-01-01' },
    { id: 'hfs', name: 'Mac HFS+ seconds', unit: 's', epoch: '1904-01-01' }
  ];
  // UTC instants (Unix seconds) at which GPS-UTC grew by one second, from 1980
  var LEAPS = ['1981-07-01', '1982-07-01', '1983-07-01', '1985-07-01', '1988-01-01', '1990-01-01', '1991-01-01', '1992-07-01', '1993-07-01', '1994-07-01', '1996-01-01', '1997-07-01', '1999-01-01', '2006-01-01', '2009-01-01', '2012-07-01', '2015-07-01', '2017-01-01']
    .map(function (d) { return BigInt(Date.parse(d + 'T00:00:00Z') / 1000); });
  function leapSeconds(unixS) { var n = 0; for (var i = 0; i < LEAPS.length; i++) if (BigInt(unixS) >= LEAPS[i]) n++; return n; }

  function int(text, what) {
    var s = String(text).trim().replace(/[_,\s]/g, '');
    if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
    if (!/^-?\d+$/.test(s)) throw new Error('"' + text + '" is not a whole number of ' + what);
    return BigInt(s);
  }
  // a decimal string to BigInt nanoseconds of the given unit (ns per unit), exactly
  function decimal(text, nsPerUnit, what) {
    var s = String(text).trim().replace(/[_,\s]/g, ''), m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error('"' + text + '" is not a number of ' + what);
    var frac = (m[3] || '').slice(0, 18), den = 10n ** BigInt(frac.length);
    var v = BigInt(m[2]) * nsPerUnit + (frac ? (BigInt(frac) * nsPerUnit + den / 2n) / den : 0n);
    return m[1] ? -v : v;
  }
  function toNs(id, text) {
    switch (id) {
      case 'unix': return decimal(text, NS, 'seconds');
      case 'unix_ms': return decimal(text, MS, 'milliseconds');
      case 'unix_us': return decimal(text, 1000n, 'microseconds');
      case 'unix_ns': return int(text, 'nanoseconds');
      case 'dotnet': { var t = int(text, '.NET ticks'); if (t < 0n || t > 3155378975999999999n) throw new Error('.NET ticks run from 0 (year 1) to 3155378975999999999 (year 9999)'); return t * 100n - DOTNET0 * NS; }
      case 'filetime': {
        var s = String(text).trim();
        var hl = /^(?:0x)?([0-9a-f]{1,8})\s*[:\s]\s*(?:0x)?([0-9a-f]{1,8})$/i.exec(s);   // "high:low" DWORDs
        var f = hl ? (BigInt('0x' + hl[1]) << 32n) | BigInt('0x' + hl[2]) : int(s, '100-nanosecond intervals');
        if (f === 0n || f === 9223372036854775807n) throw new Error(f === 0n ? 'In Active Directory, 0 means "never" (for example, an account that has never logged on).' : 'In Active Directory, 9223372036854775807 means "never expires".');
        if (f < 0n) throw new Error('FILETIME values are not negative');
        return f * 100n - FILETIME0 * NS;
      }
      case 'excel': {
        var d = decimal(text, DAY_NS, 'days');
        if (d < 61n * DAY_NS && d >= 0n) {
          // Excel's 1900 system counts 29 Feb 1900, which never happened
          if (d >= 60n * DAY_NS) throw new Error('Serial 60 is 29 February 1900, a day that did not exist: Excel keeps it for compatibility with Lotus 1-2-3.');
          d += DAY_NS;
        }
        return d - 25569n * DAY_NS;
      }
      case 'excel1904': return decimal(text, DAY_NS, 'days') - 24107n * DAY_NS;
      case 'cocoa': return decimal(text, NS, 'seconds') + COCOA0 * NS;
      case 'hfs': return decimal(text, NS, 'seconds') - HFS0 * NS;
      case 'webkit': return decimal(text, 1000n, 'microseconds') - FILETIME0 * NS;
      case 'gps': {
        // plain seconds, or "week:seconds-of-week" (also "2345w100800")
        var wk = /^(\d+)\s*[:w]\s*(\d+(?:\.\d+)?)$/i.exec(String(text).trim());
        var g = wk ? BigInt(wk[1]) * 604800n * NS + decimal(wk[2], NS, 'seconds') : decimal(text, NS, 'seconds');
        var u = g + GPS0 * NS, sec = u / NS;
        // remove the leap seconds GPS had gained by then (look up on the UTC side)
        var n = leapSeconds(sec - BigInt(leapSeconds(sec)));
        return u - BigInt(n) * NS;
      }
    }
    throw new Error('Unknown format ' + id);
  }
  function div(ns, unit, places) {
    // exact decimal of ns / unit with up to `places` digits, trailing zeros trimmed
    var neg = ns < 0n, a = neg ? -ns : ns, whole = a / unit, rem = a % unit, out = String(whole);
    if (places && rem) {
      var f = (rem * 10n ** BigInt(places) + unit / 2n) / unit, fs = String(f).padStart(places, '0');
      if (fs.length > places) { whole += 1n; out = String(whole); fs = ''; }
      fs = fs.replace(/0+$/, ''); if (fs) out += '.' + fs;
    }
    return (neg && out !== '0' ? '-' : '') + out;
  }
  function floor(ns, unit) { var q = ns / unit; if (ns < 0n && q * unit !== ns) q -= 1n; return q; }
  function fromNs(id, ns) {
    switch (id) {
      case 'unix': return div(ns, NS, 9);
      case 'unix_ms': return div(ns, MS, 6);
      case 'unix_us': return div(ns, 1000n, 3);
      case 'unix_ns': return String(ns);
      case 'dotnet': return String(floor(ns + DOTNET0 * NS, 100n));
      case 'filetime': return String(floor(ns + FILETIME0 * NS, 100n));
      case 'excel': { var d = ns + 25569n * DAY_NS; if (d < 61n * DAY_NS) d -= DAY_NS; return div(d, DAY_NS, 8); }
      case 'excel1904': return div(ns + 24107n * DAY_NS, DAY_NS, 8);
      case 'cocoa': return div(ns - COCOA0 * NS, NS, 6);
      case 'hfs': return String(floor(ns + HFS0 * NS, NS));
      case 'webkit': return String(floor(ns + FILETIME0 * NS, 1000n));
      case 'gps': return div(ns - GPS0 * NS + BigInt(leapSeconds(floor(ns, NS))) * NS, NS, 9);
    }
    throw new Error('Unknown format ' + id);
  }
  function all(ns) {
    var o = {};
    FORMATS.forEach(function (f) { try { o[f.id] = fromNs(f.id, ns); } catch (e) { o[f.id] = ''; } });
    var ft = floor(ns + FILETIME0 * NS, 100n);
    o.filetimeHex = ft >= 0n ? '0x' + ft.toString(16).toUpperCase().padStart(16, '0') : '';
    if (ft >= 0n) { var hx = ft.toString(16).toUpperCase().padStart(16, '0'); o.filetimeDwords = '0x' + hx.slice(0, 8) + ':0x' + hx.slice(8); }
    var g = floor(ns - GPS0 * NS + BigInt(leapSeconds(floor(ns, NS))) * NS, NS);
    o.gpsWeek = g >= 0n ? String(g / 604800n) : '';
    o.gpsTow = g >= 0n ? String(g % 604800n) : '';
    o.leap = leapSeconds(floor(ns, NS));
    return o;
  }
  /** Formats a bare number plausibly is, most likely first (by magnitude, for dates 1990-2100). */
  function guess(text, opts) {
    var s = String(text).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return [];
    var out = [], lo = Date.UTC(1990, 0, 1) * 1000000, hi = Date.UTC(2100, 0, 1) * 1000000, now = (opts && opts.now || Date.now()) * 1000000;
    ['unix', 'unix_ms', 'unix_us', 'unix_ns', 'filetime', 'dotnet', 'webkit', 'excel', 'cocoa', 'gps'].forEach(function (id) {
      if (/\./.test(s) && /^(unix_ns|dotnet|filetime|webkit)$/.test(id)) return;
      try { var ns = Number(toNs(id, s)); if (ns >= lo && ns < hi) out.push([id, Math.abs(ns - now)]); } catch (e) { /* not this one */ }
    });
    // the reading closest to today is the most likely one
    return out.sort(function (a, b) { return a[1] - b[1]; }).map(function (x) { return x[0]; });
  }
  return { FORMATS: FORMATS, toNs: toNs, fromNs: fromNs, all: all, guess: guess, leapSeconds: leapSeconds };
});
