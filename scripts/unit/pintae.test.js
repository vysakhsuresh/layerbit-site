// Unit tests for js/engines/pintae.js. Run: node scripts/unit/pintae.test.js
const P = require('../../js/engines/pintae.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const GOOD = () => ({
  invoiceNumber: 'INV-1001', issueDate: '2026-09-08', dueDate: '2026-10-08', currencyCode: 'AED', paymentMeansCode: '30',
  seller: { name: 'Acme Trading LLC', trn: '123456789301003', legalId: 'CN-1234567', legalType: 'TL', street: 'Sheikh Zayed Road', city: 'Dubai', country: 'AE' },
  buyer: { name: 'Buyer LLC', trn: '187654321601003', street: 'Al Maryah Island', city: 'Abu Dhabi', emirate: 'AUH', country: 'AE' },
  lines: [{ name: 'Consulting', description: 'ERP readiness consulting, September 2026', quantity: 10, unitCode: 'HUR', unitPrice: 100, taxCategory: 'S', taxPercent: 5 },
          { description: 'Travel', quantity: '1', unitPrice: '250.50' }]
});
const field = (rep, term) => rep.fields.find(f => f.term === term);

t('a complete AED invoice is ready, with 51 fields', () => {
  const rep = P.check(GOOD());
  assert.strictEqual(rep.fields.length, 51);
  assert.ok(rep.ready, JSON.stringify(rep.fields.filter(f => f.status === 'missing' || f.status === 'invalid')) + rep.math);
  assert.strictEqual(field(rep, 'IBT-039').value, 'DXB', 'emirate derived from the city');
  assert.strictEqual(field(rep, 'IBT-039').status, 'derived');
  assert.strictEqual(field(rep, 'IBT-034').value, '1234567893', 'TIN from the TRN');
  assert.strictEqual(field(rep, 'IBT-110').value, '62.53');
  assert.strictEqual(field(rep, 'IBT-112').value, '1313.03');
  assert.strictEqual(field(rep, 'IBT-153').status, 'derived', 'item name from the description');
});
t('TRN and TIN rules', () => {
  assert.deepStrictEqual(P.taxId('123456789301003').errors, []);
  assert.match(P.taxId('123456789301004').errors.join(), /ends with 03/);
  assert.match(P.taxId('223456789301003').errors.join(), /starts with 1|starting with 1/);
  assert.match(P.taxId('12345').errors.join(), /15 digits/);
  assert.strictEqual(P.taxId('1234567893').kind, 'tin');
  assert.strictEqual(P.tinCheckDigit('123456789'), 3);
  assert.match(P.taxId('123456789401003').warnings.join(), /check digit/);
  assert.strictEqual(P.taxId('100-1234-5670-0003').trn, '100123456700003', 'separators ignored');
});
t('missing and invalid fields explain themselves with rule ids', () => {
  const g = GOOD(); delete g.seller.legalId; g.seller.legalType = 'XX'; g.buyer.emirate = 'Dubayy'; g.buyer.city = ''; g.paymentMeansCode = ''; g.dueDate = '';
  g.lines[0].taxCategory = 'S'; g.lines[0].taxPercent = 0; g.lines[1].unitCode = 'BOX'; g.lines[1].description = '';
  const rep = P.check(g);
  assert.ok(!rep.ready);
  assert.strictEqual(field(rep, 'IBT-030').status, 'missing'); assert.match(field(rep, 'IBT-030').message, /ibr-150-ae/);
  assert.strictEqual(field(rep, 'BTAE-15').status, 'invalid');
  assert.strictEqual(field(rep, 'IBT-054').status, 'invalid'); assert.match(field(rep, 'IBT-054').message, /AUH, DXB/);
  assert.strictEqual(field(rep, 'IBT-081').status, 'missing');
  assert.strictEqual(field(rep, 'IBT-009').status, 'missing'); assert.match(field(rep, 'IBT-009').message, /ibr-127-ae/);
  assert.strictEqual(field(rep, 'IBT-152').status, 'invalid'); assert.match(field(rep, 'IBT-152').message, /line 1: .*rate above 0/);
  assert.strictEqual(field(rep, 'IBT-130').status, 'invalid'); assert.match(field(rep, 'IBT-130').message, /BOX/);
  assert.strictEqual(field(rep, 'IBT-154').status, 'missing'); assert.match(field(rep, 'IBT-154').message, /line 2/);
});
t('arithmetic: lines, VAT and totals that do not add up', () => {
  const g = GOOD();
  g.lines[0].netAmount = 999; g.lines[1].vatAmount = 20;
  g.totals = { taxInclusive: 1400, payable: 1313.03 };
  const rep = P.check(g);
  assert.ok(!rep.ready);
  assert.ok(rep.math.some(m => /Line 1: 10 × 100 = 1000.00, but the line amount is 999.00/.test(m)), rep.math);
  assert.ok(rep.math.some(m => /Line 2: 5% of 250.50 is 12.53, but the VAT given is 20.00/.test(m)), rep.math);
  assert.ok(rep.math.some(m => /total with VAT in the file is 1400.00/.test(m)), rep.math);
});
t('foreign currency needs an exchange rate and adds AED amounts', () => {
  const g = GOOD(); g.currencyCode = 'USD';
  let rep = P.check(g);
  assert.strictEqual(field(rep, 'BTAE-08').status, 'missing'); assert.match(field(rep, 'BTAE-08').message, /exchange rate/);
  g.exchangeRate = 3.6725; rep = P.check(g);
  assert.strictEqual(field(rep, 'BTAE-10').status, 'derived');
  const xml = P.toXml(g);
  assert.ok(xml.includes('<cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>'));
  assert.ok(xml.includes('<cbc:Amount currencyID="AED">3672.50</cbc:Amount>'), 'line amount in AED');
  assert.ok(/<cac:TaxTotal>\s*<cbc:TaxAmount currencyID="AED">229\.65<\/cbc:TaxAmount>\s*<\/cac:TaxTotal>/.test(xml), 'document VAT in AED');
});
t('exports and zero-rated lines', () => {
  const g = GOOD(); g.transactionType = '00000001'; delete g.buyer.trn; g.buyer.country = 'GB'; g.buyer.emirate = ''; g.lines.forEach(l => { l.taxCategory = 'Z'; l.taxPercent = 0; });
  const rep = P.check(g);
  assert.strictEqual(field(rep, 'IBT-048').status, 'na');
  assert.strictEqual(field(rep, 'IBT-054').status, 'na');
  assert.strictEqual(field(rep, 'IBT-110').value, '0.00');
  assert.match(P.check(Object.assign(GOOD(), { transactionType: '0000002' })).fields.find(f => f.term === 'BTAE-02').message, /ibr-154-ae/);
});
t('XML: namespaces, profile, parties, breakdown, lines, escaping', () => {
  const g = GOOD(); g.lines[0].description = 'R&D <phase 1>';
  const xml = P.toXml(g);
  for (const s of ['<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>', '<cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>', '<cbc:ProfileExecutionID>00000000</cbc:ProfileExecutionID>',
    '<cbc:EndpointID schemeID="0235">1234567893</cbc:EndpointID>', '<cbc:CountrySubentity>DXB</cbc:CountrySubentity>', '<cbc:CompanyID schemeAgencyID="TL">CN-1234567</cbc:CompanyID>',
    '<cbc:TaxAmount currencyID="AED">62.53</cbc:TaxAmount>', '<cbc:PayableAmount currencyID="AED">1313.03</cbc:PayableAmount>', '<cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>',
    '<cbc:Description>R&amp;D &lt;phase 1&gt;</cbc:Description>', '<cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>', '<cbc:BaseAmount currencyID="AED">250.50</cbc:BaseAmount>']) assert.ok(xml.includes(s), 'missing ' + s);
  assert.strictEqual((xml.match(/<cac:InvoiceLine>/g) || []).length, 2);
  assert.strictEqual((xml.match(/<cac:TaxSubtotal>/g) || []).length, 1);
  const open = (xml.match(/<(?!\?|!|\/)[a-zA-Z:]+[^>]*[^/]>/g) || []).length, close = (xml.match(/<\/[a-zA-Z:]+>/g) || []).length;
  assert.strictEqual(open, close, 'balanced tags');
});
t('dates in common spreadsheet forms become ISO; impossible ones are flagged', () => {
  assert.strictEqual(P.isoDate('08/09/2026'), '2026-09-08', 'UAE day-first');
  assert.strictEqual(P.isoDate('2026/9/8'), '2026-09-08');
  assert.strictEqual(P.isoDate('2026-09-08'), '2026-09-08');
  const g = GOOD(); g.issueDate = 'next tuesday'; assert.strictEqual(P.check(g).fields.find(f => f.term === 'IBT-002').status, 'invalid');
  const h = GOOD(); h.dueDate = '2026-09-01'; assert.match(P.check(h).fields.find(f => f.term === 'IBT-009').message, /before the issue date/);
});
t('code lists are present with their source', () => {
  assert.match(P.SPEC.codes, /PINT AE Billing 1\.0\.4/);
  assert.ok(P.CODES.UNIT_CODES.HUR && P.CODES.UNIT_CODES.C62 && P.CODES.CURRENCY_CODES.AED && P.CODES.TAX_CATEGORY_CODES.S);
  assert.deepStrictEqual(Object.keys(P.CODES.TAX_CATEGORY_CODES).sort(), ['AE', 'E', 'N', 'O', 'S', 'Z']);
});

console.log(`pintae: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
