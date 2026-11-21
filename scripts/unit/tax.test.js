// Unit tests for js/engines/tax.js. Run: node scripts/unit/tax.test.js
const T = require('../../js/engines/tax.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const calc = o => { const r = T.calc(o); return { net: T.format(r.net, r.decimals, r.system), tax: T.format(r.tax, r.decimals, r.system), gross: T.format(r.gross, r.decimals, r.system), split: r.split && r.split.map(s => s.name + ' ' + T.rateText(s.rate) + ' ' + T.format(s.amount, r.decimals, r.system)) }; };

t('parse amounts in any common form', () => {
  assert.strictEqual(T.parseAmount('₹1,23,456.78', 2), 12345678n);
  assert.strictEqual(T.parseAmount('AED 1 050', 2), 105000n);
  assert.strictEqual(T.parseAmount('1.500', 2), 150n);
  assert.strictEqual(T.parseAmount('-200', 2), -20000n);
  assert.strictEqual(T.parseAmount('.5', 3), 500n);
  assert.strictEqual(T.parseAmount('Rs. 99', 2), 9900n);
  assert.throws(() => T.parseAmount('1.005', 2), /2 decimal places/);
  assert.throws(() => T.parseAmount('abc', 2), /not a number/);
  assert.throws(() => T.parseAmount('', 2), /Enter an amount/);
});
t('parse rates', () => {
  assert.strictEqual(T.parseRate('18%'), 180000n);
  assert.strictEqual(T.parseRate('0.25'), 2500n);
  assert.strictEqual(T.rateText(2500n), '0.25%'); assert.strictEqual(T.rateText(90000n), '9%'); assert.strictEqual(T.rateText(1250n), '0.125%');
  assert.throws(() => T.parseRate('101'), /100%/);
  assert.throws(() => T.parseRate('five'), /tax rate/);
});
t('UAE VAT: add and remove 5%', () => {
  assert.deepStrictEqual(calc({ amount: '1000', rate: '5', currency: 'AED', mode: 'add' }), { net: '1,000.00', tax: '50.00', gross: '1,050.00', split: null });
  assert.deepStrictEqual(calc({ amount: '1050', rate: '5', currency: 'AED', mode: 'remove' }), { net: '1,000.00', tax: '50.00', gross: '1,050.00', split: null });
  assert.deepStrictEqual(calc({ amount: '100', rate: '5', currency: 'AED', mode: 'remove' }), { net: '95.24', tax: '4.76', gross: '100.00', split: null });
});
t('half-up rounding to the fils', () => {
  assert.strictEqual(calc({ amount: '0.10', rate: '5', currency: 'AED', mode: 'add' }).tax, '0.01');   // 0.005 -> 0.01
  assert.strictEqual(calc({ amount: '0.09', rate: '5', currency: 'AED', mode: 'add' }).tax, '0.00');   // 0.0045 -> 0.00
  assert.strictEqual(calc({ amount: '-100', rate: '5', currency: 'AED', mode: 'add' }).gross, '-105.00');
});
t('Saudi 15% and three-decimal currencies', () => {
  assert.strictEqual(calc({ amount: '2,000', rate: '15', currency: 'SAR', mode: 'add' }).gross, '2,300.00');
  assert.deepStrictEqual(calc({ amount: '10.5', rate: '5', currency: 'OMR', mode: 'add' }), { net: '10.500', tax: '0.525', gross: '11.025', split: null });
  assert.strictEqual(calc({ amount: '110', rate: '10', currency: 'BHD', mode: 'remove' }).net, '100.000');
});
t('India GST: CGST + SGST, UTGST and IGST', () => {
  assert.deepStrictEqual(calc({ amount: '10000', rate: '18', currency: 'INR', mode: 'add', kind: 'gst', supply: 'intra' }),
    { net: '10,000.00', tax: '1,800.00', gross: '11,800.00', split: ['CGST 9% 900.00', 'SGST 9% 900.00'] });
  assert.deepStrictEqual(calc({ amount: '10000', rate: '18', currency: 'INR', mode: 'add', kind: 'gst', supply: 'inter' }).split, ['IGST 18% 1,800.00']);
  assert.deepStrictEqual(calc({ amount: '10000', rate: '5', currency: 'INR', mode: 'add', kind: 'gst', supply: 'ut' }).split, ['CGST 2.5% 250.00', 'UTGST 2.5% 250.00']);
  assert.deepStrictEqual(calc({ amount: '1,18,000', rate: '18', currency: 'INR', mode: 'remove', kind: 'gst' }).net, '1,00,000.00');
  assert.deepStrictEqual(calc({ amount: '0.05', rate: '18', currency: 'INR', mode: 'add', kind: 'gst' }).split, ['CGST 9% 0.01', 'SGST 9% 0.00']);
  assert.strictEqual(calc({ amount: '100000', rate: '0.25', currency: 'INR', mode: 'add', kind: 'gst' }).tax, '250.00');
});
t('rounding tax to whole units', () => {
  assert.deepStrictEqual(calc({ amount: '999', rate: '18', currency: 'INR', mode: 'add', wholeUnits: true }), { net: '999.00', tax: '180.00', gross: '1,179.00', split: null });
  const r = calc({ amount: '1000', rate: '18', currency: 'INR', mode: 'remove', wholeUnits: true });
  assert.deepStrictEqual([r.net, r.tax], ['847.00', '153.00']);
});
t('digit grouping', () => {
  assert.strictEqual(T.format(12345678n, 2, 'indian'), '1,23,456.78');
  assert.strictEqual(T.format(1000000000n, 2, 'indian'), '1,00,00,000.00');
  assert.strictEqual(T.format(99900n, 2, 'indian'), '999.00');
  assert.strictEqual(T.format(123456789n, 2, 'intl'), '1,234,567.89');
  assert.strictEqual(T.format(-5n, 2, 'intl'), '-0.05');
});
t('numbers in words', () => {
  assert.strictEqual(T.numberWords(123456, 'indian'), 'One Lakh Twenty-Three Thousand Four Hundred Fifty-Six');
  assert.strictEqual(T.numberWords(1000000000, 'indian'), 'One Hundred Crore');
  assert.strictEqual(T.numberWords(25000000, 'indian'), 'Two Crore Fifty Lakh');
  assert.strictEqual(T.numberWords(123456, 'intl'), 'One Hundred Twenty-Three Thousand Four Hundred Fifty-Six');
  assert.strictEqual(T.numberWords(2500000, 'intl'), 'Two Million Five Hundred Thousand');
  assert.strictEqual(T.numberWords(0, 'intl'), 'Zero'); assert.strictEqual(T.numberWords(15, 'intl'), 'Fifteen'); assert.strictEqual(T.numberWords(90, 'intl'), 'Ninety');
});
t('amounts in words for invoices', () => {
  assert.strictEqual(T.amountWords(12345678n, 'INR'), 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Seventy-Eight Paise Only');
  assert.strictEqual(T.amountWords(105000n, 'AED'), 'UAE Dirhams One Thousand Fifty Only');
  assert.strictEqual(T.amountWords(11025n, 'OMR'), 'Omani Rials Eleven and Twenty-Five Baisa Only');
  assert.strictEqual(T.amountWords(101n, 'SAR'), 'Saudi Riyal One and One Halala Only');
});
t('tax share of an inclusive price', () => {
  assert.strictEqual(T.inclusiveFraction(50000n), '1/21');
  assert.strictEqual(T.inclusiveFraction(150000n), '3/23');
  assert.strictEqual(T.inclusiveFraction(180000n), '9/59');
  assert.strictEqual(T.inclusiveFraction(100000n), '1/11');
});

console.log(`tax: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
