// Node unit tests for js/engines/json.js. Run: node scripts/unit/json.test.js
const J = require('../../js/engines/json.js');
const assert = require('assert');
let n = 0; function t(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL', name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n')); process.exitCode = 1; } }

t('locateError gives line/col', () => {
  const raw = '{\n  "a": 1,\n  "b": [1, 2,]\n}'; let msg; try { JSON.parse(raw); } catch (e) { msg = e.message; }
  const r = J.locateError(msg, raw); assert.strictEqual(r.line, 3); assert.ok(r.col >= 12, r.col);
});
t('repair fixes the usual almost-JSON', () => {
  const r = J.repair("﻿// cfg\n{ name: 'x', 'b': \"q\", list: [1, 2,], n: NaN, ok: True, /* c */ “smart”: 'it\\'s' }");
  const v = JSON.parse(r.text);
  assert.deepStrictEqual(v, { name: 'x', b: 'q', list: [1, 2], n: null, ok: true, smart: "it's" });
  assert.ok(r.fixes.length >= 5, r.fixes.join(';'));
  assert.deepStrictEqual(JSON.parse(J.repair('{"a": 1\n "b": 2}').text), { a: 1, b: 2 });
  assert.deepStrictEqual(JSON.parse(J.repair('{"a": 1, /* c */\n}').text), { a: 1 });
  assert.strictEqual(J.repair('{"url": "http://x/y", "s": "a, b"}').text, '{"url": "http://x/y", "s": "a, b"}');
  assert.deepStrictEqual(JSON.parse(J.repair("{ \u201cnote\u201d: \u2018it\u2019s fine\u2019, 'k': 'don't stop' }").text), { note: "it\u2019s fine", k: "don't stop" });
});
t('query JSONPath subset', () => {
  const d = { users: [{ id: 1, name: 'a', tags: ['x', 'y'] }, { id: 2, name: 'b' }, { id: 3, name: 'c', vip: true }], meta: { 'a b': true } };
  const q = (p) => J.query(d, p).map(x => x.value);
  assert.deepStrictEqual(q('$.users[0].tags[1]'), ['y']);
  assert.deepStrictEqual(q('users.length'), [3]);
  assert.deepStrictEqual(q('meta["a b"]'), [true]);
  assert.deepStrictEqual(q('$.users[*].name'), ['a', 'b', 'c']);
  assert.deepStrictEqual(q('$..id'), [1, 2, 3]);
  assert.deepStrictEqual(q('$.users[-1].id'), [3]);
  assert.deepStrictEqual(q('$.users[0:2].id'), [1, 2]);
  assert.deepStrictEqual(q('$.users[?(@.id > 1 && @.name != "c")].id'), [2]);
  assert.deepStrictEqual(q('$.users[?(@.vip)].name'), ['c']);
  assert.deepStrictEqual(q("$.users[?(@.name =~ /^[ab]$/)].id"), [1, 2]);
  assert.deepStrictEqual(q('$.users[5].id'), []);
  assert.deepStrictEqual(J.query(d, '$.users[0]')[0].path, '$.users[0]');
  assert.throws(() => J.query(d, '$.users[?(@.id >)]'));
});
t('validate draft-07 subset', () => {
  const schema = { $defs: { addr: { type: 'object', properties: { city: { type: 'string', minLength: 2 } }, required: ['city'] } }, type: 'object', properties: { id: { type: 'integer', minimum: 1 }, email: { type: 'string', format: 'email' }, role: { enum: ['admin', 'user'] }, tags: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 3 }, addr: { $ref: '#/$defs/addr' }, score: { type: ['number', 'null'] } }, required: ['id', 'email'], additionalProperties: false };
  assert.deepStrictEqual(J.validate(schema, { id: 1, email: 'a@b.co', role: 'admin', tags: ['x'], addr: { city: 'Dubai' }, score: null }), []);
  const errs = J.validate(schema, { id: 0.5, email: 'nope', role: 'root', tags: ['x', 'x', 'y', 'z'], addr: { city: 'D' }, extra: 1 });
  const kw = errs.map(e => e.keyword).sort();
  assert.deepStrictEqual(kw, ['additionalProperties', 'enum', 'format', 'maxItems', 'minLength', 'minimum', 'type', 'uniqueItems'], JSON.stringify(errs));
  assert.strictEqual(J.validate({ oneOf: [{ type: 'string' }, { type: 'number' }] }, 1).length, 0);
  assert.strictEqual(J.validate({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1).length, 1);
  assert.strictEqual(J.validate({ if: { properties: { a: { const: 1 } } }, then: { required: ['b'] } }, { a: 1 }).length, 1);
  assert.strictEqual(J.validate({ type: 'object', patternProperties: { '^x_': { type: 'number' } } }, { x_1: 'no' }).length, 1);
  assert.throws(() => J.validate({ $ref: '#/nope' }, 1));
});
t('inferSchema', () => {
  const s = J.inferSchema([{ id: 1, name: 'a', when: '2026-01-01T00:00:00Z', kind: 'x', opt: 1 }, { id: 2, name: 'b', when: '2026-01-02T00:00:00Z', kind: 'y' }, { id: 3.5, name: null, when: '2026-01-03T00:00:00Z', kind: 'x' }, { id: 4, name: 'd', when: '2026-01-04T00:00:00Z', kind: 'y' }]);
  assert.strictEqual(s.type, 'array'); const p = s.items.properties;
  assert.strictEqual(p.id.type, 'number'); assert.deepStrictEqual(p.name.type, ['string', 'null']); assert.strictEqual(p.when.format, 'date-time');
  assert.deepStrictEqual(p.kind.enum, ['x', 'y']); assert.deepStrictEqual(s.items.required.sort(), ['id', 'kind', 'name', 'when']);
  assert.deepStrictEqual(J.validate(s, [{ id: 9, name: 'z', when: '2026-02-02T00:00:00Z', kind: 'x' }]), []);
});
t('genTypes for every language', () => {
  const v = { id: 1, user: { name: 'a', tags: ['x'], address: null }, items: [{ sku: 'a', qty: 2 }, { sku: 'b', qty: 3, note: 'n' }], 'first-name': 'q' };
  J.TYPE_LANGS.forEach(l => { const out = J.genTypes(v, l, 'Order'); assert.ok(out.length > 40, l); assert.ok(/Order/.test(out), l); });
  const ts = J.genTypes(v, 'typescript', 'Order');
  assert.ok(ts.includes('export interface Order {')); assert.ok(ts.includes('note?: string;')); assert.ok(ts.includes('items: Item[];')); assert.ok(ts.includes('"first-name": string;')); assert.ok(ts.includes('address: null;') || ts.includes('address: unknown | null') || /address: .*null/.test(ts), ts);
  const go = J.genTypes(v, 'go', 'Order'); assert.ok(go.includes('`json:"first-name"`')); assert.ok(go.includes('Items []Item'));
  const rs = J.genTypes(v, 'rust', 'Order'); assert.ok(rs.includes('#[serde(rename = "first-name")]')); assert.ok(rs.includes('pub note: Option<String>'));
  const py = J.genTypes(v, 'python', 'Order'); assert.ok(py.includes('note: Optional[str] = None'));
  assert.ok(J.genTypes([1, 2], 'typescript', 'Nums').includes('export type Nums = number[];'));
});
t('toSql / toCsv / rowsOf', () => {
  const v = { data: [{ id: 1, name: "O'Neil", ok: true, meta: { city: 'Dubai' }, tags: ['a'] }, { id: 2, name: 'B', ok: false, meta: { city: null }, tags: [] }] };
  const r = J.toSql(v, { table: 'People', dialect: 'postgres' });
  assert.strictEqual(r.rows, 2); assert.deepStrictEqual(r.columns, ['id', 'name', 'ok', 'meta_city', 'tags']);
  assert.ok(r.sql.includes('CREATE TABLE "people" (\n  "id" BIGINT NOT NULL,'), r.sql); assert.ok(r.sql.includes("'O''Neil'")); assert.ok(r.sql.includes('"meta_city" TEXT,'), r.sql);
  assert.ok(J.toSql(v, { dialect: 'mysql' }).sql.includes('`data`'));
  assert.ok(J.toSql(v, { dialect: 'sqlite' }).sql.includes('INTEGER'));
  const csv = J.toCsv(v); assert.strictEqual(csv.split('\n')[0], 'id,name,ok,meta_city,tags'); assert.ok(csv.includes('"[""a""]"'));
});
t('ndjson', () => {
  const r = J.parseNdjson('{"a":1}\n\n{"a":2}\nnot json\n'); assert.strictEqual(r.values.length, 2); assert.strictEqual(r.errors[0].line, 4);
  assert.strictEqual(J.looksNdjson('{"a":1}\n{"a":2}'), true); assert.strictEqual(J.looksNdjson('{"a":1}'), false); assert.strictEqual(J.looksNdjson('[1,\n2]'), false);
});
t('stats, sortKeysDeep, bigIntWarnings', () => {
  const s = J.stats({ a: [1, 'x', null, true], b: { c: {} } }, '{}'); assert.strictEqual(s.keys, 3); assert.strictEqual(s.depth, 3); assert.strictEqual(s.arrays, 1); assert.strictEqual(s.strings, 1);
  assert.strictEqual(JSON.stringify(J.sortKeysDeep({ b: { z: 1, a: [3, 1] }, a: 0 })), '{"a":0,"b":{"a":[3,1],"z":1}}');
  assert.deepStrictEqual(J.bigIntWarnings('{"id": 9007199254740993, "ok": 123, "s": "12345678901234567890"}'), ['9007199254740993']);
});
console.log(`json engine: ${n} unit tests passed`);
