/* Layerbit palette engine: palette generation with locks, colour extraction
 * from image pixels, CSS gradients interpolated in OKLCH / OKLab / sRGB, and
 * swatch files (.ase, Procreate .swatches, a PDF swatch sheet, GIMP .gpl).
 * Pure functions on top of LBColor; browser (window.LBPalette) and Node.
 *
 * rng(seed) -> () => [0, 1)
 * generate(slots, {count, mode, rng}) -> [color]   slots: [color | null], a color is kept (locked)
 * extract(rgba, {count, rng, maxSamples}) -> [{color, share}]   rgba: Uint8(Clamped)Array
 * sample(stops, t, space) -> color          stops: [{color, pos 0-100}]
 * gradientCss(stops, {type, angle, space, shape}) -> {modern, fallback}
 * ase(entries, name) -> Uint8Array          entries: [{name, color}]
 * procreate(entries, name) -> Uint8Array    (zip holding Swatches.json)
 * pdf(entries, title) -> string              (a PDF 1.4 document, Latin-1)
 * gpl(entries, name) -> string
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color.js'), require('./zip.js'));
  else root.LBPalette = factory(root.LBColor, root.LBZip);
})(typeof self !== 'undefined' ? self : this, function (C, Z) {
  'use strict';
  function rng(seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  var clamp = function (x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; };
  var hex = function (c) { return C.toHex(c, false); };

  // ------------------------------------------------------------- generate
  var MODES = ['auto', 'analogous', 'monochrome', 'complementary', 'triadic', 'split', 'pastel', 'vivid', 'earth'];
  function generate(slots, opts) {
    opts = opts || {};
    var R = opts.rng || Math.random, n = opts.count || slots.length || 5;
    slots = slots.slice(0, n); while (slots.length < n) slots.push(null);
    var mode = opts.mode || 'auto';
    if (mode === 'auto') mode = ['analogous', 'monochrome', 'complementary', 'triadic', 'split'][Math.floor(R() * 5)];
    var locked = slots.filter(Boolean), base = locked.length ? C.oklch(locked[0]) : { l: 0.6, c: 0.05 + R() * 0.12, h: R() * 360 };
    var h0 = isNaN(base.h) || base.c < 0.02 ? R() * 360 : base.h;
    var hueSet = { analogous: [-40, -20, 0, 20, 40], monochrome: [0], complementary: [0, 180], triadic: [0, 120, 240], split: [0, 150, 210], pastel: [0, 72, 144, 216, 288], vivid: [0, 60, 150, 210, 300], earth: [-25, 0, 20, 40] }[mode] || [0];
    var cRange = { pastel: [0.04, 0.09], vivid: [0.15, 0.26], earth: [0.03, 0.1], monochrome: [0.03, Math.max(0.06, (base.c || 0.1) * 1.2)] }[mode] || [0.05, 0.2];
    var lRange = mode === 'pastel' ? [0.82, 0.95] : mode === 'earth' ? [0.3, 0.8] : [0.25, 0.95];
    var free = slots.filter(function (s) { return !s; }).length, made = [];
    for (var i = 0; i < free; i++) {
      var t = free === 1 ? R() : i / (free - 1);
      var L = lRange[0] + (lRange[1] - lRange[0]) * clamp(t + (R() - 0.5) * 0.18, 0, 1);
      var ch = cRange[0] + (cRange[1] - cRange[0]) * R();
      var dh = hueSet[Math.floor(R() * hueSet.length)] + (R() - 0.5) * 16;
      made.push(C.fromOklch(L, ch * (1 - Math.pow(Math.abs(L - 0.62) / 0.62, 2) * 0.6), (h0 + dh + 360) % 360));
    }
    // dark to light reads as a palette; locked colours stay where they are
    made.sort(function (a, b) { return C.oklch(a).l - C.oklch(b).l; });
    var k = 0;
    return slots.map(function (s) { return s ? s : made[k++]; });
  }

  // -------------------------------------------------------------- extract
  function lab(c) { var p = C.oklch(c), r = (p.h || 0) * Math.PI / 180; return [p.l, p.c * Math.cos(r), p.c * Math.sin(r)]; }
  function extract(rgba, opts) {
    opts = opts || {};
    var R = opts.rng || rng(1), k = opts.count || 6, max = opts.maxSamples || 12000, px = rgba.length / 4;
    var step = Math.max(1, Math.floor(px / max)), pts = [];
    for (var i = 0; i < px; i += step) {
      var o = i * 4; if (rgba[o + 3] < 128) continue;
      pts.push(lab({ r: rgba[o] / 255, g: rgba[o + 1] / 255, b: rgba[o + 2] / 255, a: 1 }));
    }
    if (!pts.length) return [];
    var d2 = function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
    // k-means++ seeding, deterministic for a given rng
    var cents = [pts[Math.floor(R() * pts.length)].slice()], dist = pts.map(function (p) { return d2(p, cents[0]); });
    while (cents.length < k) {
      var sum = dist.reduce(function (a, b) { return a + b; }, 0); if (sum <= 1e-12) break;
      var r = R() * sum, j = 0; while (j < pts.length - 1 && (r -= dist[j]) > 0) j++;
      cents.push(pts[j].slice());
      for (var q = 0; q < pts.length; q++) dist[q] = Math.min(dist[q], d2(pts[q], cents[cents.length - 1]));
    }
    var assign = new Int32Array(pts.length);
    for (var it = 0; it < 16; it++) {
      var moved = 0, acc = cents.map(function () { return [0, 0, 0, 0]; });
      for (var p = 0; p < pts.length; p++) {
        var best = 0, bd = Infinity;
        for (var c = 0; c < cents.length; c++) { var dd = d2(pts[p], cents[c]); if (dd < bd) { bd = dd; best = c; } }
        if (assign[p] !== best) { assign[p] = best; moved++; }
        var A = acc[best]; A[0] += pts[p][0]; A[1] += pts[p][1]; A[2] += pts[p][2]; A[3]++;
      }
      cents = cents.map(function (ct, ci) { var A = acc[ci]; return A[3] ? [A[0] / A[3], A[1] / A[3], A[2] / A[3], A[3]] : ct; });
      if (!moved && it) break;
    }
    var total = pts.length;
    return cents.filter(function (ct) { return ct[3]; }).map(function (ct) {
      var ch = Math.sqrt(ct[1] * ct[1] + ct[2] * ct[2]), h = (Math.atan2(ct[2], ct[1]) * 180 / Math.PI + 360) % 360;
      return { color: C.fromOklch(ct[0], ch, h), share: ct[3] / total };
    }).sort(function (a, b) { return b.share - a.share; });
  }

  // ------------------------------------------------------------- gradient
  function interp(a, b, t, space) {
    if (space === 'srgb') return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
    if (space === 'oklab') return C.mix(a, b, t);
    var A = C.oklch(a), B = C.oklch(b);
    // an achromatic end takes the other end's hue, as CSS does with "none"
    if (A.c < 0.002) A.h = B.h; if (B.c < 0.002) B.h = A.h;
    var dh = ((B.h - A.h + 540) % 360) - 180;
    return C.fromOklch(A.l + (B.l - A.l) * t, A.c + (B.c - A.c) * t, (A.h + dh * t + 360) % 360);
  }
  function sorted(stops) { return stops.slice().sort(function (a, b) { return a.pos - b.pos; }); }
  function sample(stops, t, space) {
    var s = sorted(stops), x = t * 100;
    if (x <= s[0].pos) return s[0].color;
    for (var i = 1; i < s.length; i++) if (x <= s[i].pos) { var span = s[i].pos - s[i - 1].pos; return interp(s[i - 1].color, s[i].color, span ? (x - s[i - 1].pos) / span : 1, space); }
    return s[s.length - 1].color;
  }
  function gradientCss(stops, o) {
    o = o || {};
    var type = o.type || 'linear', space = o.space || 'oklch', s = sorted(stops);
    var head = type === 'linear' ? (o.angle == null ? 90 : o.angle) + 'deg' : type === 'radial' ? (o.shape || 'circle') : 'from ' + (o.angle || 0) + 'deg';
    var fn = type + '-gradient';
    var list = s.map(function (x) { return hex(x.color) + ' ' + round(x.pos) + '%'; }).join(', ');
    var modern = fn + '(' + (space === 'srgb' ? '' : 'in ' + space + (space === 'oklch' ? ' shorter hue' : '') + ' ') + head + ', ' + list + ')';
    if (space === 'srgb') modern = fn + '(' + head + ', ' + list + ')';
    // sRGB fallback: sample the perceptual gradient so older browsers see the same colours
    var pts = [], N = 12;
    for (var i = 0; i <= N; i++) { var p = s[0].pos + (s[s.length - 1].pos - s[0].pos) * i / N; pts.push(hex(sample(s, p / 100, space)) + ' ' + round(p) + '%'); }
    return { modern: modern, fallback: fn + '(' + head + ', ' + pts.join(', ') + ')' };
  }
  function round(x) { return Math.round(x * 10) / 10; }

  // --------------------------------------------------------------- files
  function u16(n) { return [(n >> 8) & 255, n & 255]; }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function f32(x) { var b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x, false); return [b.getUint8(0), b.getUint8(1), b.getUint8(2), b.getUint8(3)]; }
  function utf16(s) { var out = []; for (var i = 0; i < s.length; i++) out.push.apply(out, u16(s.charCodeAt(i))); return out.concat([0, 0]); }
  function nameField(s) { return u16(s.length + 1).concat(utf16(s)); }
  // Adobe Swatch Exchange 1.0: a group holding one RGB "normal" (global) swatch per colour
  function ase(entries, name) {
    var blocks = [];
    var g = nameField(name || 'Layerbit palette');
    blocks.push(u16(0xC001).concat(u32(g.length), g));
    entries.forEach(function (e) {
      var body = nameField(e.name || hex(e.color)).concat([0x52, 0x47, 0x42, 0x20], f32(clamp(e.color.r, 0, 1)), f32(clamp(e.color.g, 0, 1)), f32(clamp(e.color.b, 0, 1)), u16(2));
      blocks.push(u16(0x0001).concat(u32(body.length), body));
    });
    blocks.push(u16(0xC002).concat(u32(0)));
    var bytes = [0x41, 0x53, 0x45, 0x46].concat(u16(1), u16(0), u32(blocks.length));
    blocks.forEach(function (b) { bytes = bytes.concat(b); });
    return new Uint8Array(bytes);
  }
  function hsv(c) {
    var r = clamp(c.r, 0, 1), g = clamp(c.g, 0, 1), b = clamp(c.b, 0, 1), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h / 6, s: mx ? d / mx : 0, v: mx };
  }
  // Procreate .swatches: a zip holding Swatches.json; Procreate shows at most 30
  function procreate(entries, name) {
    var data = { name: name || 'Layerbit palette', swatches: entries.slice(0, 30).map(function (e) { var x = hsv(e.color); return { hue: x.h, saturation: x.s, brightness: x.v, alpha: 1, colorSpace: 0 }; }) };
    return Z.zipStore([{ name: 'Swatches.json', data: JSON.stringify(data) }]);
  }
  function gpl(entries, name) {
    return 'GIMP Palette\nName: ' + (name || 'Layerbit palette') + '\nColumns: ' + Math.min(entries.length, 8) + '\n#\n' + entries.map(function (e) {
      var to = function (v) { var s = String(Math.round(clamp(v, 0, 1) * 255)); return '   '.slice(s.length) + s; };
      return to(e.color.r) + ' ' + to(e.color.g) + ' ' + to(e.color.b) + '\t' + (e.name || hex(e.color));
    }).join('\n') + '\n';
  }
  // A4 swatch sheet: three columns of swatches with HEX, RGB, CMYK and OKLCH
  function pdfText(s) { return '(' + String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1') + ')'; }
  function pdf(entries, title) {
    var W = 595, H = 842, M = 40, cols = 3, cw = (W - 2 * M - 20 * (cols - 1)) / cols, sh = 90, rowH = sh + 62, perPage = cols * Math.floor((H - 2 * M - 40) / rowH);
    var pages = [], n3 = function (v) { return (Math.round(clamp(v, 0, 1) * 1000) / 1000).toFixed(3); };
    for (var p0 = 0; p0 < Math.max(1, entries.length); p0 += perPage) {
      var ops = ['BT /F2 16 Tf ' + M + ' ' + (H - M - 12) + ' Td ' + pdfText(title || 'Palette') + ' Tj ET'];
      entries.slice(p0, p0 + perPage).forEach(function (e, i) {
        var col = i % cols, row = Math.floor(i / cols), x = M + col * (cw + 20), y = H - M - 40 - row * rowH - sh, f = C.formats(e.color);
        ops.push(n3(e.color.r) + ' ' + n3(e.color.g) + ' ' + n3(e.color.b) + ' rg ' + x.toFixed(1) + ' ' + y + ' ' + cw.toFixed(1) + ' ' + sh + ' re f');
        ops.push('0.8 0.8 0.8 RG 0.5 w ' + x.toFixed(1) + ' ' + y + ' ' + cw.toFixed(1) + ' ' + sh + ' re S');
        var lines = [[e.name || f.hex, 'F2', 10], [f.hex.toUpperCase(), 'F1', 9], [f.rgb, 'F1', 8], [f.cmyk, 'F1', 8], [f.oklch, 'F1', 8]];
        lines.forEach(function (ln, k) { ops.push('0 0 0 rg BT /' + ln[1] + ' ' + ln[2] + ' Tf ' + x.toFixed(1) + ' ' + (y - 13 - k * 11) + ' Td ' + pdfText(ln[0]) + ' Tj ET'); });
      });
      pages.push(ops.join('\n'));
    }
    var objs = [], np = pages.length;
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    var kids = []; for (var i = 0; i < np; i++) kids.push((5 + i * 2) + ' 0 R');
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + np + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach(function (content, i) {
      objs[5 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>';
      objs[6 + i * 2] = '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
    });
    var out = '%PDF-1.4\n', offs = [];
    for (var o = 1; o < objs.length; o++) { offs[o] = out.length; out += o + ' 0 obj\n' + objs[o] + '\nendobj\n'; }
    var xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (o = 1; o < objs.length; o++) out += ('000000000' + offs[o]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return out;
  }

  return { rng: rng, MODES: MODES, generate: generate, extract: extract, sample: sample, gradientCss: gradientCss, ase: ase, procreate: procreate, pdf: pdf, gpl: gpl, hsv: hsv };
});
