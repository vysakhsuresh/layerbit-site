// Unit tests for js/engines/layerlink.js. Run: node scripts/unit/layerlink.test.js
// The peer connections themselves are exercised in a real browser by test_tools.py.
const L = require('../../js/engines/layerlink.js');
const assert = require('assert');
let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }

function memStore() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: i => [...m.keys()][i],
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}
const tick = () => new Promise(r => setTimeout(r, 5));

t('seal and open: password round trip, wrong or missing password refused, no password is plain JSON', async () => {
  const s = await L.seal({ type: 'offer', sdp: 'v=0' }, 'hunter2', 'abc123');
  const o = JSON.parse(s);
  assert.strictEqual(o.sealed, 1);
  assert.ok(!s.includes('v=0'), 'the SDP is not readable in the sealed form');
  assert.deepStrictEqual(await L.open(s, 'hunter2', 'abc123'), { type: 'offer', sdp: 'v=0' });
  await assert.rejects(L.open(s, 'wrong', 'abc123'), e => e.code === 'password' && /Wrong password/.test(e.message));
  await assert.rejects(L.open(s, '', 'abc123'), e => e.code === 'password' && /needs a password/.test(e.message));
  await assert.rejects(L.open(s, 'hunter2', 'other1'), e => e.code === 'password', 'the session id is part of the key');
  const plain = await L.seal({ a: 1 }, '', 'abc123');
  assert.strictEqual(plain, '{"a":1}');
  assert.deepStrictEqual(await L.open(plain, '', 'abc123'), { a: 1 });
  const ivs = new Set(await Promise.all([1, 2, 3].map(() => L.seal({ a: 1 }, 'pw', 's').then(x => JSON.parse(x).iv))));
  assert.strictEqual(ivs.size, 3, 'a fresh IV every time');
});

t('checkPassword: the room token accepts the right password only; open rooms need none', async () => {
  const meta = { v: 1, locked: true, check: await L.seal({ ok: 'layerlink' }, 'pw1', 'room01') };
  assert.strictEqual(await L.checkPassword(meta, 'pw1', 'room01'), true);
  assert.strictEqual(await L.checkPassword(meta, 'pw2', 'room01'), false);
  assert.strictEqual(await L.checkPassword(meta, '', 'room01'), false);
  assert.strictEqual(await L.checkPassword({ v: 1, locked: false }, '', 'room01'), true);
});

t('localSignal: set, get, onValue, push order, onChild delivers existing and new children once, remove subtree', async () => {
  const sig = L.localSignal(memStore());
  const seen = [];
  const off = sig.onValue('sessions/a/status', v => seen.push(v));
  await tick();
  await sig.set('sessions/a/status', 'pending');
  await sig.set('sessions/a/status', 'approved');
  assert.deepStrictEqual(seen, [null, 'pending', 'approved']);
  off();
  await sig.set('sessions/a/status', 'removed');
  assert.strictEqual(seen.length, 3, 'unsubscribed');
  assert.strictEqual(await sig.get('sessions/a/status'), 'removed');

  await sig.push('sessions/a/joins', { vid: 'one' });
  await sig.push('sessions/a/joins', { vid: 'two' });
  const kids = [];
  sig.onChild('sessions/a/joins', (v, k) => kids.push([v.vid, typeof k]));
  await tick();
  await sig.push('sessions/a/joins', { vid: 'three' });
  await sig.set('sessions/a/joins/x/deeper', { vid: 'nested' });
  assert.deepStrictEqual(kids.map(k => k[0]), ['one', 'two', 'three'], 'existing children in push order, then new ones; grandchildren ignored');
  await sig.remove('sessions/a');
  assert.strictEqual(await sig.get('sessions/a/status'), null);
  assert.strictEqual(await sig.get('sessions/a/joins/x/deeper'), null);
});

t('fitRect: object-fit contain letterboxing, both orientations, empty video', () => {
  assert.deepStrictEqual(L.fitRect(1920, 1080, 960, 1080), { x: 0, y: 270, w: 960, h: 540 });
  assert.deepStrictEqual(L.fitRect(1080, 1920, 1920, 1080), { x: 656.25, y: 0, w: 607.5, h: 1080 });
  assert.deepStrictEqual(L.fitRect(1280, 720, 640, 360), { x: 0, y: 0, w: 640, h: 360 });
  assert.deepStrictEqual(L.fitRect(0, 0, 640, 360), { x: 0, y: 0, w: 640, h: 360 });
});

t('Sharer: approval gate, room limit, deny and remove write the viewer status', async () => {
  const sig = L.localSignal(memStore());
  const offers = [];
  const sh = new L.Sharer({ signal: sig, sid: 'room02', stream: null, approval: true, max: 2, password: 'pw' });
  sh.approve = function (vid) { offers.push(vid); this.viewers[vid].state = 'approved'; return Promise.resolve(); };
  const requests = [];
  sh.on('request', v => requests.push(v.name));
  await sh.start();
  const meta = await sig.get('sessions/room02/multi');
  assert.strictEqual(meta.v, 1); assert.strictEqual(meta.locked, true); assert.strictEqual(meta.approval, true); assert.strictEqual(meta.max, 2);
  assert.ok(meta.check && !JSON.stringify(meta).includes('pw"'), 'only a sealed token, never the password');
  await sig.push('sessions/room02/joins', { vid: 'v1', name: 'Asha' });
  await sig.push('sessions/room02/joins', { vid: 'v2', name: '<b>Ben</b>' });
  await sig.push('sessions/room02/joins', { vid: 'v3', name: 'Chen' });
  await tick();
  assert.deepStrictEqual(requests, ['Asha', '<b>Ben</b>']);
  assert.strictEqual(await sig.get('sessions/room02/viewers/v1/status'), 'pending');
  assert.strictEqual(await sig.get('sessions/room02/viewers/v3/status'), 'full', 'a third viewer is over the limit of 2');
  sh.approve('v1');
  sh.deny('v2');
  assert.strictEqual(await sig.get('sessions/room02/viewers/v2/status'), 'denied');
  sh.remove('v1');
  assert.strictEqual(await sig.get('sessions/room02/viewers/v1/status'), 'removed');
  assert.deepStrictEqual(offers, ['v1']);
  assert.deepStrictEqual(sh.list().map(v => v.state), ['removed', 'denied', 'full']);
  await sh.stop();
  assert.strictEqual(await sig.get('sessions/room02/multi'), null, 'stopping removes the session');
});

t('Sharer without approval lets viewers straight in', async () => {
  const sig = L.localSignal(memStore());
  const sh = new L.Sharer({ signal: sig, sid: 'room03', stream: null, approval: false, max: 4 });
  const approved = [];
  sh.approve = vid => { approved.push(vid); return Promise.resolve(); };
  await sh.start();
  await sig.push('sessions/room03/joins', { vid: 'a', name: 'A' });
  await tick();
  assert.deepStrictEqual(approved, ['a']);
  assert.strictEqual((await sig.get('sessions/room03/multi')).check, undefined, 'no token without a password');
});

(async () => {
  for (const [name, fn] of queue) { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
  console.log(`layerlink: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
