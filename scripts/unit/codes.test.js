// Node unit tests for js/engines/codes.js: styled QR layout that still decodes,
// PDF and EPS structure, SVG paths, EPC and iCalendar payloads.
// Run: node scripts/unit/codes.test.js
const assert = require('assert');
let C, qr, jsQR;
let n = 0, failed = 0;
function t(name, fn) { try { if (!C) { C = require('../../js/engines/codes.js'); qr = require('../../js/vendor/qrcode-generator.min.js'); jsQR = require('../../js/vendor/jsQR.min.js'); jsQR = jsQR.default || jsQR; } fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
// rasterise a layout: rects, circles and paths by point-in-shape sampling
function raster(L, s, logo) {
  const W = Math.ceil(L.w * s), H = Math.ceil(L.h * s), px = new Uint8ClampedArray(W * H * 4).fill(255);
  const inPath = (d, x, y) => { // even-odd on the polygon made of the path's points
    const pts = []; d.forEach(p => { for (let i = 1; i < p.length; i += 2) pts.push([p[i], p[i + 1]]); });
    let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside;
  };
  for (let py = 0; py < H; py++) for (let qx = 0; qx < W; qx++) {
    const x = (qx + 0.5) / s, y = (py + 0.5) / s; let v = 255;
    for (const it of L.items) {
      let hit = false;
      if (it.t === 'rect') hit = x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h;
      else if (it.t === 'circle') hit = (x - it.cx) ** 2 + (y - it.cy) ** 2 <= it.r ** 2;
      else if (it.t === 'path') hit = inPath(it.d, x, y);
      else if (it.t === 'image' && logo) hit = x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h;
      if (hit) v = it.t === 'image' ? 120 : it.fill === 'fg' ? 0 : 255;
    }
    const i = (py * W + qx) * 4; px[i] = px[i + 1] = px[i + 2] = v;
  }
  return { px, W, H };
}
const URL = 'https://layerbit.co.in/tools/qr-barcode.html?x=1';

t('layout: every dot and eye style, with a centre logo at level H, still decodes', () => {
  for (const dots of ['square', 'rounded', 'dots']) for (const eyes of ['square', 'rounded', 'circle']) {
    const L = C.layout(C.matrix(qr, URL, 'H'), { dots, eyes, logo: 0.22 });
    const r = raster(L, 6, true), got = jsQR(r.px, r.W, r.H);
    assert.ok(got && got.data === URL, `${dots}/${eyes} did not decode`);
  }
});
t('layout: the logo clears whole modules around the centre; frames add a text band', () => {
  const m = C.matrix(qr, URL, 'H'), plain = C.layout(m, {}), withLogo = C.layout(m, { logo: 0.2 });
  assert.ok(withLogo.items.length < plain.items.length && withLogo.items.some(i => i.t === 'image'));
  const f = C.layout(m, { frame: { style: 'banner', text: 'SCAN ME' } });
  assert.ok(f.h > f.w && f.items.some(i => i.t === 'text' && i.text === 'SCAN ME'));
  const b = C.layout(m, { frame: { style: 'box', text: '' } });
  assert.ok(b.w === b.h && b.w > plain.w);
});
t('matrix: UTF-8 text survives the round trip', () => {
  const L = C.layout(C.matrix(qr, 'Café ₹100 ✓', 'M'), {}), r = raster(L, 4), got = jsQR(r.px, r.W, r.H);
  assert.strictEqual(got && got.data, 'Café ₹100 ✓');
});
t('pdf: header, objects, xref offsets that point at each object, trailer', () => {
  const L = C.layout(C.matrix(qr, 'hi', 'M'), { dots: 'dots', frame: { style: 'banner', text: 'Café' } });
  const u = C.pdf(L, { fg: '#102030', bg: '#ffffff', scale: 4, jpeg: { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 1, h: 1 } });
  const s = Buffer.from(u).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const start = +/startxref\n(\d+)/.exec(s)[1]; assert.strictEqual(s.slice(start, start + 4), 'xref');
  const offs = [...s.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  offs.forEach((o, i) => assert.strictEqual(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, 'object ' + (i + 1)));
  const len = +/\/Length (\d+) >>\nstream\n/.exec(s)[1], body = s.slice(s.indexOf('stream\n') + 7); assert.strictEqual(body.slice(len, len + 10), '\nendstream');
  assert.ok(s.includes('0.063 0.125 0.188 rg') && / c\n/.test(s) && s.includes('(Caf\\351) Tj'), 'colour, curves, Latin-1 text');
});
t('eps: bounding box, rectfill, curves and centred text', () => {
  const e = C.eps(C.layout(C.matrix(qr, 'hi', 'M'), { eyes: 'circle', frame: { style: 'box', text: 'Go (now)' } }), { scale: 3 });
  assert.ok(e.startsWith('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 '));
  assert.ok(e.includes('rectfill') && e.includes('curveto') && e.includes('(Go \\(now\\)) dup stringwidth pop 2 div neg'));
});
t('parsePath: relative, H/V, S and Q become absolute M/L/C', () => {
  assert.deepStrictEqual(C.parsePath('M1 1h2v3H0zm5 5l1-1'), [['M', 1, 1], ['L', 3, 1], ['L', 3, 4], ['L', 0, 4], ['Z'], ['M', 6, 6], ['L', 7, 5]]);
  const q = C.parsePath('M0 0Q3 3 6 0');
  assert.deepStrictEqual(q[1].map(v => typeof v === 'number' ? +v.toFixed(3) : v), ['C', 2, 2, 4, 2, 6, 0]);
  assert.strictEqual(C.parsePath('M0 0C1 1 2 1 3 0S5-1 6 0')[2][1], 4);
});
t('epc and ibanValid: SEPA credit transfer text, checks', () => {
  assert.ok(C.ibanValid('BE72 0000 0000 1616') && C.ibanValid('de89370400440532013000') && !C.ibanValid('BE72000000001617'));
  const ok = C.epc({ name: 'Red Cross Belgium', iban: 'BE72 0000 0000 1616', bic: 'bpotbeb1', amount: '10.5', text: 'Donation' });
  assert.deepStrictEqual(ok, { text: 'BCD\n002\n1\nSCT\nBPOTBEB1\nRed Cross Belgium\nBE72000000001616\nEUR10.50\n\n\nDonation', errors: [] });
  assert.strictEqual(C.epc({ name: 'A', iban: 'BE72000000001616' }).text, 'BCD\n002\n1\nSCT\n\nA\nBE72000000001616');
  const bad = C.epc({ name: '', iban: 'BE72000000001617', amount: '0', ref: 'RF18', text: 'x' }).errors.join(' ');
  assert.ok(/name/.test(bad) && /check digits/.test(bad) && /amount/.test(bad) && /either/.test(bad));
});
t('vevent: escaped text, floating local times', () => {
  assert.strictEqual(C.vevent({ title: 'A; B, C', start: '2026-12-01T18:30', end: '2026-12-02', location: '' }), 'BEGIN:VEVENT\nSUMMARY:A\\; B\\, C\nDTSTART:20261201T183000\nDTEND:20261202\nEND:VEVENT');
});

console.log(`${n} passed, ${failed} failed`);
