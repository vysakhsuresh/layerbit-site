// Node unit tests for js/engines/jwt.js (uses Node's WebCrypto). Run: node scripts/unit/jwt.test.js
const W = require('../../js/engines/jwt.js');
const assert = require('assert');
let n = 0; const fails = [];
async function t(name, fn) { try { await fn(); n++; } catch (e) { fails.push(name); console.error('FAIL', name, '\n  ', (e.stack || e.message).split('\n').slice(0, 3).join('\n')); } }
(async () => {
  const HS = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  await t('decode', async () => {
    const d = W.decode('Bearer ' + HS); assert.strictEqual(d.kind, 'jws'); assert.strictEqual(d.header.alg, 'HS256'); assert.strictEqual(d.payload.name, 'John Doe'); assert.strictEqual(d.error, null);
    assert.ok(W.decode('a.b').error); assert.ok(W.decode('!!.b.c').error); assert.strictEqual(W.decode('').error, 'empty');
    assert.strictEqual(W.decode('eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..aXY.Y3Q.dGFn').kind, 'jwe');
  });
  await t('verify HS256 right and wrong secret', async () => {
    const ok = await W.verify(HS, 'your-256-bit-secret'); assert.strictEqual(ok.valid, true, ok.reason);
    const bad = await W.verify(HS, 'nope'); assert.strictEqual(bad.valid, false);
    const none = await W.verify(W.b64uText('{"alg":"none"}') + '.' + W.b64uText('{}') + '.', 'x'); assert.strictEqual(none.valid, false); assert.ok(/none/.test(none.reason));
  });
  for (const alg of W.SUPPORTED) await t('sign/verify round trip ' + alg, async () => {
    const k = await W.generateKey(alg);
    const priv = k.secret !== undefined ? k.secret : k.privatePem, pub = k.secret !== undefined ? k.secret : k.publicPem;
    const token = await W.sign({ alg, kid: k.kid }, { sub: 'u1', exp: 4102444800 }, priv);
    assert.strictEqual(token.split('.').length, 3);
    const r = await W.verify(token, pub); assert.strictEqual(r.valid, true, alg + ': ' + r.reason);
    if (k.publicJwk) { const r2 = await W.verify(token, k.jwks); assert.strictEqual(r2.valid, true, alg + ' jwks: ' + r2.reason); const r3 = await W.verify(token, JSON.stringify(k.privateJwk)); assert.strictEqual(r3.valid, true, alg + ' private jwk as verify key'); }
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA'); const bad = await W.verify(tampered, pub); assert.strictEqual(bad.valid, false, alg + ' tamper');
    const wrongKey = await W.verify(token, k.secret !== undefined ? 'other' : (await W.generateKey(alg)).publicPem); assert.strictEqual(wrongKey.valid, false, alg + ' wrong key');
  });
  await t('key import error messages', async () => {
    const k = await W.generateKey('RS256');
    assert.ok(/private key/.test((await W.verify(await W.sign({ alg: 'RS256' }, {}, k.privatePem), k.privatePem)).reason));
    assert.ok(/public key/.test(await W.sign({ alg: 'RS256' }, {}, k.publicPem).catch(e => e.message)));
    assert.ok(/PEM/.test((await W.verify(await W.sign({ alg: 'ES256' }, {}, (await W.generateKey('ES256')).privatePem), 'garbage')).reason));
    const es = await W.generateKey('ES384'); const tok = await W.sign({ alg: 'ES384' }, {}, es.privatePem);
    assert.ok(/curve|imported/.test((await W.verify(tok, (await W.generateKey('ES256')).publicPem)).reason));
  });
  await t('lint findings', async () => {
    const now = 1_800_000_000;
    const mk = (h, p) => W.decode(W.b64uText(JSON.stringify(h)) + '.' + W.b64uText(JSON.stringify(p)) + '.sig');
    const f = W.lint(mk({ alg: 'none' }, { exp: now - 100, iat: now - 200, password: 'x', jku: 1 }), { now });
    const claims = f.map(x => x.level + ':' + x.claim);
    assert.ok(claims.includes('error:alg') && claims.includes('error:exp') && claims.includes('warn:password'), claims.join(','));
    const g = W.lint(mk({ alg: 'RS256', typ: 'JWT', jku: 'https://x' }, { exp: now + 400 * 86400, iat: now, iss: 'a', aud: ['b'] }), { now, iss: 'other', aud: 'c' });
    const gc = g.map(x => x.level + ':' + x.claim);
    assert.ok(gc.includes('error:header') && gc.includes('warn:exp') && gc.includes('error:iss') && gc.includes('error:aud') && gc.includes('info:kid'), gc.join(','));
    const ms = W.lint(mk({ alg: 'HS256', typ: 'JWT' }, { exp: now * 1000, iat: now }), { now }); assert.ok(ms.some(x => x.claim === 'exp' && /milliseconds/.test(x.message)));
    const tl = W.timeline({ iat: now - 100, exp: now + 100 }, now); assert.strictEqual(tl.state, 'valid'); assert.strictEqual(tl.lifetime, 200); assert.ok(tl.pos(now) > 0.4 && tl.pos(now) < 0.6);
    assert.strictEqual(W.timeline({ exp: now - 1 }, now).state, 'expired'); assert.strictEqual(W.timeline({ nbf: now + 10 }, now).state, 'not-yet-valid');
  });
  await t('JWE round trips: dir, A256KW, RSA-OAEP-256, PBES2 decrypt', async () => {
    const cek = W.b64uEncode(require('crypto').randomBytes(32));
    const j1 = await W.encryptJwe({ hello: 'world' }, 'dir', 'A256GCM', cek); assert.strictEqual(j1.split('.').length, 5);
    assert.deepStrictEqual((await W.decryptJwe(j1, cek)).json, { hello: 'world' });
    await assert.rejects(W.decryptJwe(j1, W.b64uEncode(require('crypto').randomBytes(32))));
    const kek = W.b64uEncode(require('crypto').randomBytes(32));
    const j2 = await W.encryptJwe('plain text', 'A256KW', 'A128GCM', kek); assert.strictEqual((await W.decryptJwe(j2, kek)).plaintext, 'plain text');
    const rsa = await (require('crypto').webcrypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']));
    const pubJwk = await require('crypto').webcrypto.subtle.exportKey('jwk', rsa.publicKey), privJwk = await require('crypto').webcrypto.subtle.exportKey('jwk', rsa.privateKey);
    const j3 = await W.encryptJwe({ a: 1 }, 'RSA-OAEP-256', 'A256GCM', pubJwk); assert.deepStrictEqual((await W.decryptJwe(j3, privJwk)).json, { a: 1 });
    // PBES2 vector built with node: derive + wrap manually
    const c = require('crypto'); const pw = 'Thus from my lips, by yours, my sin is purged.'; const p2s = c.randomBytes(16), p2c = 4096;
    const salt = Buffer.concat([Buffer.from('PBES2-HS256+A128KW'), Buffer.from([0]), p2s]); const kekBuf = c.pbkdf2Sync(pw, salt, p2c, 16, 'sha256');
    const cekBuf = c.randomBytes(32); const wrapped = (() => { const ci = c.createCipheriv('id-aes128-wrap', kekBuf, Buffer.from('A6A6A6A6A6A6A6A6', 'hex')); return Buffer.concat([ci.update(cekBuf), ci.final()]); })();
    const hdr = { alg: 'PBES2-HS256+A128KW', enc: 'A256GCM', p2s: W.b64uEncode(p2s), p2c }; const pb = W.b64uText(JSON.stringify(hdr)); const iv = c.randomBytes(12);
    const gcm = c.createCipheriv('aes-256-gcm', cekBuf, iv); gcm.setAAD(Buffer.from(pb)); const ct = Buffer.concat([gcm.update('secret'), gcm.final()]); const tag = gcm.getAuthTag();
    const j4 = [pb, W.b64uEncode(wrapped), W.b64uEncode(iv), W.b64uEncode(ct), W.b64uEncode(tag)].join('.');
    assert.strictEqual((await W.decryptJwe(j4, pw)).plaintext, 'secret');
    // A128CBC-HS256 vector
    const cek2 = c.randomBytes(32), iv2 = c.randomBytes(16), hdr2 = { alg: 'dir', enc: 'A128CBC-HS256' }, pb2 = W.b64uText(JSON.stringify(hdr2));
    const cbc = c.createCipheriv('aes-128-cbc', cek2.subarray(16), iv2); const ct2 = Buffer.concat([cbc.update('{"cbc":true}'), cbc.final()]);
    const al = Buffer.alloc(8); al.writeBigUInt64BE(BigInt(pb2.length * 8)); const mac = c.createHmac('sha256', cek2.subarray(0, 16)).update(Buffer.concat([Buffer.from(pb2), iv2, ct2, al])).digest().subarray(0, 16);
    const j5 = [pb2, '', W.b64uEncode(iv2), W.b64uEncode(ct2), W.b64uEncode(mac)].join('.');
    assert.deepStrictEqual((await W.decryptJwe(j5, W.b64uEncode(cek2))).json, { cbc: true });
  });
  await t('PKCS#1 public key wrapping', async () => {
    const c = require('crypto'); const { publicKey, privateKey } = c.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pkcs1 = publicKey.export({ type: 'pkcs1', format: 'pem' }), pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const tok = await W.sign({ alg: 'RS256' }, { x: 1 }, pkcs8); const r = await W.verify(tok, pkcs1); assert.strictEqual(r.valid, true, r.reason);
  });
  console.log(`jwt engine: ${n} unit tests passed${fails.length ? ', ' + fails.length + ' FAILED' : ''}`);
  if (fails.length) process.exitCode = 1;
})();
