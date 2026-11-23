/* Layerbit QR and barcode drawing: styled QR shapes and vector output.
 * Pure functions, no DOM. Browser (window.LBCodes) and Node.
 *
 * matrix(qrcodeLib, text, ecl)         -> {n, dark(r, c)} from qrcode-generator (UTF-8)
 * layout(m, {dots, eyes, margin, logo, frame, measure}) -> {w, h, items}
 *   dots: square | rounded | dots; eyes: square | rounded | circle
 *   logo: fraction of the width cleared in the centre (0 = none)
 *   frame: {style: none | banner | box, text}; measure(text, size) -> width in the same units
 *   items: {t: 'rect', x, y, w, h, r, fill: 'fg' | 'bg'}, {t: 'circle', cx, cy, r, fill},
 *          {t: 'path', d: [['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y], ['Z']], fill},
 *          {t: 'text', x, y, size, text, fill, anchor: 'middle' | 'start'}, {t: 'image', x, y, w, h}
 * svg(L, {fg, bg, scale, imageHref, font}) -> SVG string
 * pdf(L, {fg, bg, scale, jpeg: {data, w, h}}) -> Uint8Array (PDF 1.4, vector)
 * eps(L, {fg, bg, scale, rgb: {w, h, hex}}) -> string (EPSF-3.0, vector)
 * parsePath(d) -> absolute commands M L C Z (handles H V S Q T and relative forms; arcs as lines)
 * vevent({title, start, end, location, description}) -> iCalendar VEVENT text
 * epc({name, iban, bic, amount, ref, text}) -> {text, errors}  (EPC069-12 v002 SEPA credit transfer)
 * ibanValid(iban) -> bool (ISO 13616 mod-97)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBCodes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var K = 0.5522847498;   // cubic Bezier circle constant

  function matrix(lib, text, ecl) {
    if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8']) lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
    var q = lib(0, ecl || 'M'); q.addData(text, 'Byte'); q.make();
    var n = q.getModuleCount();
    return { n: n, dark: function (r, c) { return q.isDark(r, c); } };
  }

  function layout(m, o) {
    o = o || {};
    var n = m.n, mg = o.margin == null ? 4 : o.margin, items = [], dots = o.dots || 'square', eyes = o.eyes || 'square';
    var size = n + 2 * mg, frame = o.frame || { style: 'none' }, text = frame.text || '';
    var measure = o.measure || function (s, sz) { return s.length * sz * 0.6; };
    var isEye = function (r, c) { return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7); };
    var cut = 0, c0 = 0, c1 = -1;
    if (o.logo > 0) { cut = Math.ceil(n * o.logo); if ((n - cut) % 2) cut++; c0 = (n - cut) / 2; c1 = c0 + cut - 1; }
    var hidden = function (r, c) { return r >= c0 - 1 && r <= c1 + 1 && c >= c0 - 1 && c <= c1 + 1 && cut > 0; };
    var dark = function (r, c) { return r >= 0 && c >= 0 && r < n && c < n && m.dark(r, c) && !hidden(r, c) && !isEye(r, c); };
    var oy = 0, ox = 0, W = size, H = size;
    if (frame.style === 'box' || frame.style === 'banner') {
      var pad = frame.style === 'box' ? 2 : 0, band = text ? Math.max(5, Math.round(size * 0.16)) : 0;
      W = size + 2 * pad; H = size + 2 * pad + band;
      ox = pad; oy = pad;
      items.push({ t: 'rect', x: 0, y: 0, w: W, h: H, r: frame.style === 'box' ? 2 : 0, fill: frame.style === 'box' ? 'fg' : 'bg' });
      if (frame.style === 'box') items.push({ t: 'rect', x: 1, y: 1, w: W - 2, h: size + 2 * pad - 2 + 1, r: 1.2, fill: 'bg' });
      if (text) {
        var ts = band * 0.55, tw = measure(text, ts);
        if (tw > W * 0.9) ts = ts * (W * 0.9) / tw;
        if (frame.style === 'banner') items.push({ t: 'rect', x: mg * 0.5, y: size, w: W - mg, h: band - 0.5, r: band * 0.25, fill: 'fg' });
        items.push({ t: 'text', x: W / 2, y: oy + size + (frame.style === 'box' ? pad - 1 : 0) + band / 2 + ts * 0.36, size: ts, text: text, fill: 'bg', anchor: 'middle' });
      }
    } else items.push({ t: 'rect', x: 0, y: 0, w: W, h: H, r: 0, fill: 'bg' });
    var X = ox + mg, Y = oy + mg;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (!dark(r, c)) continue;
      if (dots === 'dots') items.push({ t: 'circle', cx: X + c + 0.5, cy: Y + r + 0.5, r: 0.45, fill: 'fg' });
      else if (dots === 'rounded') {
        // round only the corners with no dark neighbour on either side
        var up = dark(r - 1, c), dn = dark(r + 1, c), lf = dark(r, c - 1), rt = dark(r, c + 1), rr = 0.5;
        items.push({ t: 'path', fill: 'fg', d: roundedCell(X + c, Y + r, !up && !lf ? rr : 0, !up && !rt ? rr : 0, !dn && !rt ? rr : 0, !dn && !lf ? rr : 0) });
      } else items.push({ t: 'rect', x: X + c, y: Y + r, w: 1, h: 1, r: 0, fill: 'fg' });
    }
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
      var x = X + p[1], y = Y + p[0];
      if (eyes === 'circle') {
        items.push({ t: 'circle', cx: x + 3.5, cy: y + 3.5, r: 3.5, fill: 'fg' });
        items.push({ t: 'circle', cx: x + 3.5, cy: y + 3.5, r: 2.5, fill: 'bg' });
        items.push({ t: 'circle', cx: x + 3.5, cy: y + 3.5, r: 1.5, fill: 'fg' });
      } else {
        var rad = eyes === 'rounded' ? 1 : 0;
        items.push({ t: 'rect', x: x, y: y, w: 7, h: 7, r: rad * 2, fill: 'fg' });
        items.push({ t: 'rect', x: x + 1, y: y + 1, w: 5, h: 5, r: rad * 1.4, fill: 'bg' });
        items.push({ t: 'rect', x: x + 2, y: y + 2, w: 3, h: 3, r: rad * 0.8, fill: 'fg' });
      }
    });
    if (cut > 0) items.push({ t: 'image', x: X + c0, y: Y + c0, w: cut, h: cut });
    return { w: W, h: H, items: items, n: n, margin: mg };
  }
  function roundedCell(x, y, a, b, c, d) {
    var p = [['M', x + a, y], ['L', x + 1 - b, y]];
    if (b) p.push(['C', x + 1 - b + b * K, y, x + 1, y + b - b * K, x + 1, y + b]);
    p.push(['L', x + 1, y + 1 - c]);
    if (c) p.push(['C', x + 1, y + 1 - c + c * K, x + 1 - c + c * K, y + 1, x + 1 - c, y + 1]);
    p.push(['L', x + d, y + 1]);
    if (d) p.push(['C', x + d - d * K, y + 1, x, y + 1 - d + d * K, x, y + 1 - d]);
    p.push(['L', x, y + a]);
    if (a) p.push(['C', x, y + a - a * K, x + a - a * K, y, x + a, y]);
    p.push(['Z']);
    return p;
  }
  // a rounded rectangle and a circle as path commands (PDF and EPS draw these)
  function rectPath(it) {
    var r = Math.min(it.r || 0, it.w / 2, it.h / 2);
    if (!r) return [['M', it.x, it.y], ['L', it.x + it.w, it.y], ['L', it.x + it.w, it.y + it.h], ['L', it.x, it.y + it.h], ['Z']];
    var x = it.x, y = it.y, w = it.w, h = it.h, k = r * (1 - K);
    return [['M', x + r, y], ['L', x + w - r, y], ['C', x + w - k, y, x + w, y + k, x + w, y + r], ['L', x + w, y + h - r], ['C', x + w, y + h - k, x + w - k, y + h, x + w - r, y + h],
      ['L', x + r, y + h], ['C', x + k, y + h, x, y + h - k, x, y + h - r], ['L', x, y + r], ['C', x, y + k, x + k, y, x + r, y], ['Z']];
  }
  function circlePath(it) {
    var x = it.cx, y = it.cy, r = it.r, k = r * K;
    return [['M', x + r, y], ['C', x + r, y + k, x + k, y + r, x, y + r], ['C', x - k, y + r, x - r, y + k, x - r, y], ['C', x - r, y - k, x - k, y - r, x, y - r], ['C', x + k, y - r, x + r, y - k, x + r, y], ['Z']];
  }
  var f = function (v) { return +v.toFixed(3); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function svg(L, o) {
    o = o || {};
    var s = o.scale || 10, col = function (k) { return k === 'bg' ? o.bg || '#ffffff' : o.fg || '#000000'; }, out = [];
    L.items.forEach(function (it) {
      if (it.t === 'rect') out.push('<rect x="' + f(it.x) + '" y="' + f(it.y) + '" width="' + f(it.w) + '" height="' + f(it.h) + '"' + (it.r ? ' rx="' + f(it.r) + '"' : '') + ' fill="' + col(it.fill) + '"/>');
      else if (it.t === 'circle') out.push('<circle cx="' + f(it.cx) + '" cy="' + f(it.cy) + '" r="' + f(it.r) + '" fill="' + col(it.fill) + '"/>');
      else if (it.t === 'path') out.push('<path d="' + it.d.map(function (p) { return p[0] + p.slice(1).map(f).join(' '); }).join('') + '" fill="' + col(it.fill) + '"/>');
      else if (it.t === 'text') out.push('<text x="' + f(it.x) + '" y="' + f(it.y) + '" font-size="' + f(it.size) + '" font-family="' + esc(o.font || 'Helvetica, Arial, sans-serif') + '" font-weight="700" text-anchor="' + (it.anchor || 'start') + '" fill="' + col(it.fill) + '">' + esc(it.text) + '</text>');
      else if (it.t === 'image' && o.imageHref) out.push('<image x="' + f(it.x) + '" y="' + f(it.y) + '" width="' + f(it.w) + '" height="' + f(it.h) + '" preserveAspectRatio="xMidYMid meet" href="' + esc(o.imageHref) + '"/>');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + f(L.w * s) + '" height="' + f(L.h * s) + '" viewBox="0 0 ' + f(L.w) + ' ' + f(L.h) + '" shape-rendering="' + (o.crisp === false ? 'auto' : 'geometricPrecision') + '">' + out.join('') + '</svg>';
  }

  function rgb(hex) { var h = String(hex || '#000').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map(function (i) { return (parseInt(h.substr(i, 2), 16) || 0) / 255; }); }
  // PDF/EPS text is Latin-1 in the standard Helvetica-Bold font
  function latin1(s) { return String(s).replace(/[^\x20-\x7e\xa0-\xff]/g, '?'); }
  function psString(s) { return '(' + latin1(s).replace(/[\\()]/g, '\\$&').replace(/[\xa0-\xff]/g, function (c) { return '\\' + c.charCodeAt(0).toString(8); }) + ')'; }

  function pathOps(d, X, Y, ps) {
    return d.map(function (p) {
      if (p[0] === 'Z') return ps ? 'closepath' : 'h';
      var pts = []; for (var i = 1; i < p.length; i += 2) pts.push(f(X(p[i])), f(Y(p[i + 1])));
      return pts.join(' ') + ' ' + (ps ? { M: 'moveto', L: 'lineto', C: 'curveto' }[p[0]] : { M: 'm', L: 'l', C: 'c' }[p[0]]);
    }).join('\n');
  }
  function drawOps(L, o, ps) {
    var s = o.scale || 10, H = L.h * s, X = function (v) { return v * s; }, Y = function (v) { return H - v * s; }, out = [], fg = rgb(o.fg), bg = rgb(o.bg || '#fff');
    var color = function (k) { var c = k === 'bg' ? bg : fg; return c.map(f).join(' ') + (ps ? ' setrgbcolor' : ' rg'); };
    var last = null;
    L.items.forEach(function (it) {
      if (it.t === 'image') { out.push(ps ? imagePs(it, o, X, Y, s) : imagePdf(it, o, X, Y, s)); last = null; return; }
      var c = color(it.fill); if (c !== last) { out.push(c); last = c; }
      if (it.t === 'text') { out.push(ps ? '/Helvetica-Bold findfont ' + f(it.size * s) + ' scalefont setfont\n' + psString(it.text) + ' dup stringwidth pop ' + (it.anchor === 'middle' ? '2 div neg ' + f(X(it.x)) + ' add' : 'pop ' + f(X(it.x))) + ' ' + f(Y(it.y)) + ' moveto show'
        : 'BT /F1 ' + f(it.size * s) + ' Tf ' + f(X(it.x) - (it.anchor === 'middle' ? (o.measure ? o.measure(it.text, it.size) * s : latin1(it.text).length * it.size * s * 0.6) / 2 : 0)) + ' ' + f(Y(it.y)) + ' Td ' + psString(it.text) + ' Tj ET'); return; }
      if (it.t === 'rect' && !it.r) { out.push(ps ? f(X(it.x)) + ' ' + f(Y(it.y + it.h)) + ' ' + f(it.w * s) + ' ' + f(it.h * s) + ' rectfill' : f(X(it.x)) + ' ' + f(Y(it.y + it.h)) + ' ' + f(it.w * s) + ' ' + f(it.h * s) + ' re f'); return; }
      var d = it.t === 'rect' ? rectPath(it) : it.t === 'circle' ? circlePath(it) : it.d;
      out.push((ps ? 'newpath\n' : '') + pathOps(d, X, Y, ps) + (ps ? '\nfill' : '\nf'));
    });
    return out.join('\n');
  }
  function imagePdf(it, o, X, Y, s) { return o.jpeg ? 'q ' + f(it.w * s) + ' 0 0 ' + f(it.h * s) + ' ' + f(X(it.x)) + ' ' + f(Y(it.y + it.h)) + ' cm /Im1 Do Q' : ''; }
  function imagePs(it, o, X, Y, s) {
    if (!o.rgb) return '';
    var im = o.rgb;
    return 'gsave ' + f(X(it.x)) + ' ' + f(Y(it.y + it.h)) + ' translate ' + f(it.w * s) + ' ' + f(it.h * s) + ' scale\n/picstr ' + im.w * 3 + ' string def\n' + im.w + ' ' + im.h + ' 8 [' + im.w + ' 0 0 -' + im.h + ' 0 ' + im.h + '] {currentfile picstr readhexstring pop} false 3 colorimage\n' + im.hex.replace(/(.{78})/g, '$1\n') + '\ngrestore';
  }

  function pdf(L, o) {
    o = o || {};
    var s = o.scale || 10, W = f(L.w * s), H = f(L.h * s), content = drawOps(L, o, false);
    var enc = function (str) { var u = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255; return u; };
    var objs = [], hasImg = !!(o.jpeg && L.items.some(function (i) { return i.t === 'image'; }));
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 5 0 R >>' + (hasImg ? ' /XObject << /Im1 6 0 R >>' : '') + ' >> /Contents 4 0 R >>');
    objs.push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    if (hasImg) objs.push({ head: '<< /Type /XObject /Subtype /Image /Width ' + o.jpeg.w + ' /Height ' + o.jpeg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + o.jpeg.data.length + ' >>\nstream\n', data: o.jpeg.data, tail: '\nendstream' });
    var parts = [enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')], len = parts[0].length, offs = [];
    objs.forEach(function (ob, i) {
      offs.push(len);
      var chunk = typeof ob === 'string' ? [enc((i + 1) + ' 0 obj\n' + ob + '\nendobj\n')] : [enc((i + 1) + ' 0 obj\n' + ob.head), ob.data, enc(ob.tail + '\nendobj\n')];
      chunk.forEach(function (c) { parts.push(c); len += c.length; });
    });
    var xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (x) { return ('0000000000' + x).slice(-10) + ' 00000 n \n'; }).join('') +
      'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + len + '\n%%EOF\n';
    parts.push(enc(xref));
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function eps(L, o) {
    o = o || {};
    var s = o.scale || 10, W = Math.ceil(L.w * s), H = Math.ceil(L.h * s);
    return '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ' + W + ' ' + H + '\n%%HiResBoundingBox: 0 0 ' + f(L.w * s) + ' ' + f(L.h * s) + '\n%%Creator: Layerbit QR & Barcode Generator\n%%Pages: 1\n%%EndComments\n' +
      'gsave\n' + drawOps(L, o, true) + '\ngrestore\nshowpage\n%%EOF\n';
  }

  // SVG path data to absolute M/L/C/Z (enough for barcode writers' output)
  function parsePath(d) {
    var toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [], i = 0, out = [], cmd = '', x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
    var num = function () { return parseFloat(toks[i++]); };
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      var rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), bx = rel ? x : 0, by = rel ? y : 0;
      if (C === 'Z') { out.push(['Z']); x = sx; y = sy; lc = lq = null; continue; }
      if (i >= toks.length || /[a-zA-Z]/.test(toks[i])) { i++; continue; }
      if (C === 'M') { x = bx + num(); y = by + num(); sx = x; sy = y; out.push(['M', x, y]); cmd = rel ? 'l' : 'L'; lc = lq = null; }
      else if (C === 'L') { x = bx + num(); y = by + num(); out.push(['L', x, y]); lc = lq = null; }
      else if (C === 'H') { x = bx + num(); out.push(['L', x, y]); lc = lq = null; }
      else if (C === 'V') { y = (rel ? y : 0) + num(); out.push(['L', x, y]); lc = lq = null; }
      else if (C === 'C') { var a = [bx + num(), by + num(), bx + num(), by + num(), bx + num(), by + num()]; out.push(['C'].concat(a)); lc = [a[2], a[3]]; x = a[4]; y = a[5]; lq = null; }
      else if (C === 'S') { var r1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y], b = [bx + num(), by + num(), bx + num(), by + num()]; out.push(['C', r1[0], r1[1], b[0], b[1], b[2], b[3]]); lc = [b[0], b[1]]; x = b[2]; y = b[3]; lq = null; }
      else if (C === 'Q' || C === 'T') {
        var q = C === 'Q' ? [bx + num(), by + num()] : (lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]), e = [bx + num(), by + num()];
        out.push(['C', x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), e[0] + 2 / 3 * (q[0] - e[0]), e[1] + 2 / 3 * (q[1] - e[1]), e[0], e[1]]); lq = q; x = e[0]; y = e[1]; lc = null;
      } else if (C === 'A') { num(); num(); num(); num(); num(); x = bx + num(); y = by + num(); out.push(['L', x, y]); lc = lq = null; }
      else i++;
    }
    return out;
  }

  // ---------- payloads ----------
  var icsEsc = function (v) { return String(v || '').replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n'); };
  var icsTime = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v || ''); return m ? m[1] + m[2] + m[3] + (m[4] ? 'T' + m[4] + m[5] + (m[6] || '00') : '') : ''; };
  function vevent(e) {
    var st = icsTime(e.start), en = icsTime(e.end);
    return ['BEGIN:VEVENT', 'SUMMARY:' + icsEsc(e.title), st && 'DTSTART:' + st, en && 'DTEND:' + en, e.location && 'LOCATION:' + icsEsc(e.location), e.description && 'DESCRIPTION:' + icsEsc(e.description), 'END:VEVENT'].filter(Boolean).join('\n');
  }
  function ibanValid(iban) {
    var s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    var r = s.slice(4) + s.slice(0, 4), rem = 0;
    for (var i = 0; i < r.length; i++) { var c = r.charCodeAt(i), v = c >= 65 ? String(c - 55) : r[i]; for (var j = 0; j < v.length; j++) rem = (rem * 10 + +v[j]) % 97; }
    return rem === 1;
  }
  function epc(p) {
    var errors = [], iban = String(p.iban || '').replace(/\s+/g, '').toUpperCase(), bic = String(p.bic || '').replace(/\s+/g, '').toUpperCase(), name = String(p.name || '').trim();
    var amt = String(p.amount || '').replace(/[\s,€]/g, ''), a = amt ? parseFloat(amt) : NaN;
    if (!name) errors.push('The beneficiary name is required.'); else if (name.length > 70) errors.push('The beneficiary name is longer than 70 characters.');
    if (!iban) errors.push('The IBAN is required.'); else if (!ibanValid(iban)) errors.push('The IBAN fails its check digits (ISO 13616); check for a typo.');
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) errors.push('The BIC should be 8 or 11 letters and digits.');
    if (amt && !(a >= 0.01 && a <= 999999999.99)) errors.push('The amount must be between 0.01 and 999999999.99 euro.');
    if (p.ref && p.text) errors.push('Use either a structured reference or a text, not both.');
    var lines = ['BCD', '002', '1', 'SCT', bic, name, iban, isFinite(a) && amt ? 'EUR' + a.toFixed(2) : '', '', String(p.ref || '').trim(), String(p.text || '').trim()];
    while (lines.length > 7 && lines[lines.length - 1] === '') lines.pop();
    var text = lines.join('\n');
    if (typeof TextEncoder !== 'undefined' && new TextEncoder().encode(text).length > 331) errors.push('The payment data is longer than the 331 bytes the EPC standard allows.');
    return { text: text, errors: errors };
  }

  return { matrix: matrix, layout: layout, svg: svg, pdf: pdf, eps: eps, parsePath: parsePath, rectPath: rectPath, circlePath: circlePath, vevent: vevent, epc: epc, ibanValid: ibanValid, latin1: latin1 };
});
