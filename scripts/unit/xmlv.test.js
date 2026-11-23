// Node unit tests for js/engines/xmlv.js: the XML tree reader and the DTD
// validator used by the XML Formatter. Run: node scripts/unit/xmlv.test.js
const assert = require('assert');
let V;
let n = 0, failed = 0;
function t(name, fn) { try { if (!V) V = require('../../js/engines/xmlv.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
const msgs = r => r.map(e => e.line + ': ' + e.message);

t('tree: elements, attributes, text and line numbers; DOCTYPE internal subset kept', () => {
  const d = V.parseTree('<?xml version="1.0"?>\n<!DOCTYPE note [\n<!ELEMENT note (to)>\n]>\n<note a="1">\n  <to>Ada &amp; co</to>\n</note>');
  assert.strictEqual(d.doctype.name, 'note');
  assert.ok(/ELEMENT note/.test(d.doctype.subset));
  assert.strictEqual(d.root.name, 'note'); assert.strictEqual(d.root.line, 5);
  assert.deepStrictEqual(d.root.attrs, { a: '1' });
  assert.strictEqual(d.root.children[0].name, 'to'); assert.strictEqual(d.root.children[0].line, 6);
  assert.strictEqual(d.root.children[0].text, 'Ada & co');
});

const DTD = `<!-- order DTD -->
<!ENTITY % code "CDATA">
<!ELEMENT order (customer, item+, note?)>
<!ATTLIST order id ID #REQUIRED status (new|paid|shipped) "new" version CDATA #FIXED "2">
<!ELEMENT customer (#PCDATA)>
<!ELEMENT item EMPTY>
<!ATTLIST item sku %code; #REQUIRED ref IDREF #IMPLIED>
<!ELEMENT note (#PCDATA | b | i)*>
<!ELEMENT b (#PCDATA)>
<!ELEMENT i (#PCDATA)>`;
t('DTD: a valid document passes', () => {
  const r = V.validateDtd('<order id="o1" version="2"><customer>Ada</customer><item sku="A"/><item sku="B" ref="o1"/><note>hi <b>there</b></note></order>', DTD);
  assert.deepStrictEqual(r, []);
});
t('DTD: content model, required, fixed, enumeration, undeclared, ID and IDREF errors', () => {
  const doc = `<order id="o1" status="lost" version="3">
  <item sku="A"/>
  <customer>Ada</customer>
  <item ref="nope" colour="red"/>
  <extra/>
</order>`;
  const r = msgs(V.validateDtd(doc, DTD));
  const want = [
    ['1:', 'status', '<order>', '"lost"', 'new, paid, shipped'],
    ['1:', 'version', '<order>', 'fixed', '"2"'],
    ['1:', '<order>', 'item, customer, item, extra'],
    ['4:', '<item>', 'required attribute sku'],
    ['4:', 'colour', '<item>', 'not declared'],
    ['4:', 'IDREF', '"nope"'],
    ['5:', '<extra>', 'not declared']
  ];
  want.forEach(parts => assert.ok(r.some(m => m.startsWith(parts[0]) && parts.every(p => m.includes(p))), 'missing ' + parts.join(' … ') + '\n' + r.join('\n')));
});
t('DTD: EMPTY with content, text in element-only content, duplicate IDs, wrong root', () => {
  const r = msgs(V.validateDtd('<!DOCTYPE order>\n<order id="x"><customer>a</customer>stray<item sku="A">text</item><note/></order>', DTD + '<!ATTLIST note id ID #IMPLIED>'));
  assert.ok(r.some(m => /item.*EMPTY/.test(m)), r.join('\n'));
  assert.ok(r.some(m => /order.*text/.test(m)), r.join('\n'));
  const dup = msgs(V.validateDtd('<order id="x"><customer>a</customer><item sku="A"/><note id="x"/></order>', DTD + '<!ATTLIST note id ID #IMPLIED>'));
  assert.ok(dup.some(m => /ID "x".*more than once/.test(m)), dup.join('\n'));
  const root = msgs(V.validateDtd('<!DOCTYPE order>\n<customer>a</customer>', DTD));
  assert.ok(root.some(m => /root.*customer.*order/.test(m)), root.join('\n'));
});
t('DTD: the internal subset is used when no DTD is given; a broken DTD is reported', () => {
  const doc = '<!DOCTYPE a [\n<!ELEMENT a (b)>\n<!ELEMENT b (#PCDATA)>\n]>\n<a><c/></a>';
  const r = msgs(V.validateDtd(doc, ''));
  assert.ok(r.some(m => m.startsWith('5:') && m.includes('content of <a>')) && r.some(m => m.includes('<c> is not declared')), r.join('\n'));
  assert.throws(() => V.validateDtd('<a/>', '<!ELEMENT a (b'), /DTD/);
  assert.throws(() => V.validateDtd('<a/>', ''), /no DTD/i);
});
t('DTD: choice and nesting in content models', () => {
  const d = '<!ELEMENT r ((a | b), (c, d)*, e?)><!ELEMENT a EMPTY><!ELEMENT b EMPTY><!ELEMENT c EMPTY><!ELEMENT d EMPTY><!ELEMENT e EMPTY>';
  assert.deepStrictEqual(V.validateDtd('<r><b/><c/><d/><c/><d/><e/></r>', d), []);
  assert.strictEqual(V.validateDtd('<r><a/><b/></r>', d).length, 1);
  assert.strictEqual(V.validateDtd('<r><a/><c/></r>', d).length, 1);
});

console.log(`${n} passed, ${failed} failed`);
