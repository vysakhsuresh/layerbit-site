/* Layerbit PINT-AE readiness engine: builds a UAE PINT AE (Peppol) UBL
 * invoice from plain data, checks it against the 51 mandatory fields of a
 * UAE tax invoice and the arithmetic an Accredited Service Provider will
 * re-check, and reads a PINT AE XML back into the same data for checking.
 *
 * This is an independent readiness check, modelled on PINT AE Billing 1.0.4
 * and the Ministry of Finance's mandatory-field list. It is not the official
 * Schematron and has not been reviewed by an accredited provider; only an
 * ASP can validate and exchange an e-invoice in the UAE.
 *
 * SPEC; taxId(raw); normalize(input) -> r; check(input) -> report; toXml(input) -> string;
 * fromXml(doc) -> input   (doc: a DOM Document from DOMParser)
 * input = { invoiceNumber, issueDate, dueDate, typeCode, currencyCode, exchangeRate, transactionType,
 *   paymentMeansCode, buyerReference, seller: {name, trn, tin, legalId, legalType, street, city, emirate, country},
 *   buyer: {...}, lines: [{id, name, description, quantity, unitCode, unitPrice, netAmount, taxCategory, taxPercent, vatAmount}],
 *   totals: {lineNet, taxExclusive, tax, taxInclusive, payable} (optional: compared with the computed values) }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pintae-codes.js'));
  else root.LBPintAE = factory(root.LBPintAECodes);
})(typeof self !== 'undefined' ? self : this, function (CODES) {
  'use strict';
  var SPEC = {
    version: 'PINT AE Billing 1.0.4',
    fields: 'UAE Electronic Invoice Mandatory Fields v1.0 (Ministry of Finance, 23 February 2026)',
    codes: CODES.source,
    customizationId: 'urn:peppol:pint:billing-1@ae-1',
    profileId: 'urn:peppol:bis:billing',
    endpointScheme: '0235'
  };
  var EMIRATES = { AUH: 'Abu Dhabi', DXB: 'Dubai', SHJ: 'Sharjah', UAQ: 'Umm Al Quwain', FUJ: 'Fujairah', AJM: 'Ajman', RAK: 'Ras Al Khaimah' };
  var EMIRATE_ALIASES = { 'abu dhabi': 'AUH', 'al ain': 'AUH', dubai: 'DXB', sharjah: 'SHJ', 'umm al quwain': 'UAQ', 'umm al-quwain': 'UAQ', fujairah: 'FUJ', ajman: 'AJM', 'ras al khaimah': 'RAK', 'ras al-khaimah': 'RAK' };
  var LEGAL_TYPES = { TL: 'Commercial or trade licence', EID: 'Emirates ID', PAS: 'Passport', CD: 'Cabinet decision' };
  var FLAGS = ['Free trade zone', 'Deemed supply', 'Margin scheme', 'Summary invoice', 'Continuous supply', 'Disclosed agent billing', 'E-commerce', 'Exports'];

  var has = function (v) { return v !== undefined && v !== null && String(v).trim() !== ''; };
  var digits = function (v) { return String(v == null ? '' : v).replace(/\D/g, ''); };
  function round2(n) { return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function amount(v) { if (v === undefined || v === null || v === '') return null; var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]|AED|USD|EUR/gi, '')); return isFinite(n) ? n : NaN; }
  function isoDate(v) {
    if (!has(v)) return null;
    var s = String(v).trim(), m;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);   // UAE order: day first
    if ((m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    var d = new Date(s);
    return isNaN(d.getTime()) ? 'invalid' : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
  }

  // ----------------------------------------------------------- TRN / TIN
  function tinCheckDigit(nine) {
    var sum = 0;
    for (var i = 0; i < 9; i++) { var v = +nine[i] * (i % 2 === 0 ? 2 : 1); sum += v >= 10 ? Math.floor(v / 10) + v % 10 : v; }
    return sum % 10;
  }
  /** A 15-digit TRN or a 10-digit TIN -> {kind, trn, tin, errors, warnings}. */
  function taxId(raw) {
    var d = digits(raw), out = { kind: d.length === 15 ? 'trn' : d.length === 10 ? 'tin' : 'unknown', trn: null, tin: null, errors: [], warnings: [] };
    if (!d) { out.errors.push('Empty.'); return out; }
    if (out.kind === 'unknown') { out.errors.push('A TRN has 15 digits and a TIN 10; this has ' + d.length + '.'); return out; }
    if (out.kind === 'trn') {
      out.trn = d; out.tin = d.slice(0, 10);
      if (!/^1\d{12}03$/.test(d)) out.errors.push('A UAE VAT TRN starts with 1 and ends with 03 (ibr-132-ae).');
    } else out.tin = d;
    if (!/^1\d{9}$/.test(out.tin)) out.errors.push('A TIN is 10 digits starting with 1 (ibr-148-ae).');
    else if (tinCheckDigit(out.tin.slice(0, 9)) !== +out.tin[9]) out.warnings.push('The 10th digit of the TIN (' + out.tin + ') is not the check digit of the Peppol AE:TIN scheme; check the number with the FTA.');
    return out;
  }

  // ------------------------------------------------------------ normalise
  // strict: reading a received XML, so nothing that must be in the file is filled in for it
  function party(p, strict) {
    p = p || {};
    var id = taxId(p.trn || p.tin || ''), country = String(p.country || 'AE').trim().toUpperCase();
    var em = String(p.emirate || '').trim(), emCode = EMIRATES[em.toUpperCase()] ? em.toUpperCase() : EMIRATE_ALIASES[em.toLowerCase()] || (country === 'AE' && !strict ? EMIRATE_ALIASES[String(p.city || '').trim().toLowerCase()] : '') || (em ? em : '');
    return {
      name: has(p.name) ? String(p.name).trim() : '', trn: id.trn, tin: has(p.tin) ? digits(p.tin) : (strict ? null : id.tin), id: id,
      legalId: has(p.legalId) ? String(p.legalId).trim() : '', legalType: has(p.legalType) ? String(p.legalType).trim().toUpperCase() : '',
      street: has(p.street) ? String(p.street).trim() : '', city: has(p.city) ? String(p.city).trim() : '', emirate: emCode, emirateDerived: !em && !!emCode, country: country
    };
  }
  function normalize(input) {
    input = input || {};
    var strict = !!input.declared;
    var cur = String(input.currencyCode || 'AED').trim().toUpperCase(), rate = cur === 'AED' ? 1 : amount(input.exchangeRate);
    var lines = (input.lines || []).map(function (l, i) {
      var q = amount(l.quantity), price = amount(l.unitPrice), net = amount(l.netAmount);
      if (q === null) q = 1;
      if (net === null && isFinite(q) && isFinite(price) && price !== null) net = round2(q * price);
      if ((price === null || isNaN(price)) && isFinite(net) && net !== null && q) price = round2(net / q);
      var cat = String(l.taxCategory || 'S').trim().toUpperCase(), pct = amount(l.taxPercent);
      if (pct === null) pct = cat === 'S' ? 5 : cat === 'Z' ? 0 : null;
      var vat = amount(l.vatAmount);
      var vatCalc = isFinite(net) && net !== null && pct !== null && isFinite(pct) ? round2(net * pct / 100) : null;
      return {
        raw: l, index: i, id: has(l.id) ? String(l.id).trim() : String(i + 1), name: has(l.name) ? String(l.name).trim() : (has(l.description) && !strict ? String(l.description).trim().slice(0, 100) : ''),
        nameDerived: !has(l.name) && has(l.description), description: has(l.description) ? String(l.description).trim() : '', quantity: q, unitCode: has(l.unitCode) ? String(l.unitCode).trim() : (strict ? '' : 'C62'), unitDerived: !has(l.unitCode),
        unitPrice: price, netAmount: net, taxCategory: cat, taxPercent: pct, vatAmount: vat === null ? vatCalc : vat, vatGiven: vat !== null, vatCalc: vatCalc,
        vatAed: rate && isFinite(rate) ? round2((vat === null ? vatCalc : vat) * rate) : null, amountAed: rate && isFinite(rate) && net !== null ? round2(net * rate) : null
      };
    });
    var groups = {};
    lines.forEach(function (l) {
      var k = l.taxCategory + '|' + (l.taxPercent === null ? '' : l.taxPercent);
      if (!groups[k]) groups[k] = { taxCategory: l.taxCategory, taxPercent: l.taxPercent, taxable: 0, tax: 0 };
      groups[k].taxable += isFinite(l.netAmount) ? l.netAmount : 0; groups[k].tax += isFinite(l.vatAmount) ? l.vatAmount : 0;
    });
    var breakdown = Object.keys(groups).map(function (k) { var g = groups[k]; g.taxable = round2(g.taxable); g.tax = round2(g.tax); return g; });
    var lineNet = round2(lines.reduce(function (s, l) { return s + (isFinite(l.netAmount) ? l.netAmount : 0); }, 0));
    var tax = round2(breakdown.reduce(function (s, g) { return s + g.tax; }, 0));
    var t = input.totals || {};
    var tt = String(input.transactionType || '').trim();
    return {
      input: input, invoiceNumber: has(input.invoiceNumber) ? String(input.invoiceNumber).trim() : '', issueDate: isoDate(input.issueDate), dueDate: isoDate(input.dueDate),
      typeCode: has(input.typeCode) ? String(input.typeCode).trim() : '380', currency: cur, exchangeRate: rate,
      transactionType: tt || (strict ? '' : '00000000'), transactionDerived: !tt, strict: strict, paymentMeansCode: has(input.paymentMeansCode) ? String(input.paymentMeansCode).trim() : '',
      buyerReference: has(input.buyerReference) ? String(input.buyerReference).trim() : '',
      seller: party(input.seller, strict), buyer: party(input.buyer, strict), lines: lines, breakdown: breakdown,
      computed: { lineNet: lineNet, taxExclusive: lineNet, tax: tax, taxInclusive: round2(lineNet + tax), payable: round2(lineNet + tax) },
      given: { lineNet: amount(t.lineNet), taxExclusive: amount(t.taxExclusive), tax: amount(t.tax), taxInclusive: amount(t.taxInclusive), payable: amount(t.payable) }
    };
  }

  // --------------------------------------------------------------- check
  function F(term, name, path, rules) { return { term: term, name: name, path: path, rules: rules || [] }; }
  var ok = function (v, msg) { return { status: 'ok', value: v, message: msg || '' }; };
  var derived = function (v, msg) { return { status: 'derived', value: v, message: msg }; };
  var missing = function (msg) { return { status: 'missing', value: null, message: msg }; };
  var bad = function (v, msg) { return { status: 'invalid', value: v, message: msg }; };
  var na = function (msg) { return { status: 'na', value: null, message: msg }; };
  function inList(v, list, label, missMsg) { if (!has(v)) return missing(missMsg); return list[v] !== undefined ? ok(v, list[v]) : bad(v, '"' + v + '" is not in the ' + label + ' code list.'); }
  function eachLine(r, fn) {
    if (!r.lines.length) return missing('The invoice has no lines.');
    var worst = null, notes = [];
    r.lines.forEach(function (l) { var x = fn(l); if (x.status === 'missing' || x.status === 'invalid') { notes.push('line ' + l.id + ': ' + x.message); if (!worst || x.status === 'invalid') worst = x; } else if (x.status === 'derived' && !worst) worst = x; });
    if (worst && (worst.status === 'missing' || worst.status === 'invalid')) return { status: worst.status, value: null, message: notes.slice(0, 3).join('; ') + (notes.length > 3 ? '; and ' + (notes.length - 3) + ' more' : '') };
    return worst ? worst : ok(r.lines.length + ' line' + (r.lines.length === 1 ? '' : 's'));
  }
  function partyFields(role) {
    var P = role === 'seller' ? 'cac:AccountingSupplierParty/cac:Party/' : 'cac:AccountingCustomerParty/cac:Party/', S = role === 'seller';
    var T = S ? { name: 'IBT-027', end: 'IBT-034', trn: 'IBT-031', line: 'IBT-035', city: 'IBT-037', sub: 'IBT-039', ctry: 'IBT-040' } : { name: 'IBT-044', end: 'IBT-049', trn: 'IBT-048', line: 'IBT-050', city: 'IBT-052', sub: 'IBT-054', ctry: 'IBT-055' };
    var who = S ? 'Seller' : 'Buyer', p = function (r) { return r[role]; };
    var list = [
      [F(T.name, who + ' name', P + 'cac:PartyLegalEntity/cbc:RegistrationName'), function (r) { return has(p(r).name) ? ok(p(r).name) : missing('Enter the ' + role + "'s registered legal name."); }],
      [F(T.end, who + ' electronic address', P + 'cbc:EndpointID'), function (r) {
        var x = p(r);
        if (!x.tin) return missing(r.strict ? 'The file has no EndpointID for the ' + role + '; under scheme 0235 it is the TIN, the first 10 digits of the TRN.' : 'Derived from the ' + role + "'s TRN or TIN, which is missing.");
        return /^1\d{9}$/.test(x.tin) ? derived(x.tin, 'The first 10 digits of the TRN, the TIN, under scheme 0235.') : bad(x.tin, 'Under scheme 0235 the address is a 10-digit TIN starting with 1 (ibr-148-ae).');
      }],
      [F(T.end + '-1', who + ' electronic address scheme', P + 'cbc:EndpointID/@schemeID'), function () { return derived('0235', 'UAE participants use scheme 0235.'); }],
      [F(T.trn, who + ' VAT TRN', P + "cac:PartyTaxScheme/cbc:CompanyID"), function (r) {
        var x = p(r);
        if (!x.trn) {
          if (!S && (r.transactionType[7] === '1')) return na('Not needed for an export with no UAE buyer TRN.');
          return missing(S ? 'The seller TRN is required on a tax invoice (ibr-134-ae).' : 'The buyer TRN is required unless the buyer is addressed another way or the sale is an export (ibr-135-ae).');
        }
        return x.id.errors.length ? bad(x.trn, x.id.errors.join(' ')) : ok(x.trn, x.id.warnings.join(' '));
      }],
      [F(T.trn + '-1', who + ' tax scheme', P + 'cac:PartyTaxScheme/cac:TaxScheme/cbc:ID'), function (r) { return p(r).trn ? derived('VAT', 'Written with the TRN.') : na('Written only with a TRN.'); }]
    ];
    if (S) {
      list.splice(3, 0,
        [F('IBT-030', 'Seller legal registration identifier', P + 'cac:PartyLegalEntity/cbc:CompanyID', ['ibr-150-ae']), function (r) { return has(r.seller.legalId) ? ok(r.seller.legalId) : missing('Enter the seller\'s trade licence (or other legal registration) number (ibr-150-ae).'); }],
        [F('BTAE-15', 'Seller legal registration identifier type', P + 'cac:PartyLegalEntity/cbc:CompanyID/@schemeAgencyID', ['ibr-173-ae']), function (r) { return inList(r.seller.legalType, LEGAL_TYPES, 'legal registration type (TL, EID, PAS, CD)', 'Choose what the registration number is: TL for a trade licence, EID, PAS or CD.'); }]);
    }
    list.push(
      [F(T.line, who + ' address line', P + 'cac:PostalAddress/cbc:StreetName'), function (r) { return has(p(r).street) ? ok(p(r).street) : missing('Enter the ' + role + "'s street address."); }],
      [F(T.city, who + ' city', P + 'cac:PostalAddress/cbc:CityName'), function (r) { return has(p(r).city) ? ok(p(r).city) : missing('Enter the ' + role + "'s city."); }],
      [F(T.sub, who + ' emirate', P + 'cac:PostalAddress/cbc:CountrySubentity', ['ibr-128-ae']), function (r) {
        var x = p(r);
        if (x.country !== 'AE') return has(x.emirate) ? ok(x.emirate) : na('Only required for UAE addresses.');
        if (!x.emirate) return missing('Choose the emirate code: ' + Object.keys(EMIRATES).join(', ') + ' (ibr-128-ae).');
        if (!EMIRATES[x.emirate]) return bad(x.emirate, '"' + x.emirate + '" is not an emirate code; use ' + Object.keys(EMIRATES).join(', ') + ' (ibr-128-ae).');
        return x.emirateDerived ? derived(x.emirate, 'From the city name.') : ok(x.emirate, EMIRATES[x.emirate]);
      }],
      [F(T.ctry, who + ' country', P + 'cac:PostalAddress/cac:Country/cbc:IdentificationCode'), function (r) { return inList(p(r).country, CODES.COUNTRY_CODES, 'ISO 3166 country', 'Enter the country code.'); }]);
    return list;
  }
  var FIELDS = [
    [F('IBT-001', 'Invoice number', 'cbc:ID'), function (r) { return has(r.invoiceNumber) ? ok(r.invoiceNumber) : missing('Every invoice needs a unique number.'); }],
    [F('IBT-002', 'Invoice date', 'cbc:IssueDate'), function (r) { return !r.issueDate ? missing('Enter the issue date.') : r.issueDate === 'invalid' ? bad(r.input.issueDate, 'Not a date; use YYYY-MM-DD.') : ok(r.issueDate); }],
    [F('IBT-003', 'Invoice type code', 'cbc:InvoiceTypeCode'), function (r) { return inList(r.typeCode, CODES.INVOICE_TYPE_CODES, 'invoice type', 'Use 380 for a tax invoice.'); }],
    [F('IBT-005', 'Invoice currency code', 'cbc:DocumentCurrencyCode'), function (r) { return inList(r.currency, CODES.CURRENCY_CODES, 'ISO 4217 currency', 'Enter the currency, such as AED.'); }],
    [F('BTAE-02', 'Invoice transaction type code', 'cbc:ProfileExecutionID', ['ibr-154-ae']), function (r) { if (!r.transactionType) return missing('The file has no ProfileExecutionID: eight 0/1 flags for ' + FLAGS.join(', ') + ' (ibr-154-ae).'); return !/^[01]{8}$/.test(r.transactionType) ? bad(r.transactionType, 'Eight characters of 0 or 1, one per flag: ' + FLAGS.join(', ') + ' (ibr-154-ae).') : r.transactionDerived ? derived(r.transactionType, 'No special transaction: free zone, deemed supply, margin scheme, summary, continuous, agent, e-commerce and export flags all 0.') : ok(r.transactionType); }],
    [F('IBT-009', 'Payment due date', 'cbc:DueDate', ['ibr-127-ae']), function (r) {
      if (r.dueDate === 'invalid') return bad(r.input.dueDate, 'Not a date; use YYYY-MM-DD.');
      if (r.dueDate) return r.issueDate && r.issueDate !== 'invalid' && r.dueDate < r.issueDate ? bad(r.dueDate, 'The due date is before the issue date.') : ok(r.dueDate);
      return r.computed.payable > 0 && r.transactionType[1] !== '1' ? missing('Required when an amount is due (ibr-127-ae).') : na('Not required when nothing is due.');
    }],
    [F('IBT-023', 'Business process type', 'cbc:ProfileID', ['aligned-ibrp-002-ae']), function (r) {
      var d = r.input.declared; if (!d) return derived(SPEC.profileId, 'Fixed for PINT AE billing.');
      return !d.profileId ? missing('The file has no ProfileID.') : /^urn:peppol:bis:(billing|selfbilling)$/.test(d.profileId) ? ok(d.profileId) : bad(d.profileId, 'Must be urn:peppol:bis:billing (or selfbilling) (aligned-ibrp-002-ae).');
    }],
    [F('IBT-024', 'Specification identifier', 'cbc:CustomizationID', ['aligned-ibrp-001-ae']), function (r) {
      var d = r.input.declared; if (!d) return derived(SPEC.customizationId, 'Fixed for PINT AE billing.');
      return !d.customizationId ? missing('The file has no CustomizationID.') : /^urn:peppol:pint:(billing|selfbilling)-1@ae-1/.test(d.customizationId) ? ok(d.customizationId) : bad(d.customizationId, 'Must start with ' + SPEC.customizationId + '; a generic Peppol BIS or PINT identifier is not the UAE profile (aligned-ibrp-001-ae).');
    }],
    [F('IBT-081', 'Payment means type code', 'cac:PaymentMeans/cbc:PaymentMeansCode', ['ibr-191-ae']), function (r) { return inList(r.paymentMeansCode, CODES.PAYMENT_MEANS_CODES, 'payment means', 'Choose how the buyer pays, for example 30 (credit transfer) (ibr-191-ae).'); }]
  ].concat(partyFields('seller'), partyFields('buyer'), [
    [F('IBT-106', 'Sum of invoice line net amounts', 'cac:LegalMonetaryTotal/cbc:LineExtensionAmount'), function (r) { return derived(r.computed.lineNet.toFixed(2), 'Added up from the lines.'); }],
    [F('IBT-109', 'Invoice total without VAT', 'cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount'), function (r) { return derived(r.computed.taxExclusive.toFixed(2), 'Line total; no document-level allowances or charges.'); }],
    [F('IBT-110', 'Invoice total VAT', 'cac:TaxTotal/cbc:TaxAmount'), function (r) { return derived(r.computed.tax.toFixed(2), 'Added up from the VAT breakdown.'); }],
    [F('IBT-112', 'Invoice total with VAT', 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount'), function (r) { return derived(r.computed.taxInclusive.toFixed(2), 'Total without VAT plus VAT.'); }],
    [F('IBT-115', 'Amount due for payment', 'cac:LegalMonetaryTotal/cbc:PayableAmount'), function (r) { return derived(r.computed.payable.toFixed(2), 'Total with VAT; no prepayment.'); }],
    [F('IBT-116', 'VAT category taxable amount', 'cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount'), function (r) { return r.breakdown.length ? derived(r.breakdown.length + ' categor' + (r.breakdown.length === 1 ? 'y' : 'ies'), 'Grouped from the lines by category and rate.') : missing('No lines to group.'); }],
    [F('IBT-117', 'VAT category tax amount', 'cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount'), function (r) { return r.breakdown.length ? derived(r.breakdown.map(function (g) { return g.taxCategory + ' ' + g.tax.toFixed(2); }).join(', '), 'Grouped from the lines.') : missing('No lines to group.'); }],
    [F('IBT-118', 'VAT category code', 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:ID', ['ibr-139-ae']), function (r) { var b = r.breakdown.filter(function (g) { return CODES.TAX_CATEGORY_CODES[g.taxCategory] === undefined; }); return !r.breakdown.length ? missing('No lines to group.') : b.length ? bad(b[0].taxCategory, '"' + b[0].taxCategory + '" is not a PINT AE tax category; use ' + Object.keys(CODES.TAX_CATEGORY_CODES).join(', ') + '.') : ok(r.breakdown.map(function (g) { return g.taxCategory; }).join(', ')); }],
    [F('IBT-119', 'VAT category rate', 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent'), function (r) { var x = r.breakdown.map(function (g) { return rateRule(g.taxCategory, g.taxPercent); }).filter(function (v) { return v.status === 'invalid' || v.status === 'missing'; }); return x.length ? x[0] : r.breakdown.length ? ok(r.breakdown.map(function (g) { return g.taxPercent === null ? '–' : g.taxPercent + '%'; }).join(', ')) : missing('No lines to group.'); }],
    [F('IBT-126', 'Invoice line identifier', 'cac:InvoiceLine/cbc:ID'), function (r) { var ids = r.lines.map(function (l) { return l.id; }), dup = ids.filter(function (v, i) { return ids.indexOf(v) !== i; }); return !r.lines.length ? missing('The invoice has no lines.') : dup.length ? bad(dup[0], 'Line number ' + dup[0] + ' is used twice.') : ok(ids.length + ' lines'); }],
    [F('IBT-129', 'Invoiced quantity', 'cac:InvoiceLine/cbc:InvoicedQuantity'), function (r) { return eachLine(r, function (l) { return isFinite(l.quantity) ? ok(l.quantity) : bad(l.raw.quantity, 'The quantity is not a number.'); }); }],
    [F('IBT-130', 'Unit of measure code', 'cac:InvoiceLine/cbc:InvoicedQuantity/@unitCode'), function (r) { return eachLine(r, function (l) { return !l.unitCode ? missing('The quantity has no unitCode.') : CODES.UNIT_CODES[l.unitCode] === undefined ? bad(l.unitCode, '"' + l.unitCode + '" is not a UN/ECE Recommendation 20 unit code (C62 is "one", HUR an hour, KGM a kilogram).') : l.unitDerived ? derived('C62', 'No unit given; C62 ("one") is used.') : ok(l.unitCode); }); }],
    [F('IBT-131', 'Invoice line net amount', 'cac:InvoiceLine/cbc:LineExtensionAmount'), function (r) { return eachLine(r, function (l) { return l.netAmount === null || !isFinite(l.netAmount) ? missing('Needs a quantity and a unit price, or a line amount.') : ok(l.netAmount.toFixed(2)); }); }],
    [F('IBT-146', 'Item net price', 'cac:InvoiceLine/cac:Price/cbc:PriceAmount'), function (r) { return eachLine(r, function (l) { return l.unitPrice === null || !isFinite(l.unitPrice) ? missing('No unit price.') : l.unitPrice < 0 ? bad(l.unitPrice, 'A price cannot be negative.') : ok(l.unitPrice); }); }],
    [F('IBT-148', 'Item gross price', 'cac:InvoiceLine/cac:Price/cac:AllowanceCharge/cbc:BaseAmount', ['ibr-126-ae']), function (r) { return eachLine(r, function (l) { return isFinite(l.unitPrice) && l.unitPrice !== null ? derived(l.unitPrice, 'Equal to the net price: no price discount.') : missing('No unit price.'); }); }],
    [F('IBT-149', 'Item price base quantity', 'cac:InvoiceLine/cac:Price/cbc:BaseQuantity', ['ibr-126-ae']), function (r) { return eachLine(r, function () { return derived(1, 'The price is per one unit.'); }); }],
    [F('IBT-151', 'Item VAT category code', 'cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:ID', ['ibr-145-ae']), function (r) { return eachLine(r, function (l) { return inList(l.taxCategory, CODES.TAX_CATEGORY_CODES, 'PINT AE tax category', 'Enter the VAT category (S for standard).'); }); }],
    [F('IBT-152', 'Item VAT rate', 'cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent'), function (r) { return eachLine(r, function (l) { return rateRule(l.taxCategory, l.taxPercent); }); }],
    [F('BTAE-08', 'Line VAT amount in AED', 'cac:InvoiceLine/cac:TaxTotal/cbc:TaxAmount', ['ibr-104-ae']), function (r) { return eachLine(r, function (l) { return l.vatAed === null || !isFinite(l.vatAed) ? missing(r.currency === 'AED' ? 'No VAT amount.' : 'Enter the exchange rate to AED (ibr-104-ae).') : r.currency === 'AED' ? derived(l.vatAed.toFixed(2), 'The line VAT, already in AED.') : derived(l.vatAed.toFixed(2), 'Converted at ' + r.exchangeRate + ' AED per ' + r.currency + '.'); }); }],
    [F('BTAE-10', 'Line amount in AED', 'cac:InvoiceLine/cac:ItemPriceExtension/cbc:Amount', ['ibr-104-ae']), function (r) { return eachLine(r, function (l) { return l.amountAed === null || !isFinite(l.amountAed) ? missing(r.currency === 'AED' ? 'No line amount.' : 'Enter the exchange rate to AED (ibr-104-ae).') : derived(l.amountAed.toFixed(2), r.currency === 'AED' ? 'The line amount, already in AED.' : 'Converted to AED.'); }); }],
    [F('IBT-153', 'Item name', 'cac:InvoiceLine/cac:Item/cbc:Name'), function (r) { return eachLine(r, function (l) { return !has(l.name) ? missing('Each line needs an item name.') : l.nameDerived ? derived(l.name, 'Taken from the description.') : ok(l.name); }); }],
    [F('IBT-154', 'Item description', 'cac:InvoiceLine/cac:Item/cbc:Description', ['ibr-125-ae']), function (r) { return eachLine(r, function (l) { return has(l.description) ? ok(l.description) : missing('Each line needs a description (ibr-125-ae).'); }); }]
  ]);
  function rateRule(cat, pct) {
    if (cat === 'S') return pct === null || !isFinite(pct) ? missing('A standard-rated line needs a VAT rate.') : pct > 0 ? ok(pct + '%') : bad(pct, 'A standard-rated (S) line must have a rate above 0.');
    if (cat === 'Z') return pct === 0 || pct === null ? ok('0%') : bad(pct, 'A zero-rated (Z) line must have a rate of 0.');
    if (cat === 'E' || cat === 'O') return pct === null || pct === 0 ? na('No rate for exempt or out-of-scope lines.') : bad(pct, 'Exempt (E) and out-of-scope (O) lines have no VAT rate.');
    return pct === null ? missing('No VAT rate.') : ok(pct + '%');
  }
  function check(input) {
    var r = normalize(input), fields = FIELDS.map(function (f) { var res = f[1](r); return Object.assign({}, f[0], res); });
    var math = [];
    var near = function (a, b) { return Math.abs(a - b) <= 0.01 + 1e-9; };
    r.lines.forEach(function (l) {
      var q = l.quantity, p = l.unitPrice, n = amount(l.raw.netAmount);
      if (n !== null && isFinite(q) && isFinite(p) && p !== null && !near(round2(q * p), n)) math.push('Line ' + l.id + ': ' + q + ' × ' + p + ' = ' + round2(q * p).toFixed(2) + ', but the line amount is ' + n.toFixed(2) + '.');
      if (l.vatGiven && l.vatCalc !== null && !near(l.vatAmount, l.vatCalc)) math.push('Line ' + l.id + ': ' + l.taxPercent + '% of ' + l.netAmount.toFixed(2) + ' is ' + l.vatCalc.toFixed(2) + ', but the VAT given is ' + l.vatAmount.toFixed(2) + '.');
    });
    var G = r.given, C = r.computed, names = { lineNet: 'sum of the line amounts', taxExclusive: 'total without VAT', tax: 'total VAT', taxInclusive: 'total with VAT', payable: 'amount due' };
    Object.keys(names).forEach(function (k) { if (G[k] !== null && isFinite(G[k]) && !near(G[k], C[k])) math.push('The ' + names[k] + ' in the file is ' + G[k].toFixed(2) + ', but the lines add up to ' + C[k].toFixed(2) + '.'); });
    var counts = { ok: 0, derived: 0, missing: 0, invalid: 0, na: 0 };
    fields.forEach(function (f) { counts[f.status]++; });
    var warnings = [];
    ['seller', 'buyer'].forEach(function (role) { r[role].id.warnings.forEach(function (w) { warnings.push((role === 'seller' ? 'Seller' : 'Buyer') + ': ' + w); }); });
    return { spec: SPEC, ready: counts.missing === 0 && counts.invalid === 0 && math.length === 0, fields: fields, math: math, warnings: warnings, counts: counts, normalized: r };
  }

  // ------------------------------------------------------------------ XML
  function x(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function amt(v) { return (isFinite(v) && v !== null ? v : 0).toFixed(2); }
  function pct(v) { return String(v === null || !isFinite(v) ? 0 : +v); }
  function partyXml(p, tag, ind) {
    var o = [ind + '<cac:' + tag + '>', ind + '  <cac:Party>'];
    if (p.tin) o.push(ind + '    <cbc:EndpointID schemeID="0235">' + x(p.tin) + '</cbc:EndpointID>');
    o.push(ind + '    <cac:PostalAddress>');
    if (p.street) o.push(ind + '      <cbc:StreetName>' + x(p.street) + '</cbc:StreetName>');
    if (p.city) o.push(ind + '      <cbc:CityName>' + x(p.city) + '</cbc:CityName>');
    if (p.emirate) o.push(ind + '      <cbc:CountrySubentity>' + x(p.emirate) + '</cbc:CountrySubentity>');
    o.push(ind + '      <cac:Country><cbc:IdentificationCode>' + x(p.country) + '</cbc:IdentificationCode></cac:Country>', ind + '    </cac:PostalAddress>');
    if (p.trn) o.push(ind + '    <cac:PartyTaxScheme>', ind + '      <cbc:CompanyID>' + x(p.trn) + '</cbc:CompanyID>', ind + '      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>', ind + '    </cac:PartyTaxScheme>');
    o.push(ind + '    <cac:PartyLegalEntity>', ind + '      <cbc:RegistrationName>' + x(p.name) + '</cbc:RegistrationName>');
    if (p.legalId) o.push(ind + '      <cbc:CompanyID' + (p.legalType ? ' schemeAgencyID="' + x(p.legalType) + '"' : '') + '>' + x(p.legalId) + '</cbc:CompanyID>');
    o.push(ind + '    </cac:PartyLegalEntity>', ind + '  </cac:Party>', ind + '</cac:' + tag + '>');
    return o.join('\n');
  }
  function toXml(input) {
    var r = normalize(input), c = r.currency, C = r.computed, cid = ' currencyID="' + x(c) + '"';
    var o = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- Built by Layerbit PINT-AE Readiness Checker as a starting point. Validate it with your Accredited Service Provider before use. -->',
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">',
      '  <cbc:CustomizationID>' + SPEC.customizationId + '</cbc:CustomizationID>',
      '  <cbc:ProfileID>' + SPEC.profileId + '</cbc:ProfileID>',
      '  <cbc:ProfileExecutionID>' + x(r.transactionType) + '</cbc:ProfileExecutionID>',
      '  <cbc:ID>' + x(r.invoiceNumber) + '</cbc:ID>',
      '  <cbc:IssueDate>' + x(r.issueDate === 'invalid' ? '' : r.issueDate) + '</cbc:IssueDate>'];
    if (r.dueDate && r.dueDate !== 'invalid') o.push('  <cbc:DueDate>' + x(r.dueDate) + '</cbc:DueDate>');
    o.push('  <cbc:InvoiceTypeCode>' + x(r.typeCode) + '</cbc:InvoiceTypeCode>', '  <cbc:DocumentCurrencyCode>' + x(c) + '</cbc:DocumentCurrencyCode>');
    if (c !== 'AED') o.push('  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>');
    if (r.buyerReference) o.push('  <cbc:BuyerReference>' + x(r.buyerReference) + '</cbc:BuyerReference>');
    o.push(partyXml(r.seller, 'AccountingSupplierParty', '  '), partyXml(r.buyer, 'AccountingCustomerParty', '  '));
    if (r.paymentMeansCode) o.push('  <cac:PaymentMeans>', '    <cbc:PaymentMeansCode>' + x(r.paymentMeansCode) + '</cbc:PaymentMeansCode>', '  </cac:PaymentMeans>');
    o.push('  <cac:TaxTotal>', '    <cbc:TaxAmount' + cid + '>' + amt(C.tax) + '</cbc:TaxAmount>');
    r.breakdown.forEach(function (g) {
      o.push('    <cac:TaxSubtotal>', '      <cbc:TaxableAmount' + cid + '>' + amt(g.taxable) + '</cbc:TaxableAmount>', '      <cbc:TaxAmount' + cid + '>' + amt(g.tax) + '</cbc:TaxAmount>',
        '      <cac:TaxCategory>', '        <cbc:ID>' + x(g.taxCategory) + '</cbc:ID>');
      if (g.taxPercent !== null) o.push('        <cbc:Percent>' + pct(g.taxPercent) + '</cbc:Percent>');
      o.push('        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>', '      </cac:TaxCategory>', '    </cac:TaxSubtotal>');
    });
    o.push('  </cac:TaxTotal>');
    // the VAT in AED is the sum of the lines' AED VAT, so the document agrees with its own lines
    if (c !== 'AED' && isFinite(r.exchangeRate) && r.exchangeRate) o.push('  <cac:TaxTotal>', '    <cbc:TaxAmount currencyID="AED">' + amt(round2(r.lines.reduce(function (s, l) { return s + (isFinite(l.vatAed) ? l.vatAed : 0); }, 0))) + '</cbc:TaxAmount>', '  </cac:TaxTotal>');
    o.push('  <cac:LegalMonetaryTotal>', '    <cbc:LineExtensionAmount' + cid + '>' + amt(C.lineNet) + '</cbc:LineExtensionAmount>', '    <cbc:TaxExclusiveAmount' + cid + '>' + amt(C.taxExclusive) + '</cbc:TaxExclusiveAmount>',
      '    <cbc:TaxInclusiveAmount' + cid + '>' + amt(C.taxInclusive) + '</cbc:TaxInclusiveAmount>', '    <cbc:PayableAmount' + cid + '>' + amt(C.payable) + '</cbc:PayableAmount>', '  </cac:LegalMonetaryTotal>');
    r.lines.forEach(function (l) {
      o.push('  <cac:InvoiceLine>', '    <cbc:ID>' + x(l.id) + '</cbc:ID>', '    <cbc:InvoicedQuantity unitCode="' + x(l.unitCode) + '">' + (isFinite(l.quantity) ? l.quantity : 0) + '</cbc:InvoicedQuantity>',
        '    <cbc:LineExtensionAmount' + cid + '>' + amt(l.netAmount) + '</cbc:LineExtensionAmount>',
        '    <cac:TaxTotal>', '      <cbc:TaxAmount currencyID="AED">' + amt(l.vatAed) + '</cbc:TaxAmount>', '    </cac:TaxTotal>',
        '    <cac:Item>');
      if (l.description) o.push('      <cbc:Description>' + x(l.description) + '</cbc:Description>');
      o.push('      <cbc:Name>' + x(l.name) + '</cbc:Name>', '      <cac:ClassifiedTaxCategory>', '        <cbc:ID>' + x(l.taxCategory) + '</cbc:ID>');
      if (l.taxPercent !== null) o.push('        <cbc:Percent>' + pct(l.taxPercent) + '</cbc:Percent>');
      o.push('        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>', '      </cac:ClassifiedTaxCategory>', '    </cac:Item>',
        '    <cac:Price>', '      <cbc:PriceAmount' + cid + '>' + amt(l.unitPrice) + '</cbc:PriceAmount>', '      <cbc:BaseQuantity unitCode="' + x(l.unitCode) + '">1</cbc:BaseQuantity>',
        '      <cac:AllowanceCharge>', '        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>', '        <cbc:Amount' + cid + '>0.00</cbc:Amount>', '        <cbc:BaseAmount' + cid + '>' + amt(l.unitPrice) + '</cbc:BaseAmount>', '      </cac:AllowanceCharge>',
        '    </cac:Price>', '    <cac:ItemPriceExtension>', '      <cbc:Amount currencyID="AED">' + amt(l.amountAed) + '</cbc:Amount>', '    </cac:ItemPriceExtension>', '  </cac:InvoiceLine>');
    });
    o.push('</Invoice>');
    return o.join('\n') + '\n';
  }

  // ------------------------------------------------------- read XML back
  var CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
  function kids(el, ns, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.namespaceURI === ns && c.localName === name) out.push(c); return out; }
  function path(el, steps) { var cur = [el]; steps.forEach(function (s) { var p = s.split(':'), ns = p[0] === 'cbc' ? CBC : CAC, n = []; cur.forEach(function (e) { n = n.concat(kids(e, ns, p[1])); }); cur = n; }); return cur; }
  function text(el, steps) { var e = path(el, steps)[0]; return e ? e.textContent.trim() : ''; }
  function fromXml(doc) {
    var root = doc && doc.documentElement, perr = doc && doc.getElementsByTagName('parsererror')[0];
    // browsers report a parse error as a <parsererror> element, at the root or inside it
    if (perr) throw new Error('The XML is not well-formed: ' + perr.textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
    if (!root || root.localName !== 'Invoice') throw new Error('Expected a UBL <Invoice> document; found <' + (root ? root.localName : 'nothing') + '>.' + (root && root.localName === 'CreditNote' ? ' Credit notes are not checked yet.' : ''));
    if (root.namespaceURI !== 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2') throw new Error('The <Invoice> element is not in the UBL 2.1 Invoice namespace (urn:oasis:names:specification:ubl:schema:xsd:Invoice-2), so it is not a UBL invoice.');
    var partyOf = function (tag) {
      var p = path(root, ['cac:' + tag, 'cac:Party'])[0];
      if (!p) return {};
      var vatCo = path(p, ['cac:PartyTaxScheme']).filter(function (t) { return text(t, ['cac:TaxScheme', 'cbc:ID']) === 'VAT'; })[0];
      var legal = path(p, ['cac:PartyLegalEntity', 'cbc:CompanyID'])[0];
      return { name: text(p, ['cac:PartyLegalEntity', 'cbc:RegistrationName']), trn: vatCo ? text(vatCo, ['cbc:CompanyID']) : '', tin: text(p, ['cbc:EndpointID']), legalId: legal ? legal.textContent.trim() : '', legalType: legal ? legal.getAttribute('schemeAgencyID') || '' : '',
        street: text(p, ['cac:PostalAddress', 'cbc:StreetName']), city: text(p, ['cac:PostalAddress', 'cbc:CityName']), emirate: text(p, ['cac:PostalAddress', 'cbc:CountrySubentity']), country: text(p, ['cac:PostalAddress', 'cac:Country', 'cbc:IdentificationCode']) };
    };
    var spec = { customizationId: text(root, ['cbc:CustomizationID']), profileId: text(root, ['cbc:ProfileID']) };
    var input = {
      invoiceNumber: text(root, ['cbc:ID']), issueDate: text(root, ['cbc:IssueDate']), dueDate: text(root, ['cbc:DueDate']) || text(root, ['cac:PaymentMeans', 'cbc:PaymentDueDate']),
      typeCode: text(root, ['cbc:InvoiceTypeCode']), currencyCode: text(root, ['cbc:DocumentCurrencyCode']), transactionType: text(root, ['cbc:ProfileExecutionID']),
      paymentMeansCode: text(root, ['cac:PaymentMeans', 'cbc:PaymentMeansCode']), buyerReference: text(root, ['cbc:BuyerReference']),
      seller: partyOf('AccountingSupplierParty'), buyer: partyOf('AccountingCustomerParty'),
      lines: path(root, ['cac:InvoiceLine']).map(function (l) {
        var q = path(l, ['cbc:InvoicedQuantity'])[0];
        return { id: text(l, ['cbc:ID']), quantity: q ? q.textContent.trim() : '', unitCode: q ? q.getAttribute('unitCode') || '' : '', netAmount: text(l, ['cbc:LineExtensionAmount']), unitPrice: text(l, ['cac:Price', 'cbc:PriceAmount']),
          name: text(l, ['cac:Item', 'cbc:Name']), description: text(l, ['cac:Item', 'cbc:Description']), taxCategory: text(l, ['cac:Item', 'cac:ClassifiedTaxCategory', 'cbc:ID']), taxPercent: text(l, ['cac:Item', 'cac:ClassifiedTaxCategory', 'cbc:Percent']) };
      }),
      totals: { lineNet: text(root, ['cac:LegalMonetaryTotal', 'cbc:LineExtensionAmount']), taxExclusive: text(root, ['cac:LegalMonetaryTotal', 'cbc:TaxExclusiveAmount']), taxInclusive: text(root, ['cac:LegalMonetaryTotal', 'cbc:TaxInclusiveAmount']), payable: text(root, ['cac:LegalMonetaryTotal', 'cbc:PayableAmount']),
        tax: (path(root, ['cac:TaxTotal']).filter(function (t) { var a = path(t, ['cbc:TaxAmount'])[0]; return a && a.getAttribute('currencyID') === text(root, ['cbc:DocumentCurrencyCode']); })[0] || null) ? text(path(root, ['cac:TaxTotal']).filter(function (t) { var a = path(t, ['cbc:TaxAmount'])[0]; return a && a.getAttribute('currencyID') === text(root, ['cbc:DocumentCurrencyCode']); })[0], ['cbc:TaxAmount']) : '' }
    };
    var aedLine = path(root, ['cac:InvoiceLine'])[0];
    if (input.currencyCode && input.currencyCode !== 'AED' && aedLine) { var a = parseFloat(text(aedLine, ['cac:ItemPriceExtension', 'cbc:Amount'])), n = parseFloat(text(aedLine, ['cbc:LineExtensionAmount'])); if (a && n) input.exchangeRate = a / n; }
    input.declared = spec;
    return input;
  }

  return { SPEC: SPEC, EMIRATES: EMIRATES, LEGAL_TYPES: LEGAL_TYPES, FLAGS: FLAGS, CODES: CODES, taxId: taxId, tinCheckDigit: tinCheckDigit, normalize: normalize, check: check, toXml: toXml, fromXml: fromXml, isoDate: isoDate, round2: round2 };
});
