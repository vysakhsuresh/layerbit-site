// Unit tests for js/engines/palette.js. Run: node scripts/unit/palette.test.js
const C = require('../../js/engines/color.js');
const P = require('../../js/engines/palette.js');
const Z = require('../../js/engines/zip.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const hex = c => C.toHex(c, false);

t('generate: locked colours stay put, the rest are new and repeatable with a seed', () => {
  const lock = C.parse('#e11d48');
  const a = P.generate([null, lock, null, null, null], { rng: P.rng(7) });
  assert.strictEqual(a.length, 5);
  assert.strictEqual(hex(a[1]), '#e11d48');
  assert.ok(a.every(Boolean));
  const b = P.generate([null, lock, null, null, null], { rng: P.rng(7) });
  assert.deepStrictEqual(a.map(hex), b.map(hex));
  const c = P.generate([null, lock, null, null, null], { rng: P.rng(8) });
  assert.notDeepStrictEqual(a.map(hex), c.map(hex));
  assert.strictEqual(new Set(a.map(hex)).size, 5, 'five distinct colours');
});
t('generate: every mode yields in-gamut colours; count grows and shrinks', () => {
  P.MODES.forEach(m => {
    const p = P.generate([], { count: 7, mode: m, rng: P.rng(3) });
    assert.strictEqual(p.length, 7, m);
    p.forEach(c => ['r', 'g', 'b'].forEach(k => assert.ok(c[k] >= -1e-6 && c[k] <= 1 + 1e-6, m + ' ' + k + '=' + c[k])));
  });
  assert.strictEqual(P.generate([C.parse('red')], { count: 3, rng: P.rng(1) }).length, 3);
  const mono = P.generate([C.parse('#2563eb'), null, null, null], { mode: 'monochrome', rng: P.rng(2) });
  const hues = mono.map(c => C.oklch(c).h);
  hues.forEach(h => assert.ok(Math.abs(((h - hues[0] + 540) % 360) - 180) < 12, 'monochrome hue drift ' + hues));
});
t('extract: finds the dominant colours of an image with their shares', () => {
  // 60% red, 30% blue, 10% white, plus transparent pixels that must be ignored
  const px = [];
  const put = (r, g, b, a, n) => { for (let i = 0; i < n; i++) px.push(r, g, b, a); };
  put(220, 30, 40, 255, 600); put(30, 60, 200, 255, 300); put(250, 250, 250, 255, 100); put(0, 255, 0, 0, 500);
  const out = P.extract(new Uint8ClampedArray(px), { count: 3, rng: P.rng(5) });
  assert.strictEqual(out.length, 3);
  assert.strictEqual(hex(out[0].color), '#dc1e28');
  assert.strictEqual(hex(out[1].color), '#1e3cc8');
  assert.strictEqual(hex(out[2].color), '#fafafa');
  assert.ok(Math.abs(out[0].share - 0.6) < 0.01 && Math.abs(out[2].share - 0.1) < 0.01);
  assert.deepStrictEqual(P.extract(new Uint8ClampedArray([0, 0, 0, 0]), { count: 3 }), []);
});
t('gradient: OKLCH, OKLab and sRGB interpolation and CSS', () => {
  const stops = [{ color: C.parse('#ff0000'), pos: 0 }, { color: C.parse('#0000ff'), pos: 100 }];
  assert.strictEqual(hex(P.sample(stops, 0.5, 'srgb')), '#800080');
  assert.strictEqual(hex(P.sample(stops, 0, 'oklch')), '#ff0000');
  assert.strictEqual(hex(P.sample(stops, 1, 'oklch')), '#0000ff');
  const mid = C.oklch(P.sample(stops, 0.5, 'oklch'));
  assert.ok(mid.c > 0.2, 'OKLCH keeps chroma through the middle: ' + mid.c);
  assert.ok(C.oklch(P.sample(stops, 0.5, 'srgb')).c < mid.c, 'sRGB midpoint is duller');
  const g = P.gradientCss(stops, { type: 'linear', angle: 45, space: 'oklch' });
  assert.strictEqual(g.modern, 'linear-gradient(in oklch shorter hue 45deg, #ff0000 0%, #0000ff 100%)');
  assert.ok(g.fallback.startsWith('linear-gradient(45deg, #ff0000 0%,') && g.fallback.endsWith('#0000ff 100%)'));
  assert.strictEqual((g.fallback.match(/#/g) || []).length, 13);
  assert.strictEqual(P.gradientCss(stops, { type: 'radial', space: 'srgb' }).modern, 'radial-gradient(circle, #ff0000 0%, #0000ff 100%)');
  assert.ok(P.gradientCss(stops, { type: 'conic', angle: 30, space: 'oklab' }).modern.startsWith('conic-gradient(in oklab from 30deg,'));
  // unsorted stops and a white end (no hue) still work
  const s2 = [{ color: C.parse('white'), pos: 100 }, { color: C.parse('#2563eb'), pos: 0 }];
  assert.strictEqual(hex(P.sample(s2, 0, 'oklch')), '#2563eb');
  assert.ok(C.oklch(P.sample(s2, 0.5, 'oklch')).h > 240 && C.oklch(P.sample(s2, 0.5, 'oklch')).h < 280);
});
t('ase: Adobe Swatch Exchange layout', () => {
  const b = P.ase([{ name: 'Red', color: C.parse('#ff0000') }, { name: 'Blue', color: C.parse('#0000ff') }], 'Test');
  const dv = new DataView(b.buffer);
  assert.strictEqual(String.fromCharCode(...b.slice(0, 4)), 'ASEF');
  assert.strictEqual(dv.getUint16(4), 1); assert.strictEqual(dv.getUint16(6), 0);
  assert.strictEqual(dv.getUint32(8), 4, 'group start, two colours, group end');
  let o = 12;
  assert.strictEqual(dv.getUint16(o), 0xC001); o += 6 + dv.getUint32(o + 2);
  assert.strictEqual(dv.getUint16(o), 0x0001);
  const len = dv.getUint32(o + 2), nl = dv.getUint16(o + 6);
  assert.strictEqual(nl, 4, '"Red" plus a null terminator');
  let name = ''; for (let i = 0; i < nl - 1; i++) name += String.fromCharCode(dv.getUint16(o + 8 + i * 2));
  assert.strictEqual(name, 'Red');
  const m = o + 8 + nl * 2;
  assert.strictEqual(String.fromCharCode(...b.slice(m, m + 4)), 'RGB ');
  assert.deepStrictEqual([dv.getFloat32(m + 4), dv.getFloat32(m + 8), dv.getFloat32(m + 12)], [1, 0, 0]);
  assert.strictEqual(dv.getUint16(m + 16), 2);
  assert.strictEqual(len, 2 + nl * 2 + 4 + 12 + 2);
  o += 6 + len; o += 6 + dv.getUint32(o + 2);
  assert.strictEqual(dv.getUint16(o), 0xC002); assert.strictEqual(o + 6, b.length);
});
t('procreate: zip with Swatches.json in HSB, at most 30', () => {
  const entries = Array.from({ length: 33 }, (_, i) => ({ color: C.fromOklch(0.6, 0.1, i * 10) }));
  entries[0] = { color: C.parse('#ff0000') };
  const z = Z.unzipStored(P.procreate(entries, 'Mine'));
  const j = JSON.parse(Buffer.from(z['Swatches.json'].data).toString());
  assert.strictEqual(j.name, 'Mine'); assert.strictEqual(j.swatches.length, 30);
  assert.deepStrictEqual(j.swatches[0], { hue: 0, saturation: 1, brightness: 1, alpha: 1, colorSpace: 0 });
});
t('pdf: a valid swatch sheet with a correct xref', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ name: 'C' + i, color: C.fromOklch(0.5, 0.1, i * 18) }));
  const s = P.pdf(entries, 'Brand (v2)');
  assert.ok(s.startsWith('%PDF-1.4') && s.endsWith('%%EOF\n'));
  assert.ok(s.includes('(Brand \\(v2\\)) Tj'));
  const pages = +/\/Count (\d+)/.exec(s)[1];
  assert.strictEqual(pages, 2);
  assert.strictEqual((s.match(/ re f/g) || []).length, 20);
  const xref = +/startxref\n(\d+)/.exec(s)[1];
  assert.strictEqual(s.slice(xref, xref + 4), 'xref');
  const offs = s.slice(xref).split('\n').slice(3).filter(l => / n $/.test(l)).map(l => +l.slice(0, 10));
  offs.forEach((o, i) => assert.ok(s.slice(o).startsWith((i + 1) + ' 0 obj'), 'object ' + (i + 1)));
  const lens = [...s.matchAll(/\/Length (\d+) >>\nstream\n/g)];
  lens.forEach(m => { const start = m.index + m[0].length; assert.strictEqual(s.slice(start + +m[1], start + +m[1] + 10), '\nendstream'); });
});
t('gpl: GIMP palette', () => {
  const s = P.gpl([{ name: 'Sky', color: C.parse('#38bdf8') }], 'P');
  assert.strictEqual(s, 'GIMP Palette\nName: P\nColumns: 1\n#\n 56 189 248\tSky\n');
});

console.log(`palette: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
