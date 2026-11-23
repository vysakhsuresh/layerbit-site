// Node unit tests for js/engines/jsonx.js: JSON5 / JSONC reading, XML <->
// JSON, sample documents from a schema, the graph layout and the
// structural compare used by the JSON Formatter.
// Run: node scripts/unit/jsonx.test.js
const assert = require('assert');
let X, L;
let n = 0, failed = 0;
function t(name, fn) {
  try { if (!X) { X = require('../../js/engines/jsonx.js'); L = require('../../js/engines/lossless-json.js'); } fn(); n++; }
  catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
}
const plain = v => JSON.parse(L.stringify(v));

t('JSON5: comments, unquoted keys, single quotes, trailing commas, hex, signs, .5, line continuation', () => {
  const r = X.parseDialect(`// config
{
  name: 'Ada', "id": 0x1F, /* block */ big: 12345678901234567890,
  ratio: .5, whole: 5., neg: -0x10, pos: +3,
  text: 'line one \\
line two',
  list: [1, 2, 3,],
}`, 'json5');
  assert.deepStrictEqual(plain(r.value), { name: 'Ada', id: 31, big: 12345678901234567890, ratio: 0.5, whole: 5, neg: -16, pos: 3, text: 'line one line two', list: [1, 2, 3] });
  assert.strictEqual(r.value.big.value, '12345678901234567890');
});
t('JSON5: Infinity and NaN have no JSON form: null, with a note naming the path', () => {
  const r = X.parseDialect('{a: Infinity, b: [-Infinity, NaN]}', 'json5');
  assert.deepStrictEqual(plain(r.value), { a: null, b: [null, null] });
  assert.ok(r.notes.some(s => /Infinity/.test(s) && /\$\.a/.test(s)), r.notes.join(' | '));
});
t('JSON5: errors give line and column', () => {
  assert.throws(() => X.parseDialect('{\n  a: 1\n  b: 2\n}', 'json5'), e => /line 3, column 3/.test(e.message));
  assert.throws(() => X.parseDialect("{a: 'x}", 'json5'), /unterminated|end of input/i);
});
t('JSONC: comments and trailing commas only; JSON5 features are refused', () => {
  assert.deepStrictEqual(plain(X.parseDialect('{"a": 1, // one\n "b": [2,], /* x */}', 'jsonc').value), { a: 1, b: [2] });
  assert.throws(() => X.parseDialect("{a: 1}", 'jsonc'), /JSONC/);
  assert.throws(() => X.parseDialect("{'a': 1}", 'jsonc'), /JSONC/);
});
t('dialect: strings keep // and /* inside them', () => {
  assert.deepStrictEqual(plain(X.parseDialect('{"url": "http://x/*y*/"}', 'jsonc').value), { url: 'http://x/*y*/' });
});

t('XML -> JSON: attributes, repeated elements, text, CDATA, entities, namespaces', () => {
  const v = X.xmlToJson(`<?xml version="1.0"?>
<!-- catalog -->
<catalog xmlns:x="urn:x" version="2">
  <book id="b1"><title>XML &amp; JSON</title><price cur="EUR">9.50</price></book>
  <book id="b2"><title><![CDATA[<raw> & co]]></title></book>
  <x:note>hi</x:note>
  <empty/>
</catalog>`);
  assert.deepStrictEqual(v, { catalog: { '@xmlns:x': 'urn:x', '@version': '2', book: [
    { '@id': 'b1', title: 'XML & JSON', price: { '@cur': 'EUR', '#text': '9.50' } },
    { '@id': 'b2', title: '<raw> & co' }], 'x:note': 'hi', empty: '' } });
});
t('XML -> JSON: malformed XML reports line and column', () => {
  assert.throws(() => X.xmlToJson('<a>\n  <b></a>'), /line 2/);
  assert.throws(() => X.xmlToJson('<a>'), /not closed|end of input/i);
});
t('JSON -> XML: attributes, arrays repeat, names made valid, text escaped; round trip', () => {
  const xml = X.jsonToXml({ order: { '@id': '7', item: [{ sku: 'A&B', qty: 2 }, { sku: '<C>', qty: 1 }], 'bad name': 'x', '1st': true, note: null } });
  assert.ok(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<order id="7">/.test(xml), xml);
  assert.ok(xml.includes('<sku>A&amp;B</sku>') && xml.includes('<sku>&lt;C&gt;</sku>') && xml.includes('<bad_name>x</bad_name>') && xml.includes('<_1st>true</_1st>') && xml.includes('<note/>'), xml);
  const back = X.xmlToJson(xml);
  assert.deepStrictEqual(back.order.item, [{ sku: 'A&B', qty: '2' }, { sku: '<C>', qty: '1' }]);
  assert.ok(/^<\?xml[^>]*>\n<root>/.test(X.jsonToXml([1, 2])), 'an array gets a root element');
});

