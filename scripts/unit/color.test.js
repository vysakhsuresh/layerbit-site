// Unit tests for js/engines/color.js. Run: node scripts/unit/color.test.js
const C = require('../../js/engines/color.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const hex = s => C.formats(C.parse(s)).hex;

t('hex short, long, alpha', () => { assert.strictEqual(hex('#0af'), '#00aaff'); assert.strictEqual(hex('#38BDF8'), '#38bdf8'); assert.strictEqual(C.formats(C.parse('#38bdf880')).hex, '#38bdf880'); assert.strictEqual(hex('38bdf8'), '#38bdf8'); });
t('rgb legacy and modern syntax', () => { assert.strictEqual(hex('rgb(56, 189, 248)'), '#38bdf8'); assert.strictEqual(hex('rgb(56 189 248 / 50%)'), '#38bdf880'); assert.strictEqual(hex('rgba(100%,0%,0%,1)'), '#ff0000'); assert.strictEqual(hex('56, 189, 248'), '#38bdf8'); });
t('hsl, hwb and hue units', () => { assert.strictEqual(hex('hsl(120 100% 25%)'), '#008000'); assert.strictEqual(hex('hsl(0.5turn 100% 50%)'), '#00ffff'); assert.strictEqual(hex('hwb(0 0% 0%)'), '#ff0000'); assert.strictEqual(hex('hwb(0 60% 60%)'), '#808080'); });
t('named colors and transparent', () => { assert.strictEqual(hex('RebeccaPurple'), '#663399'); assert.strictEqual(C.parse('transparent').a, 0); assert.strictEqual(Object.keys(C.names).length, 148); });
t('lab / lch / oklab / oklch round-trip within 1/255', () => {
  ['#38bdf8', '#ff6347', '#663399', '#0a0c10', '#ffffff', '#808080'].forEach(h => {
    const f = C.formats(C.parse(h));
    ['lab', 'lch', 'oklab', 'oklch', 'hsl', 'hwb', 'rgb'].forEach(k => assert.strictEqual(hex(f[k]), h, k + ' ' + f[k]));
  });
});
t('known reference values', () => {
  // CSS Color 4 spec examples
  assert.strictEqual(hex('lab(29.2345% 39.3825 20.0664)'), '#7d2329');
  assert.strictEqual(C.formats(C.parse('white')).oklch, 'oklch(100% 0 none)');
  assert.ok(/^oklch\(62\.8% 0\.257\d 29\.2/.test(C.formats(C.parse('red')).oklch), C.formats(C.parse('red')).oklch);
});
t('out-of-gamut oklch is gamut-mapped, not clipped wildly', () => { const c = C.parse('oklch(70% 0.4 150)'); assert.ok(c.outOfGamut); assert.ok(c.g > 0.5 && c.r < 0.5); });
t('cmyk in and out', () => { assert.strictEqual(hex('cmyk(0%, 100%, 100%, 0%)'), '#ff0000'); assert.strictEqual(C.formats(C.parse('#ff0000')).cmyk, 'cmyk(0% 100% 100% 0%)'); });
t('invalid inputs return null', () => { ['', 'nope', '#12', 'rgb(a,b,c)', 'hsl(1 2)'].forEach(s => assert.strictEqual(C.parse(s), null, s)); });
t('WCAG ratios match the spec examples', () => {
  assert.strictEqual(C.wcag(C.parse('#000'), C.parse('#fff')).ratio, 21);
  assert.strictEqual(C.wcag(C.parse('#777'), C.parse('#fff')).ratio, 4.47); // famous near miss
  assert.ok(!C.wcag(C.parse('#777'), C.parse('#fff')).aaNormal);
  assert.ok(C.wcag(C.parse('#767676'), C.parse('#fff')).aaNormal);
});
t('APCA polarity and magnitude', () => { assert.ok(Math.abs(C.apca(C.parse('#000'), C.parse('#fff')) - 106.0) < 0.5); assert.ok(C.apca(C.parse('#fff'), C.parse('#000')) < -100); assert.strictEqual(C.apca(C.parse('#888'), C.parse('#888')), 0); });
t('fixContrast reaches the target and keeps hue', () => {
  const fg = C.parse('#38bdf8'), bg = C.parse('#ffffff'), r = C.fixContrast(fg, bg, 4.5);
  assert.ok(r.changed); assert.ok(C.wcag(r.color, bg).ratio >= 4.5);
  assert.ok(Math.abs(C.oklch(r.color).h - C.oklch(fg).h) < 6);
});
t('fixContrast result still passes after rounding to hex', () => {
  const bg = C.parse('#fff');
  ['#777777', '#38bdf8', '#ff6347', '#22c55e'].forEach(h => { const r = C.fixContrast(C.parse(h), bg, 4.5); assert.ok(C.wcag(C.parse(C.toHex(r.color, false)), bg).ratio >= 4.5, h + ' -> ' + C.toHex(r.color)); });
  const r7 = C.fixContrast(C.parse('#777777'), bg, 7); assert.ok(C.wcag(C.parse(C.toHex(r7.color, false)), bg).ratio >= 7);
});
t('translucent text is composited before contrast', () => { assert.ok(C.wcag(C.parse('rgb(0 0 0 / 0.3)'), C.parse('#fff')).ratio < 3); });
t('harmonies and scale', () => { const h = C.harmonies(C.parse('#38bdf8')); assert.strictEqual(h.triadic.length, 3); const s = C.scale(C.parse('#38bdf8')); assert.strictEqual(s.length, 11); assert.ok(C.luminance(s[0].color) > C.luminance(s[10].color)); });
t('color-vision simulation', () => { const r = C.simulate(C.parse('red'), 'protanopia'); assert.ok(r.r < 0.5); const g = C.simulate(C.parse('#38bdf8'), 'achromatopsia'); assert.ok(Math.abs(g.r - g.g) < 1e-9); });
t('nearest name', () => { assert.deepStrictEqual(C.nearestName(C.parse('#ff6348')).name, 'tomato'); assert.ok(C.nearestName(C.parse('#ff6347')).exact); });
console.log(`color engine: ${pass} unit tests passed` + (fail ? `, ${fail} FAILED` : ''));
process.exit(fail ? 1 : 0);
