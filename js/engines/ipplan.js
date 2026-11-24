/* Layerbit IP planning: VLSM allocation, IPv6 planning, range to minimal CIDR
 * list, overlap / conflict checks, aggregation and free space. Exact BigInt
 * arithmetic for IPv4 and IPv6. Pure functions; browser (window.LBIPPlan), Node.
 *
 * parse(text) -> {family, bits, addr, prefix}           (throws Error with a readable message)
 * block(p) -> {family, bits, prefix, network, last, size, firstHost, lastHost, usable}
 * fmt(family, v) -> string ; cidr(b) -> "net/prefix"
 * vlsm(parent, [{name, hosts}], {p2p31, nibble}) -> {ok, error, allocations, free, used, total}
 *   IPv4: hosts = usable hosts needed. IPv6: hosts = /64 subnets needed.
 * rangeToCidrs(startText, endText) -> [cidr string]  (also accepts "a - b" as the first argument)
 * conflicts(lines) -> {blocks, invalid, findings: [{a, b, kind}], aggregate: [cidr string]}
 * aggregate(blocks) -> [block]   (merge overlapping and adjacent blocks into the fewest CIDRs)
 * free(parent, used) -> [block]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBIPPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MASK = { 4: (1n << 32n) - 1n, 6: (1n << 128n) - 1n };

  function parseIPv4(s) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    var v = 0n;
    for (var i = 1; i <= 4; i++) { var o = Number(m[i]); if (o > 255 || (m[i].length > 1 && m[i][0] === '0')) return null; v = (v << 8n) | BigInt(o); }
    return v;
  }
  function parseIPv6(s) {
    s = String(s).trim();
    if (!/^[0-9a-fA-F:.]+$/.test(s) || s.indexOf(':') < 0) return null;
    var last = s.lastIndexOf(':');
    if (s.indexOf('.') > last) {
      var tail = parseIPv4(s.slice(last + 1)); if (tail === null) return null;
      s = s.slice(0, last + 1) + ((tail >> 16n) & 0xffffn).toString(16) + ':' + (tail & 0xffffn).toString(16);
    }
    var dbl = s.split('::'); if (dbl.length > 2) return null;
    var head = dbl[0] ? dbl[0].split(':') : [], rest = dbl.length === 2 && dbl[1] ? dbl[1].split(':') : [];
    if (dbl.length === 1 && head.length !== 8) return null;
    if (head.length + rest.length > (dbl.length === 2 ? 7 : 8)) return null;
    var groups = dbl.length === 2 ? head.concat(new Array(8 - head.length - rest.length).fill('0'), rest) : head, v = 0n;
    for (var i = 0; i < groups.length; i++) { if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null; v = (v << 16n) | BigInt(parseInt(groups[i], 16)); }
    return v;
  }
  function fmt4(v) { return [24n, 16n, 8n, 0n].map(function (sh) { return Number((v >> sh) & 0xffn); }).join('.'); }
  function fmt6(v) {
    var g = []; for (var i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn));
    var best = -1, bestLen = 0, cur = -1, curLen = 0;
    g.forEach(function (x, i) { if (x === 0) { if (cur < 0) { cur = i; curLen = 0; } curLen++; if (curLen > bestLen) { best = cur; bestLen = curLen; } } else cur = -1; });
    var h = g.map(function (x) { return x.toString(16); });
    return bestLen >= 2 ? h.slice(0, best).join(':') + '::' + h.slice(best + bestLen).join(':') : h.join(':');
  }
  function fmt(family, v) { return family === 4 ? fmt4(v) : fmt6(v); }
  function addr(text) {
    var a = parseIPv4(text); if (a !== null) return { family: 4, bits: 32, addr: a };
    a = parseIPv6(text); if (a !== null) return { family: 6, bits: 128, addr: a };
    return null;
  }
  function parse(text) {
    var s = String(text).trim().replace(/\s+/g, ' ');
    if (!s) throw new Error('Empty line');
    var part = s, prefix = null, two = s.split(' ');
    if (two.length === 2 && parseIPv4(two[1]) !== null) {
      var bin = parseIPv4(two[1]).toString(2).padStart(32, '0');
      if (!/^1*0*$/.test(bin)) throw new Error(two[1] + ' is not a contiguous mask');
      prefix = bin.indexOf('0') < 0 ? 32 : bin.indexOf('0'); part = two[0];
    } else if (s.indexOf('/') >= 0) {
      var i = s.indexOf('/'), p = s.slice(i + 1).trim(); part = s.slice(0, i).trim();
      if (!/^\d{1,3}$/.test(p)) throw new Error('Prefix length "' + p + '" must be a number');
      prefix = Number(p);
    }
    var a = addr(part);
    if (!a) throw new Error('"' + part + '" is not a valid IPv4 or IPv6 address');
    if (prefix === null) prefix = a.bits;
    if (prefix > a.bits) throw new Error('/' + prefix + ' is longer than the ' + a.bits + '-bit address space of IPv' + a.family);
    a.prefix = prefix;
    return a;
  }
  function block(p) {
    var all = MASK[p.family], hb = BigInt(p.bits - p.prefix), mask = p.prefix === 0 ? 0n : (all << hb) & all;
    var network = p.addr & mask, last = network | (~mask & all), size = 1n << hb, first = network, lastH = last, usable = size;
    if (p.family === 4 && p.prefix <= 30) { first = network + 1n; lastH = last - 1n; usable = size - 2n; }
    return { family: p.family, bits: p.bits, prefix: p.prefix, mask: mask, network: network, last: last, size: size, firstHost: first, lastHost: lastH, usable: usable };
  }
  function cidr(b) { return fmt(b.family, b.network) + '/' + b.prefix; }
  function mk(family, network, prefix) { return block({ family: family, bits: family === 4 ? 32 : 128, addr: network, prefix: prefix }); }

  // smallest aligned blocks covering [lo, hi]
  function cover(family, lo, hi) {
    var bits = family === 4 ? 32 : 128, out = [];
    while (lo <= hi) {
      var size = 1n, p = bits;
      while (p > 0) {
        var next = size << 1n;
        if (lo % next !== 0n || lo + next - 1n > hi) break;
        size = next; p--;
      }
      out.push(mk(family, lo, p));
      lo += size;
    }
    return out;
  }
  function rangeToCidrs(a, b) {
    if (b === undefined) { var m = /^\s*(\S+)\s*(?:-|–|to|\s)\s*(\S+)\s*$/.exec(String(a)); if (!m) throw new Error('Write the range as "first - last", for example 10.0.0.5 - 10.0.0.200'); a = m[1]; b = m[2]; }
    var x = addr(a), y = addr(b);
    if (!x) throw new Error('"' + a + '" is not an address'); if (!y) throw new Error('"' + b + '" is not an address');
    if (x.family !== y.family) throw new Error('Both ends must be the same family');
    if (x.addr > y.addr) throw new Error('The first address is after the last one');
    return cover(x.family, x.addr, y.addr).map(cidr);
  }
  function aggregate(blocks) {
    if (!blocks.length) return [];
    var fam = blocks[0].family, s = blocks.slice().sort(function (a, b) { return a.network < b.network ? -1 : a.network > b.network ? 1 : 0; }), runs = [];
    s.forEach(function (b) {
      var r = runs[runs.length - 1];
      if (r && b.network <= r[1] + 1n) { if (b.last > r[1]) r[1] = b.last; } else runs.push([b.network, b.last]);
    });
    var out = []; runs.forEach(function (r) { out = out.concat(cover(fam, r[0], r[1])); });
    return out;
  }
  function free(parent, used) {
    var inside = used.filter(function (u) { return u.family === parent.family && u.last >= parent.network && u.network <= parent.last; });
    var merged = aggregate(inside), out = [], at = parent.network;
    merged.forEach(function (u) { var lo = u.network < parent.network ? parent.network : u.network; if (lo > at) out = out.concat(cover(parent.family, at, lo - 1n)); if (u.last + 1n > at) at = u.last + 1n; });
    if (at <= parent.last) out = out.concat(cover(parent.family, at, parent.last));
    return out;
  }

  function vlsm(parentText, reqs, opts) {
    opts = opts || {};
    var parent;
    try { parent = block(parse(parentText)); } catch (e) { return { ok: false, error: 'Parent block: ' + e.message }; }
    var fam = parent.family, bits = parent.bits;
    var list = [];
    for (var i = 0; i < reqs.length; i++) {
      var r = reqs[i], n = Number(r.hosts);
      if (!(n >= 1) || Math.floor(n) !== n) return { ok: false, error: (r.name || 'Line ' + (i + 1)) + ': "' + r.hosts + '" is not a whole number of ' + (fam === 4 ? 'hosts' : '/64 subnets') };
      var prefix;
      if (fam === 4) {
        var need = n === 1 ? 1n : (n === 2 && opts.p2p31) ? 2n : BigInt(n) + 2n, size = 1n, hb = 0;
        while (size < need) { size <<= 1n; hb++; }
        prefix = 32 - hb;
        if (n === 1) prefix = 32;
      } else {
        var s6 = 1n, h6 = 0; while (s6 < BigInt(n)) { s6 <<= 1n; h6++; }
        prefix = 64 - h6;
        if (opts.nibble) prefix -= prefix % 4;
      }
      if (prefix < parent.prefix) return { ok: false, error: (r.name || 'Line ' + (i + 1)) + ' needs a /' + prefix + ', which is bigger than the parent /' + parent.prefix };
      list.push({ i: i, name: r.name || 'Subnet ' + (i + 1), hosts: n, prefix: prefix });
    }
    // largest first keeps every block aligned with no gaps; ties keep input order
    list.sort(function (a, b) { return a.prefix - b.prefix || a.i - b.i; });
    var at = parent.network, out = [];
    for (var k = 0; k < list.length; k++) {
      var it = list[k], b = mk(fam, at, it.prefix);
      if (b.network !== at || b.last > parent.last) {
        var needed = list.slice(k).reduce(function (s, x) { return s + (1n << BigInt(bits - x.prefix)); }, 0n);
        return { ok: false, error: 'Out of space at ' + it.name + ': the parent /' + parent.prefix + ' has ' + (parent.last - at + 1n).toLocaleString('en-US') + ' addresses left and the remaining subnets need ' + needed.toLocaleString('en-US') + '. Use a larger parent block or fewer hosts.' };
      }
      var cap = fam === 4 ? b.usable : (1n << BigInt(64 - Math.min(64, b.prefix)));
      out.push({ name: it.name, hosts: it.hosts, order: it.i, block: b, capacity: cap, spare: cap - BigInt(it.hosts) });
      at = b.last + 1n;
    }
    var used = out.reduce(function (s, x) { return s + x.block.size; }, 0n);
    return { ok: true, parent: parent, allocations: out, free: at <= parent.last ? cover(fam, at, parent.last) : [], used: used, total: parent.size };
  }

  function conflicts(lines) {
    var blocks = [], invalid = [], findings = [];
    lines.forEach(function (raw, idx) {
      var t = String(raw).replace(/#.*/, '').trim(); if (!t) return;
      // "name 10.0.0.0/24" or "name, 10.0.0.0/24" or a bare CIDR
      var m = /^(.*?)[\s,;]+(\S+\/\d+|\S+\s+\d+\.\d+\.\d+\.\d+)$/.exec(t), label = '', text = t;
      if (m && !addr(m[1])) { label = m[1].trim(); text = m[2]; }
      try { var b = block(parse(text)); b.label = label; b.line = idx + 1; b.text = text; blocks.push(b); }
      catch (e) { invalid.push({ line: idx + 1, text: t, error: e.message }); }
    });
    [4, 6].forEach(function (fam) {
      var s = blocks.filter(function (b) { return b.family === fam; }).sort(function (a, b) { return a.network < b.network ? -1 : a.network > b.network ? 1 : b.prefix - a.prefix; });
      var open = [];
      s.forEach(function (b) {
        open = open.filter(function (o) { return o.last >= b.network; });
        open.forEach(function (o) {
          if (findings.length >= 1000) return;
          var kind = o.network === b.network && o.last === b.last ? 'duplicate' : (o.network <= b.network && o.last >= b.last) ? 'contains' : 'overlap';
          findings.push({ a: o, b: b, kind: kind });
        });
        open.push(b);
      });
    });
    var agg = [];
    [4, 6].forEach(function (fam) { agg = agg.concat(aggregate(blocks.filter(function (b) { return b.family === fam; })).map(cidr)); });
    return { blocks: blocks, invalid: invalid, findings: findings, aggregate: agg };
  }

  return { parse: parse, block: block, fmt: fmt, cidr: cidr, addr: addr, vlsm: vlsm, rangeToCidrs: rangeToCidrs, conflicts: conflicts, aggregate: aggregate, free: free, cover: cover };
});