t('sample from schema: types, required, enum, const, default, formats, ranges, $ref, allOf, oneOf', () => {
  const s = {
    $defs: { addr: { type: 'object', properties: { city: { type: 'string', examples: ['Dubai'] } }, required: ['city'] } },
    type: 'object', required: ['id', 'email', 'status', 'when', 'tags', 'home', 'qty'],
    properties: {
      id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' },
      status: { enum: ['active', 'closed'] }, kind: { const: 'user' }, when: { type: 'string', format: 'date-time' },
      qty: { type: 'integer', minimum: 5, maximum: 9 }, score: { type: 'number', default: 0.5 },
      tags: { type: 'array', items: { type: 'string' }, minItems: 2 }, home: { $ref: '#/$defs/addr' },
      both: { allOf: [{ properties: { a: { type: 'integer' } } }, { properties: { b: { type: 'boolean' } } }] },
      pick: { oneOf: [{ type: 'null' }, { type: 'string' }] }, short: { type: 'string', minLength: 3, maxLength: 4 }
    }
  };
  const v = X.sampleFromSchema(s);
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.id), v.id);
  assert.ok(/^[^@]+@[^@]+\.[a-z]+$/.test(v.email));
  assert.strictEqual(v.status, 'active'); assert.strictEqual(v.kind, 'user');
  assert.ok(!isNaN(Date.parse(v.when)));
  assert.ok(Number.isInteger(v.qty) && v.qty >= 5 && v.qty <= 9);
  assert.strictEqual(v.score, 0.5);
  assert.strictEqual(v.tags.length, 2);
  assert.deepStrictEqual(v.home, { city: 'Dubai' });
  assert.deepStrictEqual(v.both, { a: 0, b: false });
  assert.strictEqual(v.pick, null);
  assert.ok(v.short.length >= 3 && v.short.length <= 4, v.short);
});
t('sample from schema: a recursive $ref stops instead of looping', () => {
  const v = X.sampleFromSchema({ $ref: '#/$defs/node', $defs: { node: { type: 'object', required: ['next'], properties: { next: { $ref: '#/$defs/node' } } } } });
  let d = 0, cur = v; while (cur && typeof cur === 'object' && cur.next !== undefined) { cur = cur.next; d++; }
  assert.ok(d > 0 && d < 10, 'depth ' + d);
});

t('graph: one node per object/array, primitives as fields, edges labelled, laid out left to right', () => {
  const g = X.graph({ id: 1, user: { name: 'Ada', tags: ['a', 'b'] }, items: [{ sku: 'x' }, { sku: 'y' }] });
  assert.strictEqual(g.nodes.length, 6);
  const root = g.nodes[0];
  assert.deepStrictEqual(root.fields.map(f => f.key + '=' + f.text), ['id=1']);
  assert.deepStrictEqual(g.edges.map(e => e.label).sort(), ['0', '1', 'items', 'tags', 'user']);
  const user = g.nodes.find(nd => nd.path === '$.user');
  assert.ok(user.x > root.x, 'children to the right');
  assert.deepStrictEqual(user.fields.map(f => f.path), ['$.user.name']);
  assert.ok(!g.nodes.some((a, i) => g.nodes.some((b, j) => i < j && a.x === b.x && a.y < b.y + b.h && b.y < a.y + a.h)), 'no overlapping nodes');
});
t('graph: big documents are capped with a count of what was left out', () => {
  const big = { list: Array.from({ length: 5000 }, (_, i) => ({ i })) };
  const g = X.graph(big, { maxNodes: 300 });
  assert.ok(g.nodes.length <= 300 && g.truncated > 0, g.nodes.length + ' / ' + g.truncated);
});

t('compare: added, removed and changed paths; numbers compared exactly', () => {
  const a = L.parse('{"id": 12345678901234567890, "name": "Ada", "tags": ["a"], "gone": 1}');
  const b = L.parse('{"id": 12345678901234567891, "name": "Ada", "tags": ["a", "b"], "new": {"x": 1}}');
  const d = X.compare(a, b);
  assert.deepStrictEqual(d.map(x => x.kind + ' ' + x.path), ['changed $.id', 'added $.tags[1]', 'removed $.gone', 'added $.new']);
  assert.strictEqual(X.compare(L.parse('{"a": 1.0}'), L.parse('{"a": 1}')).length, 0, '1.0 and 1 are the same number');
});

t('findTables: arrays of objects anywhere, largest first', () => {
  const r = X.findTables({ meta: { n: 1 }, data: { rows: [{ a: 1 }, { a: 2 }, { a: 3 }] }, other: [{ b: 1 }] });
  assert.deepStrictEqual(r.map(x => x.path + ':' + x.count), ['$.data.rows:3', '$.other:1']);
  assert.deepStrictEqual(X.findTables([{ a: 1 }]).map(x => x.path), ['$']);
});

console.log(`${n} passed, ${failed} failed`);
