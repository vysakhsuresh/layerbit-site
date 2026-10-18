/* Layerbit color engine (UMD: window.LBColor in the browser, module.exports in Node).
   Parses every CSS Color 4 syntax people paste (hex, rgb/rgba, hsl/hsla, hwb,
   lab, lch, oklab, oklch, cmyk(), named colors) and converts between them,
   with WCAG 2.x contrast, APCA lightness contrast, color-vision simulation,
   OKLCH harmonies and contrast-fixing suggestions. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBColor = factory();
})(this, function () {
  'use strict';

  var NAMED = ('aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32').split(' ');
  var NAMES = {};
  for (var ni = 0; ni < NAMED.length; ni += 2) NAMES[NAMED[ni]] = NAMED[ni + 1];

  // ----------------------------------------------------------- primitives
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function round(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
  function mul(m, v) { return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]; }
  function toLin(c) { var a = Math.abs(c); return (a <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((a + 0.055) / 1.055, 2.4)); }
  function fromLin(c) { var a = Math.abs(c); return (a <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.pow(a, 1 / 2.4) - 0.055)); }

  var M_RGB_XYZ = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
  var M_XYZ_RGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
  var M_D65_D50 = [[1.0479298208405488, 0.022946793341019088, -0.05019222954313557], [0.029627815688159344, 0.990434484573249, -0.01707382502938514], [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008]];
  var M_D50_D65 = [[0.9554734527042182, -0.023098536874261423, 0.0632593086610217], [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008], [0.012314001688319899, -0.020507696433477912, 1.3303659366080753]];
  var D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
  var LE = 216 / 24389, LK = 24389 / 27;

  // A color is {r, g, b, a} with r/g/b in 0..1 (sRGB, may be out of gamut while converting) and a in 0..1.
  function rgbToHsl(c) {
    var r = c.r, g = c.g, b = c.b, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d > 1e-9) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    var f = function (n) { var k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return { r: f(0), g: f(8), b: f(4) };
  }
  function hwbToRgb(h, w, bl) {
    w = clamp(w, 0, 100) / 100; bl = clamp(bl, 0, 100) / 100;
    if (w + bl >= 1) { var gr = w / (w + bl); return { r: gr, g: gr, b: gr }; }
    var c = hslToRgb(h, 100, 50);
    return { r: c.r * (1 - w - bl) + w, g: c.g * (1 - w - bl) + w, b: c.b * (1 - w - bl) + w };
  }
  function rgbToHwb(c) { var h = rgbToHsl(c).h; return { h: h, w: Math.min(c.r, c.g, c.b) * 100, b: (1 - Math.max(c.r, c.g, c.b)) * 100 }; }
  function rgbToXyz50(c) { return mul(M_D65_D50, mul(M_RGB_XYZ, [toLin(c.r), toLin(c.g), toLin(c.b)])); }
  function xyz50ToRgb(x) { var l = mul(M_XYZ_RGB, mul(M_D50_D65, x)); return { r: fromLin(l[0]), g: fromLin(l[1]), b: fromLin(l[2]) }; }
  function rgbToLab(c) {
    var x = rgbToXyz50(c), f = [x[0] / D50[0], x[1] / D50[1], x[2] / D50[2]].map(function (t) { return t > LE ? Math.cbrt(t) : (LK * t + 16) / 116; });
    return { l: 116 * f[1] - 16, a: 500 * (f[0] - f[1]), b: 200 * (f[1] - f[2]) };
  }
  function labToRgb(L, a, b) {
    var fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
    var x = Math.pow(fx, 3) > LE ? Math.pow(fx, 3) : (116 * fx - 16) / LK;
    var y = L > LK * LE ? Math.pow(fy, 3) : L / LK;
    var z = Math.pow(fz, 3) > LE ? Math.pow(fz, 3) : (116 * fz - 16) / LK;
    return xyz50ToRgb([x * D50[0], y * D50[1], z * D50[2]]);
  }
  function rgbToOklab(c) {
    var r = toLin(c.r), g = toLin(c.g), b = toLin(c.b);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return { l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s };
  }
  function oklabToRgb(L, a, b) {
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return { r: fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) };
  }
  function toPolar(L, a, b) { var h = Math.atan2(b, a) * 180 / Math.PI; return { l: L, c: Math.sqrt(a * a + b * b), h: (h + 360) % 360 }; }
  function fromPolar(c, h) { var r = h * Math.PI / 180; return [c * Math.cos(r), c * Math.sin(r)]; }

  function inGamut(c, eps) { eps = eps == null ? 1e-4 : eps; return c.r >= -eps && c.r <= 1 + eps && c.g >= -eps && c.g <= 1 + eps && c.b >= -eps && c.b <= 1 + eps; }
  /** CSS Color 4 gamut mapping: reduce OKLCH chroma until the color fits sRGB. */
  function fitGamut(c) {
    if (inGamut(c)) return { r: clamp(c.r, 0, 1), g: clamp(c.g, 0, 1), b: clamp(c.b, 0, 1), a: c.a };
    var o = toPolar.apply(null, (function (x) { return [x.l, x.a, x.b]; })(rgbToOklab(c)));
    if (o.l >= 1) return { r: 1, g: 1, b: 1, a: c.a };
    if (o.l <= 0) return { r: 0, g: 0, b: 0, a: c.a };
    var lo = 0, hi = o.c, best = null;
    for (var i = 0; i < 30; i++) {
      var mid = (lo + hi) / 2, ab = fromPolar(mid, o.h), t = oklabToRgb(o.l, ab[0], ab[1]);
      if (inGamut(t)) { lo = mid; best = t; } else hi = mid;
    }
    best = best || oklabToRgb(o.l, 0, 0);
    return { r: clamp(best.r, 0, 1), g: clamp(best.g, 0, 1), b: clamp(best.b, 0, 1), a: c.a };
  }

  // ---------------------------------------------------------------- parse
  function num(tok, scale) {
    // scale: value that 100% maps to; returns a plain number
    tok = String(tok).trim();
    if (tok === 'none') return 0;
    if (/%$/.test(tok)) return parseFloat(tok) / 100 * scale;
    return parseFloat(tok);
  }
  function hue(tok) {
    tok = String(tok).trim().toLowerCase();
    if (tok === 'none') return 0;
    var v = parseFloat(tok);
    if (/rad$/.test(tok)) return v * 180 / Math.PI;
    if (/grad$/.test(tok)) return v * 0.9;
    if (/turn$/.test(tok)) return v * 360;
    return v;
  }
  function alpha(tok) { if (tok == null || tok === '') return 1; return clamp(num(tok, 1), 0, 1); }
  function args(inner) {
    // accepts "a, b, c, d" and "a b c / d"
    var parts = inner.replace(/\s*\/\s*/, ' / ').split(/\s*,\s*|\s+/).filter(Boolean);
    var slash = parts.indexOf('/'), a = null;
    if (slash >= 0) { a = parts[slash + 1]; parts = parts.slice(0, slash); }
    else if (parts.length === 4) { a = parts[3]; parts = parts.slice(0, 3); }
    return { p: parts, a: a };
  }

  /** Parses a CSS color string. Returns {r,g,b,a, format} (0..1 channels) or null. */
  function parse(input) {
    if (input == null) return null;
    var s = String(input).trim().toLowerCase().replace(/;$/, '');
    if (!s) return null;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0, format: 'named' };
    if (NAMES[s]) { var hx = NAMES[s]; return { r: parseInt(hx.slice(0, 2), 16) / 255, g: parseInt(hx.slice(2, 4), 16) / 255, b: parseInt(hx.slice(4, 6), 16) / 255, a: 1, format: 'named' }; }
    var m = /^#?([0-9a-f]{3,8})$/.exec(s);
    if (m && [3, 4, 6, 8].indexOf(m[1].length) >= 0 && (s[0] === '#' || /[a-f]/.test(m[1]) || m[1].length === 6 || m[1].length === 3)) {
      var h = m[1];
      if (h.length <= 4) h = h.split('').map(function (c) { return c + c; }).join('');
      return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1, format: 'hex' };
    }
    m = /^([a-z]+)\((.*)\)$/.exec(s);
    if (!m) {
      // bare triplets people paste from design tools: "255, 128, 0" or "255 128 0"
      var bare = /^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$/.exec(s);
      if (bare) return { r: clamp(+bare[1], 0, 255) / 255, g: clamp(+bare[2], 0, 255) / 255, b: clamp(+bare[3], 0, 255) / 255, a: 1, format: 'rgb' };
      return null;
    }
    var fn = m[1], A = args(m[2]), p = A.p, out;
    if (p.length < 3 && fn !== 'cmyk') return null;
    if (p.slice(0, 3).some(function (t) { return t !== 'none' && isNaN(parseFloat(t)); })) return null;
    switch (fn) {
      case 'rgb': case 'rgba':
        out = { r: num(p[0], 255) / 255, g: num(p[1], 255) / 255, b: num(p[2], 255) / 255, format: 'rgb' }; break;
      case 'hsl': case 'hsla':
        out = hslToRgb(hue(p[0]), num(p[1], 100), num(p[2], 100)); out.format = 'hsl'; break;
      case 'hwb':
        out = hwbToRgb(hue(p[0]), num(p[1], 100), num(p[2], 100)); out.format = 'hwb'; break;
      case 'lab':
        out = labToRgb(num(p[0], 100), num(p[1], 125), num(p[2], 125)); out.format = 'lab'; break;
      case 'lch':
        var lc = fromPolar(num(p[1], 150), hue(p[2])); out = labToRgb(num(p[0], 100), lc[0], lc[1]); out.format = 'lch'; break;
      case 'oklab':
        out = oklabToRgb(num(p[0], 1), num(p[1], 0.4), num(p[2], 0.4)); out.format = 'oklab'; break;
      case 'oklch':
        var oc = fromPolar(num(p[1], 0.4), hue(p[2])); out = oklabToRgb(num(p[0], 1), oc[0], oc[1]); out.format = 'oklch'; break;
      case 'cmyk': case 'device-cmyk':
        if (p.length < 4 && !A.a) return null;
        var k4 = p.length >= 4 ? p[3] : A.a, cy = num(p[0], 1), ma = num(p[1], 1), ye = num(p[2], 1), kk = num(k4, 1);
        if ([cy, ma, ye, kk].some(function (v) { return v > 1; })) { cy /= 100; ma /= 100; ye /= 100; kk /= 100; }
        return { r: (1 - cy) * (1 - kk), g: (1 - ma) * (1 - kk), b: (1 - ye) * (1 - kk), a: 1, format: 'cmyk' };
      default: return null;
    }
    out.a = alpha(A.a);
    if ([out.r, out.g, out.b].some(isNaN)) return null;
    out.outOfGamut = !inGamut(out, 1e-3);
    var fitted = fitGamut(out); fitted.format = out.format; fitted.outOfGamut = out.outOfGamut;
    return fitted;
  }

  // --------------------------------------------------------------- format
  function hex2(v) { var h = Math.round(clamp(v, 0, 1) * 255).toString(16); return h.length < 2 ? '0' + h : h; }
  function toHex(c, withAlpha) { var s = '#' + hex2(c.r) + hex2(c.g) + hex2(c.b); if (withAlpha || (withAlpha !== false && c.a < 1)) s += hex2(c.a); return s; }
  function a_(c, sep) { return c.a < 1 ? (sep || ' / ') + round(c.a, 3) : ''; }
  function formats(c) {
    var hsl = rgbToHsl(c), hwb = rgbToHwb(c), lab = rgbToLab(c), lch = toPolar(lab.l, lab.a, lab.b), ok = rgbToOklab(c), okl = toPolar(ok.l, ok.a, ok.b);
    var R = Math.round(c.r * 255), G = Math.round(c.g * 255), B = Math.round(c.b * 255);
    var k = 1 - Math.max(c.r, c.g, c.b), cmyk = k >= 1 ? [0, 0, 0, 100] : [(1 - c.r - k) / (1 - k), (1 - c.g - k) / (1 - k), (1 - c.b - k) / (1 - k), k].map(function (v, i) { return round(v * 100, 0); });
    var achromatic = okl.c < 0.0005;
    return {
      hex: toHex(c),
      hex8: toHex(c, true),
      rgb: c.a < 1 ? 'rgb(' + R + ' ' + G + ' ' + B + a_(c) + ')' : 'rgb(' + R + ' ' + G + ' ' + B + ')',
      rgbLegacy: c.a < 1 ? 'rgba(' + R + ', ' + G + ', ' + B + ', ' + round(c.a, 3) + ')' : 'rgb(' + R + ', ' + G + ', ' + B + ')',
      hsl: 'hsl(' + round(hsl.h, 1) + ' ' + round(hsl.s, 1) + '% ' + round(hsl.l, 1) + '%' + a_(c) + ')',
      hwb: 'hwb(' + round(hwb.h, 1) + ' ' + round(hwb.w, 1) + '% ' + round(hwb.b, 1) + '%' + a_(c) + ')',
      lab: 'lab(' + round(lab.l, 2) + '% ' + round(lab.a, 2) + ' ' + round(lab.b, 2) + a_(c) + ')',
      lch: 'lch(' + round(lch.l, 2) + '% ' + round(lch.c, 2) + ' ' + (achromatic ? 'none' : round(lch.h, 2)) + a_(c) + ')',
      oklab: 'oklab(' + round(ok.l * 100, 2) + '% ' + round(ok.a, 4) + ' ' + round(ok.b, 4) + a_(c) + ')',
      oklch: 'oklch(' + round(okl.l * 100, 2) + '% ' + round(okl.c, 4) + ' ' + (achromatic ? 'none' : round(okl.h, 2)) + a_(c) + ')',
      cmyk: 'cmyk(' + cmyk.join('% ') + '%)',
      int: String((R << 16) + (G << 8) + B),
      androidArgb: '0x' + (hex2(c.a) + hex2(c.r) + hex2(c.g) + hex2(c.b)).toUpperCase(),
      swiftUI: 'Color(red: ' + round(c.r, 3) + ', green: ' + round(c.g, 3) + ', blue: ' + round(c.b, 3) + (c.a < 1 ? ', opacity: ' + round(c.a, 3) : '') + ')',
      name: nearestName(c)
    };
  }
  function nearestName(c) {
    var best = null, bestD = Infinity, o = rgbToOklab(c);
    for (var n in NAMES) {
      var h = NAMES[n], t = rgbToOklab({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 });
      var d = Math.sqrt(Math.pow(o.l - t.l, 2) + Math.pow(o.a - t.a, 2) + Math.pow(o.b - t.b, 2));
      if (d < bestD) { bestD = d; best = n; }
    }
    return { name: best, exact: bestD < 0.002, deltaE: round(bestD * 100, 2) };
  }

  // -------------------------------------------------------------- contrast
  /** WCAG 2.x relative luminance. */
  function luminance(c) { return 0.2126 * toLin(c.r) + 0.7152 * toLin(c.g) + 0.0722 * toLin(c.b); }
  /** Composites a translucent color over an opaque background. */
  function over(fg, bg) { var a = fg.a == null ? 1 : fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
  function wcag(fg, bg) {
    var f = over(fg, bg), L1 = luminance(f), L2 = luminance(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    ratio = Math.floor(ratio * 100) / 100; // WCAG: do not round up to a passing value
    return { ratio: ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, nonText: ratio >= 3 };
  }
  /** APCA-W3 0.0.98G-4g lightness contrast (Lc). Positive: dark text on light; negative: light on dark. */
  function apca(fg, bg) {
    var f = over(fg, bg);
    var Y = function (c) { var y = 0.2126729 * Math.pow(c.r, 2.4) + 0.7151522 * Math.pow(c.g, 2.4) + 0.0721750 * Math.pow(c.b, 2.4); return y < 0.022 ? y + Math.pow(0.022 - y, 1.414) : y; };
    var yt = Y(f), yb = Y(bg);
    if (Math.abs(yb - yt) < 0.0005) return 0;
    var out;
    if (yb > yt) { var sapc = (Math.pow(yb, 0.56) - Math.pow(yt, 0.57)) * 1.14; out = sapc < 0.1 ? 0 : sapc - 0.027; }
    else { var sapc2 = (Math.pow(yb, 0.65) - Math.pow(yt, 0.62)) * 1.14; out = sapc2 > -0.1 ? 0 : sapc2 + 0.027; }
    return round(out * 100, 1);
  }
  /** Rounds channels to 8-bit, so a suggested color still passes once written as hex. */
  function quant(c) { return { r: Math.round(c.r * 255) / 255, g: Math.round(c.g * 255) / 255, b: Math.round(c.b * 255) / 255, a: c.a }; }
  /** Nearest foreground (same hue and chroma in OKLCH) that reaches `target` ratio on bg. */
  function fixContrast(fg, bg, target) {
    target = target || 4.5;
    if (wcag(fg, bg).ratio >= target) return { color: fg, changed: false };
    var ok = rgbToOklab(fg), p = toPolar(ok.l, ok.a, ok.b), bgL = luminance(bg);
    var tryDir = function (dir) {
      var lo = p.l, hi = dir > 0 ? 1 : 0, found = null;
      for (var i = 0; i < 40; i++) {
        var mid = (lo + hi) / 2, ab = fromPolar(p.c, p.h), cand = quant(fitGamut(Object.assign(oklabToRgb(mid, ab[0], ab[1]), { a: 1 })));
        if (wcag(cand, bg).ratio >= target) { found = cand; hi = mid; } else lo = mid;
      }
      return found;
    };
    var first = luminance(fg) >= bgL ? 1 : -1, c = tryDir(first) || tryDir(-first);
    return c ? { color: c, changed: true } : { color: bgL > 0.18 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 1, g: 1, b: 1, a: 1 }, changed: true };
  }

  // ------------------------------------------------------------- palettes
  function fromOklch(L, C, H, a) { var ab = fromPolar(C, H); return fitGamut(Object.assign(oklabToRgb(L, ab[0], ab[1]), { a: a == null ? 1 : a })); }
  function oklch(c) { var o = rgbToOklab(c); return toPolar(o.l, o.a, o.b); }
  function harmonies(c) {
    var p = oklch(c), mk = function (dh) { return fromOklch(p.l, p.c, (p.h + dh + 360) % 360, c.a); };
    return { complementary: [c, mk(180)], analogous: [mk(-30), c, mk(30)], triadic: [c, mk(120), mk(240)], splitComplementary: [c, mk(150), mk(210)], tetradic: [c, mk(90), mk(180), mk(270)] };
  }
  /** 11-step tint/shade scale (50..950) at constant hue, Tailwind-style naming. */
  function scale(c) {
    var p = oklch(c), steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950], Ls = [0.97, 0.93, 0.87, 0.79, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22];
    return steps.map(function (s, i) { var cMax = p.c * (1 - Math.pow(Math.abs(Ls[i] - 0.62) / 0.62, 2) * 0.7); return { step: s, color: fromOklch(Ls[i], Math.max(0, cMax), p.h) }; });
  }
  function mix(a, b, t) {
    // perceptual mix in OKLab (what CSS color-mix(in oklab, ...) does)
    var A = rgbToOklab(a), B = rgbToOklab(b);
    return fitGamut(Object.assign(oklabToRgb(A.l + (B.l - A.l) * t, A.a + (B.a - A.a) * t, A.b + (B.b - A.b) * t), { a: (a.a == null ? 1 : a.a) + ((b.a == null ? 1 : b.a) - (a.a == null ? 1 : a.a)) * t }));
  }

  // -------------------------------------------------- color-vision simulation
  var CVD = {
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
  };
  function simulate(c, type) {
    var lin = [toLin(c.r), toLin(c.g), toLin(c.b)], out;
    if (type === 'achromatopsia') { var y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]; out = [y, y, y]; }
    else out = mul(CVD[type], lin);
    return { r: clamp(fromLin(out[0]), 0, 1), g: clamp(fromLin(out[1]), 0, 1), b: clamp(fromLin(out[2]), 0, 1), a: c.a };
  }

  return { parse: parse, formats: formats, toHex: toHex, luminance: luminance, wcag: wcag, apca: apca, fixContrast: fixContrast, harmonies: harmonies, scale: scale, mix: mix, simulate: simulate, oklch: oklch, fromOklch: fromOklch, nearestName: nearestName, names: NAMES, over: over };
});
