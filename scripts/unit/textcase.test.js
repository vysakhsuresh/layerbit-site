// Unit tests for js/engines/textcase.js. Run: node scripts/unit/textcase.test.js
const T = require('../../js/engines/textcase.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }

t('word splitting handles acronyms, digits and separators', () => {
  assert.deepStrictEqual(T.words('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  assert.deepStrictEqual(T.words('getUserID2FA'), ['get', 'User', 'ID', '2', 'FA']);
  assert.deepStrictEqual(T.words('user_id-value.name'), ['user', 'id', 'value', 'name']);
  assert.deepStrictEqual(T.words("  don't  stop "), ["don't", 'stop']);
});
t('identifier cases', () => {
  const s = 'parse HTTP response body';
  assert.strictEqual(T.convert(s, 'camel'), 'parseHttpResponseBody');
  assert.strictEqual(T.convert(s, 'pascal'), 'ParseHttpResponseBody');
  assert.strictEqual(T.convert(s, 'snake'), 'parse_http_response_body');
  assert.strictEqual(T.convert(s, 'constant'), 'PARSE_HTTP_RESPONSE_BODY');
  assert.strictEqual(T.convert(s, 'kebab'), 'parse-http-response-body');
  assert.strictEqual(T.convert(s, 'train'), 'Parse-Http-Response-Body');
  assert.strictEqual(T.convert(s, 'dot'), 'parse.http.response.body');
  assert.strictEqual(T.convert('XMLHttpRequest', 'snake'), 'xml_http_request');
});
t('identifier cases are per line', () => { assert.strictEqual(T.convert('first name\nlast name', 'camel'), 'firstName\nlastName'); });
t('title case follows small-word rules and keeps acronyms', () => {
  assert.strictEqual(T.titleCase('the lord of the rings: the return of the king'), 'The Lord of the Rings: The Return of the King');
  assert.strictEqual(T.titleCase('a guide to using the NASA API with iPhone apps'), 'A Guide to Using the NASA API With iPhone Apps'.replace('With', 'with'));
  assert.strictEqual(T.titleCase('what is it for'), 'What Is It For');
});
t('sentence case', () => { assert.strictEqual(T.sentenceCase('HELLO THERE. how ARE you? i am fine!'), 'Hello there. How are you? I am fine!'); });
t('slug folds accents', () => { assert.strictEqual(T.convert('Crème Brûlée: Ünïcode & Straße!', 'slug'), 'creme-brulee-unicode-strasse'); });
t('inverse and alternating', () => { assert.strictEqual(T.convert('Hello', 'inverse'), 'hELLO'); assert.strictEqual(T.convert('hello world', 'alternating'), 'hElLo WoRlD'); });
t('detect naming conventions', () => {
  [['userId', 'camel'], ['UserId', 'pascal'], ['user_id', 'snake'], ['USER_ID', 'constant'], ['user-id', 'kebab'], ['User-Id', 'train'], ['user.id', 'dot']].forEach(([s, c]) => assert.strictEqual(T.detect(s), c, s));
});
t('stats: words, sentences, graphemes, reading time', () => {
  const s = 'Dr. Smith went to Washington. He arrived at 9 a.m.! Was it worth it?\n\nYes 👍🏽.';
  const r = T.stats(s);
  assert.strictEqual(r.words, 15); // 'a.m.' is one word
  assert.strictEqual(r.paragraphs, 2);
  assert.ok(r.sentences >= 4 && r.sentences <= 5, 'sentences ' + r.sentences);
  assert.strictEqual(T.stats('👍🏽').characters, 1);
  assert.strictEqual(T.stats('').words, 0);
  assert.strictEqual(T.stats('word '.repeat(238)).readingSeconds, 60);
});
t('keyword density ignores stop words', () => { const r = T.stats('The cache is fast. The cache is warm. Cache hits matter.'); assert.strictEqual(r.keywords[0].word, 'cache'); assert.strictEqual(r.keywords[0].count, 3); });
t('line operations', () => {
  assert.strictEqual(T.lineOp('b\na\nb\n', 'dedupe'), 'b\na\n');
  assert.strictEqual(T.lineOp('item10\nitem2\nitem1', 'sortAsc'), 'item1\nitem2\nitem10');
  assert.strictEqual(T.lineOp('a\n\n\nb', 'dropBlank'), 'a\nb');
  assert.strictEqual(T.lineOp('one\ntwo\n\nthree', 'unwrap'), 'one two\n\nthree');
});
console.log(`text engine: ${pass} unit tests passed` + (fail ? `, ${fail} FAILED` : ''));
process.exit(fail ? 1 : 0);
