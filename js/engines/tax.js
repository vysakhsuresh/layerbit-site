/* Layerbit VAT and GST engine (UMD: window.LBTax / module.exports).
   Adds or removes a percentage tax with exact integer arithmetic in the
   currency's minor unit (fils, halalas, baisa, paise), splits Indian GST
   into CGST and SGST/UTGST or IGST, formats amounts with Indian or
   international digit grouping, and writes amounts in words for invoices.
   Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBTax = factory();
})(this, function () {
  'use strict';
  // Rates are held as integers in millionths: 100% = 1,000,000, so 5% is
  // 50,000 and 0.25% is 2,500. Amounts are BigInt counts of minor units.
  var SCALE = 1000000n;

  var CURRENCIES = {
    AED: { code: 'AED', decimals: 2, major: 'UAE Dirhams', majorOne: 'UAE Dirham', minor: 'Fils', minorOne: 'Fils', system: 'intl' },
    SAR: { code: 'SAR', decimals: 2, major: 'Saudi Riyals', majorOne: 'Saudi Riyal', minor: 'Halalas', minorOne: 'Halala', system: 'intl' },
    OMR: { code: 'OMR', decimals: 3, major: 'Omani Rials', majorOne: 'Omani Rial', minor: 'Baisa', minorOne: 'Baisa', system: 'intl' },
    BHD: { code: 'BHD', decimals: 3, major: 'Bahraini Dinars', majorOne: 'Bahraini Dinar', minor: 'Fils', minorOne: 'Fils', system: 'intl' },
    INR: { code: 'INR', decimals: 2, major: 'Rupees', majorOne: 'Rupee', minor: 'Paise', minorOne: 'Paisa', system: 'indian' },
    USD: { code: 'USD', decimals: 2, major: 'US Dollars', majorOne: 'US Dollar', minor: 'Cents', minorOne: 'Cent', system: 'intl' },
    EUR: { code: 'EUR', decimals: 2, major: 'Euros', majorOne: 'Euro', minor: 'Cents', minorOne: 'Cent', system: 'intl' },
    GBP: { code: 'GBP', decimals: 2, major: 'Pounds', majorOne: 'Pound', minor: 'Pence', minorOne: 'Penny', system: 'intl' }
  };

  // kind 'gst' presets get the CGST/SGST or IGST split.
  var PRESETS = [
    { id: 'ae-5', group: 'Gulf VAT', label: 'UAE VAT 5%', rate: '5', currency: 'AED', kind: 'vat' },
    { id: 'sa-15', group: 'Gulf VAT', label: 'Saudi Arabia VAT 15%', rate: '15', currency: 'SAR', kind: 'vat' },
    { id: 'bh-10', group: 'Gulf VAT', label: 'Bahrain VAT 10%', rate: '10', currency: 'BHD', kind: 'vat' },
    { id: 'om-5', group: 'Gulf VAT', label: 'Oman VAT 5%', rate: '5', currency: 'OMR', kind: 'vat' },
    { id: 'in-5', group: 'India GST', label: 'India GST 5%', rate: '5', currency: 'INR', kind: 'gst' },
    { id: 'in-18', group: 'India GST', label: 'India GST 18%', rate: '18', currency: 'INR', kind: 'gst' },
    { id: 'in-40', group: 'India GST', label: 'India GST 40%', rate: '40', currency: 'INR', kind: 'gst' },
    { id: 'in-3', group: 'India GST', label: 'India GST 3% (gold, silver, jewellery)', rate: '3', currency: 'INR', kind: 'gst' },
    { id: 'in-0.25', group: 'India GST', label: 'India GST 0.25% (rough diamonds)', rate: '0.25', currency: 'INR', kind: 'gst' },
    { id: 'in-12', group: 'India GST', label: 'India GST 12% (rate before 22 Sep 2025)', rate: '12', currency: 'INR', kind: 'gst' },
    { id: 'in-28', group: 'India GST', label: 'India GST 28% (rate before 22 Sep 2025)', rate: '28', currency: 'INR', kind: 'gst' }
  ];

  function abs(n) { return n < 0n ? -n : n; }
  /** n / d rounded half away from zero (d > 0). */
  function divRound(n, d) {
    var neg = n < 0n, a = abs(n), q = a / d, r = a % d;
    if (r * 2n >= d) q += 1n;
    return neg ? -q : q;
  }

  /** Parses "1,050.5", "AED 1 050", "₹1,23,456.78" or "-200" into minor
   *  units for `decimals` places. Throws on anything else. */
  function parseAmount(s, decimals) {
    var t = String(s == null ? '' : s).trim().replace(/^(aed|sar|omr|bhd|inr|usd|eur|gbp|rs\.?|dhs?\.?)\s*/i, '').replace(/[₹$€£\s,']/g, '');
    if (!t) throw new Error('Enter an amount.');
    var m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
    if (!m || (!m[2] && !m[3])) throw new Error('"' + String(s).trim() + '" is not a number.');
    var frac = m[3] || '';
    if (frac.length > decimals) {
      if (/[^0]/.test(frac.slice(decimals))) throw new Error('This currency has ' + decimals + ' decimal places.');
      frac = frac.slice(0, decimals);
    }
    while (frac.length < decimals) frac += '0';
    var v = BigInt((m[2] || '0') + frac);
    if (v > 10n ** 18n) throw new Error('That amount is too large.');
    return m[1] === '-' ? -v : v;
  }

  /** "5", "18%", "0.25" -> rate in millionths (50000, 180000, 2500). */
  function parseRate(s) {
    var t = String(s == null ? '' : s).trim().replace(/%$/, '').trim();
    var m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(t);
    if (!m) throw new Error('Enter a tax rate such as 5 or 18.');
    var v = BigInt(m[1]) * 10000n + BigInt(((m[2] || '') + '0000').slice(0, 4));
    if (v > SCALE) throw new Error('The rate cannot be more than 100%.');
    return v;
  }
  function rateText(r) {
    var whole = r / 10000n, frac = String(r % 10000n).padStart(4, '0').replace(/0+$/, '');
    return whole + (frac ? '.' + frac : '') + '%';
  }

  /** Tax on a net amount; the total is net + tax. */
  function addTax(net, rate, opts) {
    var tax = roundTo(divRound(net * rate, SCALE), opts);
    return { net: net, tax: tax, gross: net + tax };
  }
  /** Splits a tax-inclusive amount; net + tax always equals the gross. */
  function removeTax(gross, rate, opts) {
    var net = divRound(gross * SCALE, SCALE + rate), tax = gross - net;
    var r = roundTo(tax, opts);
    if (r !== tax) { tax = r; net = gross - tax; }
    return { net: net, tax: tax, gross: gross };
  }
  // opts.wholeUnits rounds the tax to whole major units (10^decimals minor).
  function roundTo(tax, opts) {
    if (!opts || !opts.wholeUnits) return tax;
    var unit = 10n ** BigInt(opts.decimals || 2);
    return divRound(tax, unit) * unit;
  }

  /** India GST components for a total tax already worked out.
   *  supply: 'intra' (CGST + SGST), 'ut' (CGST + UTGST) or 'inter' (IGST).
   *  The two halves differ by one paisa when the tax is odd; CGST takes it. */
  function gstSplit(tax, rate, supply) {
    if (supply === 'inter') return [{ name: 'IGST', rate: rate, amount: tax }];
    var half = rate / 2n, second = tax / 2n, first = tax - second;
    return [{ name: 'CGST', rate: half, amount: first }, { name: supply === 'ut' ? 'UTGST' : 'SGST', rate: rate - half, amount: second }];
  }

  /** Formats minor units: "1,050.00" (intl) or "1,23,456.78" (indian). */
  function format(minor, decimals, system) {
    var neg = minor < 0n, a = abs(minor), d = BigInt(decimals);
    var unit = 10n ** d, whole = (a / unit).toString(), frac = (a % unit).toString().padStart(decimals, '0');
    var g;
    if (system === 'indian' && whole.length > 3) {
      var head = whole.slice(0, -3), tail = whole.slice(-3);
      g = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
    } else g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + g + (decimals ? '.' + frac : '');
  }

  var ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function under1000(n) {
    var out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
    if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
    else if (n > 0) out.push(ONES[n]);
    return out.join(' ');
  }
  /** Whole number in words, Indian (lakh, crore) or international. */
  function numberWords(n, system) {
    n = BigInt(n);
    if (n === 0n) return 'Zero';
    var parts = [];
    if (system === 'indian') {
      var crore = n / 10000000n; n %= 10000000n;
      if (crore) parts.push(numberWords(crore, 'indian') + ' Crore');
      var lakh = Number(n / 100000n); n %= 100000n;
      if (lakh) parts.push(under1000(lakh) + ' Lakh');
      var th = Number(n / 1000n); n %= 1000n;
      if (th) parts.push(under1000(th) + ' Thousand');
      if (n) parts.push(under1000(Number(n)));
    } else {
      var scales = [[10n ** 15n, 'Quadrillion'], [10n ** 12n, 'Trillion'], [10n ** 9n, 'Billion'], [10n ** 6n, 'Million'], [1000n, 'Thousand']];
      scales.forEach(function (s) { var q = n / s[0]; if (q) { parts.push(numberWords(q, 'intl') + ' ' + s[1]); n %= s[0]; } });
      if (n) parts.push(under1000(Number(n)));
    }
    return parts.join(' ');
  }
  /** "Rupees One Lakh Twenty-Three Thousand ... and Seventy-Eight Paise Only". */
  function amountWords(minor, cur) {
    var c = CURRENCIES[cur] || CURRENCIES.AED, unit = 10n ** BigInt(c.decimals);
    var a = abs(minor), major = a / unit, rest = a % unit;
    var s = (minor < 0n ? 'Minus ' : '') + (major === 1n ? c.majorOne : c.major) + ' ' + numberWords(major, c.system);
    if (rest) s += ' and ' + numberWords(rest, c.system) + ' ' + (rest === 1n ? c.minorOne : c.minor);
    return s + ' Only';
  }

  /** Share of a tax-inclusive price that is tax, as a fraction string:
   *  5% -> "1/21", 15% -> "3/23", 18% -> "9/59". */
  function inclusiveFraction(rate) {
    var n = rate, d = SCALE + rate, a = n, b = d;
    while (b) { var t = a % b; a = b; b = t; }
    return (n / a) + '/' + (d / a);
  }

  /** One-call calculation for the page. */
  function calc(o) {
    var c = CURRENCIES[o.currency] || CURRENCIES.AED;
    var amt = parseAmount(o.amount, c.decimals), rate = parseRate(o.rate);
    var opts = { wholeUnits: !!o.wholeUnits, decimals: c.decimals };
    var r = o.mode === 'remove' ? removeTax(amt, rate, opts) : addTax(amt, rate, opts);
    r.rate = rate; r.currency = c.code; r.decimals = c.decimals; r.system = c.system;
    r.split = o.kind === 'gst' ? gstSplit(r.tax, rate, o.supply || 'intra') : null;
    // GST within a state or Union Territory: CGST and SGST/UTGST are each
    // charged on the taxable value at half the rate and rounded on their
    // own, so the two are always equal and the tax is their sum. That sum
    // can differ by a paisa from rate x value; the note says so.
    var supply = o.supply || 'intra';
    if (o.kind === 'gst' && supply !== 'inter' && !opts.wholeUnits) {
      var halfA = rate / 2n, halfB = rate - halfA;
      var a = divRound(r.net * halfA, SCALE), b = divRound(r.net * halfB, SCALE), whole = divRound(r.net * rate, SCALE);
      r.split = [{ name: 'CGST', rate: halfA, amount: a }, { name: supply === 'ut' ? 'UTGST' : 'SGST', rate: halfB, amount: b }];
      var entered = r.gross;
      r.tax = a + b; r.gross = r.net + r.tax;
      var parts = [];
      if (r.tax !== whole) parts.push('CGST and ' + r.split[1].name + ' are each worked out on the taxable value, so together they are ' + format(r.tax, c.decimals, c.system) + ', ' + format(abs(r.tax - whole), c.decimals, c.system) + ' ' + (r.tax < whole ? 'less' : 'more') + ' than ' + rateText(rate) + ' of the value (' + format(whole, c.decimals, c.system) + ').');
      if (o.mode === 'remove' && r.gross !== entered) parts.push('Taxable value plus both halves comes to ' + format(r.gross, c.decimals, c.system) + ', ' + format(abs(r.gross - entered), c.decimals, c.system) + ' ' + (r.gross < entered ? 'less' : 'more') + ' than the price entered.');
      if (parts.length) r.note = parts.join(' ');
    }
    return r;
  }

  return {
    CURRENCIES: CURRENCIES, PRESETS: PRESETS, parseAmount: parseAmount, parseRate: parseRate, rateText: rateText,
    addTax: addTax, removeTax: removeTax, gstSplit: gstSplit, format: format, numberWords: numberWords,
    amountWords: amountWords, inclusiveFraction: inclusiveFraction, calc: calc
  };
});
