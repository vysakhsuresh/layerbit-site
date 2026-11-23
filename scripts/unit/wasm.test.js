// Node unit tests for js/engines/wasm.js. Run: node scripts/unit/wasm.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tests = [];
function t(name, fn) { tests.push([name, fn]); }
let W;
const bytes = fs.readFileSync(path.join(__dirname, '../../js/vendor/wasm/selftest.wasm'));

t('instantiate runs a module from bytes', async () => {
  const m = await W.instantiate(bytes);
  assert.strictEqual(m.exports.add(2, 3), 5);
});
t('load resolves a name against the base, memoises it, and reports a missing module clearly', async () => {
  let fetches = 0;
  W.configure({ base: 'https://example.test/', fetch: url => { fetches++; return url.endsWith('/js/vendor/wasm/selftest.wasm') ? Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) }) : Promise.resolve({ ok: false, status: 404 }); }, cache: false });
  const a = await W.load('selftest'), b = await W.load('selftest');
  assert.strictEqual(a, b); assert.strictEqual(fetches, 1);
  assert.strictEqual(a.exports.add(40, 2), 42);
  await assert.rejects(W.load('nope'), /nope.*404/);
  assert.throws(() => W.load('../escape'), /module name/);
});

(async () => {
  let n = 0, failed = 0;
  try { W = require('../../js/engines/wasm.js'); } catch (e) { console.error('FAIL loading js/engines/wasm.js\n  ', e.message); process.exitCode = 1; return; }
  for (const [name, fn] of tests) { try { await fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
  if (!failed) console.log(`wasm loader: ${n} unit tests passed`);
})();
