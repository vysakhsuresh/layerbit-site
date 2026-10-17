/* Layerbit JWT engine. Browser (window.LBJwt) and Node (module.exports); needs WebCrypto.
 *
 * decode(token)                        -> {header, payload, signature, parts, kind:'jws'|'jwe', error}
 * lint(decoded, opts)                  -> [{level:'error'|'warn'|'info', claim, message}]
 * timeline(payload, now)               -> {iat, nbf, exp, now, lifetime, remaining, state}
 * importKey(material, alg, usage)      -> CryptoKey from a secret, PEM (SPKI/PKCS8/PKCS#1), JWK or JWKS
 * verify(token, material)              -> {valid, alg, kid, reason}
 * sign(header, payload, material)      -> token string
 * generateKey(alg)                     -> {alg, publicPem, privatePem, publicJwk, privateJwk} or {secret}
 * decryptJwe(token, material)          -> {header, plaintext, cek}
 * SUPPORTED: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512, EdDSA (Ed25519)
 * JWE: dir, A128/192/256KW, RSA-OAEP, RSA-OAEP-256, PBES2-HS*+A*KW, ECDH-ES(+A*KW); A*GCM, A*CBC-HS*
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis.crypto);
  else root.LBJwt = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';
  var subtle = webcrypto && webcrypto.subtle;
  var te = new TextEncoder(), td = new TextDecoder();

  // ------------------------------------------------------------ encoding
  function b64uEncode(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64uDecode(str) { if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('not base64url'); str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; var bin = atob(str), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function b64uText(s) { return b64uEncode(te.encode(s)); }
  function b64uJson(bytes) { return JSON.parse(td.decode(bytes)); }
  function concat() { var n = 0, i; for (i = 0; i < arguments.length; i++) n += arguments[i].length; var out = new Uint8Array(n), p = 0; for (i = 0; i < arguments.length; i++) { out.set(arguments[i], p); p += arguments[i].length; } return out; }

  // -------------------------------------------------------------- decode
  function decode(token) {
    var t = String(token || '').trim().replace(/^Bearer\s+/i, '');
    var parts = t.split('.');
    var res = { raw: t, parts: parts, header: null, payload: null, signature: null, kind: null, error: null, signingInput: '' };
    if (!t) { res.error = 'empty'; return res; }
    if (parts.length !== 3 && parts.length !== 5) { res.error = 'A JWT has three dot-separated parts (JWS) or five (JWE); this has ' + parts.length + '.'; return res; }
    try { res.header = b64uJson(b64uDecode(parts[0])); } catch (e) { res.error = 'The header is not base64url-encoded JSON: ' + e.message; return res; }
    if (parts.length === 5) { res.kind = 'jwe'; res.encryptedKey = parts[1]; res.iv = parts[2]; res.ciphertext = parts[3]; res.tag = parts[4]; return res; }
    res.kind = 'jws';
    try { var pb = b64uDecode(parts[1]); res.payloadText = td.decode(pb); res.payload = JSON.parse(res.payloadText); } catch (e) { res.error = 'The payload is not base64url-encoded JSON: ' + e.message; return res; }
    res.signature = parts[2]; res.signingInput = parts[0] + '.' + parts[1];
    try { b64uDecode(parts[2]); } catch (e) { res.badSignature = true; }
    return res;
  }

  // ---------------------------------------------------------------- lint
  var SENSITIVE = /(password|passwd|secret|ssn|social.?security|credit.?card|card.?number|cvv|private.?key|api.?key|token)/i;
  function lint(d, opts) {
    opts = opts || {};
    var out = [], h = d.header || {}, p = d.payload || {}, now = opts.now || Math.floor(Date.now() / 1000), skew = opts.skew == null ? 60 : opts.skew;
    function add(level, claim, message) { out.push({ level: level, claim: claim, message: message }); }
    if (d.error) { add('error', 'format', d.error); return out; }
    if (d.kind === 'jwe') { add('info', 'jwe', 'This is an encrypted token (JWE). Claims are only readable after decryption with the recipient key.'); if (!h.enc) add('error', 'enc', 'A JWE header must name a content-encryption algorithm (enc).'); return out; }
    if (!h.alg) add('error', 'alg', 'The header has no alg. Verifiers cannot know how to check the signature.');
    else if (/^none$/i.test(h.alg)) add('error', 'alg', 'alg is "none": the token is unsigned and must be rejected by any verifier that matters.');
    else if (!/^(HS|RS|PS|ES)(256|384|512)$|^EdDSA$|^ES256K$/.test(h.alg)) add('warn', 'alg', 'alg "' + h.alg + '" is not a registered JWS algorithm this tool knows.');
    if (/^HS/.test(h.alg || '') && !d.signature) add('error', 'signature', 'An HMAC token with an empty signature.');
    if (d.badSignature) add('error', 'signature', 'The signature part is not valid base64url; no verifier will accept it.');
    if (!h.typ) add('info', 'typ', 'No typ header. "JWT" (or "at+jwt" for access tokens, RFC 9068) lets a verifier reject tokens of the wrong kind.');
    else if (!/^(JWT|at\+jwt|application\/at\+jwt|dpop\+jwt|logout\+jwt|secevent\+jwt|JOSE)$/i.test(h.typ)) add('info', 'typ', 'Unusual typ "' + h.typ + '".');
    if (h.jwk || h.jku || h.x5u) add('error', 'header', 'The header carries its own key or key URL (' + ['jwk', 'jku', 'x5u'].filter(function (k) { return h[k]; }).join(', ') + '). A verifier must never take the key from the token itself; it must use keys it already trusts.');
    if (/^(RS|PS|ES)|EdDSA/.test(h.alg || '') && !h.kid) add('info', 'kid', 'No kid header. With asymmetric keys a kid lets the verifier pick the right key from a JWKS and rotate keys without downtime.');
    if (h.cty && /jwt/i.test(h.cty)) add('info', 'cty', 'Nested JWT (cty=JWT): the payload is itself a token that must be verified separately.');
    if (h.crit) add('warn', 'crit', 'crit header present: verifiers that do not understand ' + JSON.stringify(h.crit) + ' must reject this token.');
    function num(k) { return typeof p[k] === 'number'; }
    ['exp', 'nbf', 'iat'].forEach(function (k) {
      if (p[k] === undefined) return;
      if (!num(p[k] !== undefined ? k : k)) { add('error', k, k + ' must be a NumericDate (seconds since the epoch), got ' + JSON.stringify(p[k]) + '.'); return; }
      if (p[k] > 1e11) add('error', k, k + ' looks like milliseconds (' + p[k] + '). RFC 7519 requires seconds; a verifier will treat this as the year ' + new Date(p[k] * 1000).getUTCFullYear() + '.');
    });
    if (p.exp === undefined) add('warn', 'exp', 'No exp claim: the token never expires. Every bearer token should have a short lifetime.');
    else if (num('exp') && p.exp <= 1e11) {
      if (p.exp + skew < now) add('error', 'exp', 'Expired ' + human(now - p.exp) + ' ago.');
      else if (p.exp - now <= 300 && p.exp >= now) add('info', 'exp', 'Expires in ' + human(p.exp - now) + '.');
    }
    if (num('iat') && p.iat <= 1e11 && p.iat - skew > now) add('warn', 'iat', 'iat is ' + human(p.iat - now) + ' in the future: issuer and verifier clocks disagree, or the claim is wrong.');
    if (num('nbf') && p.nbf <= 1e11 && p.nbf - skew > now) add('warn', 'nbf', 'Not valid before ' + human(p.nbf - now) + ' from now.');
    if (num('exp') && num('iat') && p.exp <= 1e11 && p.iat <= 1e11) {
      var life = p.exp - p.iat;
      if (life <= 0) add('error', 'exp', 'exp is not after iat: the token was expired when issued.');
      else if (life > 30 * 86400) add('warn', 'exp', 'Lifetime is ' + human(life) + '. Access tokens are normally minutes to hours; anything beyond days should be a refresh token with revocation.');
      else if (life > 86400) add('info', 'exp', 'Lifetime is ' + human(life) + ' — long for an access token.');
    }
    if (p.iss === undefined) add('info', 'iss', 'No iss claim: verifiers cannot check who issued the token.');
    else if (opts.iss && p.iss !== opts.iss) add('error', 'iss', 'iss is "' + p.iss + '", expected "' + opts.iss + '".');
    if (p.aud === undefined) add('info', 'aud', 'No aud claim: a token minted for one service could be replayed against another.');
    else if (opts.aud) { var auds = Array.isArray(p.aud) ? p.aud : [p.aud]; if (auds.indexOf(opts.aud) < 0) add('error', 'aud', 'aud ' + JSON.stringify(p.aud) + ' does not include "' + opts.aud + '".'); }
    if (p.sub === undefined) add('info', 'sub', 'No sub claim.');
    if (p.jti === undefined && num('exp') && p.exp - (p.iat || now) > 3600) add('info', 'jti', 'No jti: long-lived tokens without an id cannot be individually revoked.');
    Object.keys(p).forEach(function (k) { if (SENSITIVE.test(k) && !/^(access_token_type|token_type|token_use)$/i.test(k)) add('warn', k, 'Claim "' + k + '" looks sensitive. Payloads are readable by anyone holding the token; keep secrets out of them.'); });
    var size = d.raw.length;
    if (size > 8000) add('warn', 'size', 'Token is ' + size + ' characters. Over roughly 8 KB it will not fit in a cookie or many proxies\' header limits.');
    else if (size > 4000) add('info', 'size', 'Token is ' + size + ' characters; cookies cap at about 4 KB.');
    return out;
  }
  function human(s) { s = Math.round(Math.abs(s)); if (s < 60) return s + ' s'; if (s < 3600) return Math.round(s / 60) + ' min'; if (s < 86400) return (s / 3600).toFixed(s % 3600 ? 1 : 0) + ' h'; if (s < 365 * 86400) return (s / 86400).toFixed(s % 86400 ? 1 : 0) + ' days'; return (s / (365.25 * 86400)).toFixed(1) + ' years'; }
  function timeline(p, now) {
    now = now || Math.floor(Date.now() / 1000);
    var t = { now: now }, fix = function (v) { return typeof v === 'number' ? (v > 1e11 ? v / 1000 : v) : null; };
    t.iat = fix(p.iat); t.nbf = fix(p.nbf); t.exp = fix(p.exp);
    t.state = t.exp !== null && t.exp < now ? 'expired' : t.nbf !== null && t.nbf > now ? 'not-yet-valid' : t.exp !== null ? 'valid' : 'no-expiry';
    t.lifetime = t.exp !== null && t.iat !== null ? t.exp - t.iat : null;
    t.remaining = t.exp !== null ? t.exp - now : null;
    var pts = [t.iat, t.nbf, t.exp, now].filter(function (x) { return x !== null; });
    t.start = Math.min.apply(null, pts); t.end = Math.max.apply(null, pts);
    if (t.end === t.start) t.end = t.start + 1;
    var span = t.end - t.start; t.start -= span * 0.05; t.end += span * 0.05;
    t.pos = function (x) { return (x - t.start) / (t.end - t.start); };
    return t;
  }

  // ---------------------------------------------------------------- keys
  var ALG = {
    HS256: { kind: 'hmac', hash: 'SHA-256' }, HS384: { kind: 'hmac', hash: 'SHA-384' }, HS512: { kind: 'hmac', hash: 'SHA-512' },
    RS256: { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, RS384: { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, RS512: { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
    PS256: { kind: 'rsa', name: 'RSA-PSS', hash: 'SHA-256', salt: 32 }, PS384: { kind: 'rsa', name: 'RSA-PSS', hash: 'SHA-384', salt: 48 }, PS512: { kind: 'rsa', name: 'RSA-PSS', hash: 'SHA-512', salt: 64 },
    ES256: { kind: 'ec', curve: 'P-256', hash: 'SHA-256' }, ES384: { kind: 'ec', curve: 'P-384', hash: 'SHA-384' }, ES512: { kind: 'ec', curve: 'P-521', hash: 'SHA-512' },
    EdDSA: { kind: 'ed', name: 'Ed25519' }
  };
  var SUPPORTED = Object.keys(ALG);
  function pemBody(pem) { var m = /-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/.exec(pem); if (!m) throw new Error('Not a PEM block (expected -----BEGIN ...----- ... -----END ...-----)'); var bin = atob(m[2].replace(/\s+/g, '')), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return { label: m[1].trim(), der: out }; }
  // Wrap a PKCS#1 "RSA PUBLIC KEY" into SPKI so WebCrypto accepts it.
  function pkcs1ToSpki(der) {
    var oid = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
    var bit = concat(new Uint8Array([0x03]), len(der.length + 1), new Uint8Array([0x00]), der);
    var body = concat(oid, bit);
    return concat(new Uint8Array([0x30]), len(body.length), body);
  }
  function len(n) { if (n < 128) return new Uint8Array([n]); if (n < 256) return new Uint8Array([0x81, n]); return new Uint8Array([0x82, n >> 8, n & 255]); }
  function algParams(alg) {
    var a = ALG[alg]; if (!a) throw new Error('Unsupported algorithm ' + alg);
    if (a.kind === 'hmac') return { name: 'HMAC', hash: a.hash };
    if (a.kind === 'rsa') return { name: a.name, hash: a.hash };
    if (a.kind === 'ec') return { name: 'ECDSA', namedCurve: a.curve };
    return { name: 'Ed25519' };
  }
  function signParams(alg) { var a = ALG[alg]; if (a.kind === 'hmac') return 'HMAC'; if (a.kind === 'rsa') return a.name === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: a.salt } : 'RSASSA-PKCS1-v1_5'; if (a.kind === 'ec') return { name: 'ECDSA', hash: a.hash }; return 'Ed25519'; }
  /** material: string (secret, PEM, JWK/JWKS JSON) or object (JWK/JWKS). usage: 'verify' | 'sign'. */
  function importKey(material, alg, usage, kid) {
    var a = ALG[alg]; if (!a) return Promise.reject(new Error('Unsupported algorithm ' + alg));
    var jwk = null, text = typeof material === 'string' ? material.trim() : null;
    if (material && typeof material === 'object') jwk = material;
    else if (text && /^\s*\{/.test(text)) { try { jwk = JSON.parse(text); } catch (e) { return Promise.reject(new Error('Key is not valid JSON: ' + e.message)); } }
    if (jwk && jwk.keys) {
      var list = jwk.keys.filter(function (k) { return !kid || k.kid === kid; });
      if (!list.length) return Promise.reject(new Error(kid ? 'No key with kid "' + kid + '" in the JWKS (' + jwk.keys.map(function (k) { return k.kid; }).join(', ') + ')' : 'The JWKS has no keys'));
      jwk = list[0];
    }
    if (jwk) {
      var j = Object.assign({}, jwk); delete j.use; delete j.key_ops; delete j.kid; delete j.x5c; delete j.x5t; delete j['x5t#S256']; delete j.x5u;
      if (a.kind === 'hmac') { if (!j.k) return Promise.reject(new Error('An HMAC JWK needs "k"')); return subtle.importKey('raw', b64uDecode(j.k), algParams(alg), false, [usage]); }
      if (a.kind === 'rsa') { j.alg = alg; if (usage === 'verify') { delete j.d; delete j.p; delete j.q; delete j.dp; delete j.dq; delete j.qi; } }
      if (a.kind === 'ec') { delete j.alg; if (usage === 'verify') delete j.d; }
      if (a.kind === 'ed') { delete j.alg; if (usage === 'verify') delete j.d; }
      return subtle.importKey('jwk', j, algParams(alg), false, [usage]);
    }
    if (a.kind === 'hmac') return subtle.importKey('raw', te.encode(text), algParams(alg), false, [usage]);
    if (!text || text.indexOf('-----BEGIN') < 0) return Promise.reject(new Error(usage === 'verify' ? 'Paste a PEM public key (-----BEGIN PUBLIC KEY-----) or a JWK/JWKS for ' + alg : 'Paste a PEM private key (-----BEGIN PRIVATE KEY-----) or a JWK for ' + alg));
    var pb; try { pb = pemBody(text); } catch (e) { return Promise.reject(e); }
    if (/RSA PUBLIC KEY/.test(pb.label)) return subtle.importKey('spki', pkcs1ToSpki(pb.der), algParams(alg), false, [usage]);
    if (/CERTIFICATE/.test(pb.label)) return Promise.reject(new Error('That is an X.509 certificate; extract the public key with: openssl x509 -pubkey -noout -in cert.pem'));
    if (/^(RSA |EC )?PRIVATE KEY$/.test(pb.label) && usage === 'verify') return Promise.reject(new Error('That is a private key; verification needs the public key.'));
    if (/PUBLIC KEY/.test(pb.label) && usage === 'sign') return Promise.reject(new Error('That is a public key; signing needs the private key.'));
    if (/^(RSA|EC) PRIVATE KEY$/.test(pb.label)) return Promise.reject(new Error('Legacy ' + pb.label + ' (PKCS#1/SEC1) format: convert with openssl pkcs8 -topk8 -nocrypt -in key.pem'));
    return subtle.importKey(usage === 'verify' ? 'spki' : 'pkcs8', pb.der, algParams(alg), false, [usage]).catch(function (e) { throw new Error('The key could not be imported for ' + alg + (a.kind === 'ec' ? ' (curve must be ' + a.curve + ')' : '') + ': ' + (e.message || e.name)); });
  }

  // ------------------------------------------------------------ verify/sign
  function verify(token, material, opts) {
    opts = opts || {};
    var d = typeof token === 'string' ? decode(token) : token;
    if (d.error) return Promise.resolve({ valid: false, reason: d.error });
    if (d.kind !== 'jws') return Promise.resolve({ valid: false, reason: 'Encrypted token: decrypt it instead of verifying a signature.' });
    var alg = opts.alg || d.header.alg;
    if (!alg || /^none$/i.test(alg)) return Promise.resolve({ valid: false, alg: alg, reason: 'alg is none: there is no signature to verify. Reject.' });
    if (d.badSignature) return Promise.resolve({ valid: false, alg: alg, reason: 'The signature is not valid base64url.' });
    if (!ALG[alg]) return Promise.resolve({ valid: false, alg: alg, reason: 'Algorithm ' + alg + ' is not supported here.' });
    if (!subtle) return Promise.resolve({ valid: false, alg: alg, reason: 'Web Crypto is unavailable (needs a secure context).' });
    return importKey(material, alg, 'verify', d.header.kid).then(function (key) {
      var sig = b64uDecode(d.signature);
      var a = ALG[alg];
      if (a.kind === 'ec') { var n = { 'P-256': 32, 'P-384': 48, 'P-521': 66 }[a.curve]; if (sig.length !== 2 * n) return { valid: false, alg: alg, reason: 'ES signature must be ' + 2 * n + ' raw bytes (r||s), got ' + sig.length + '. DER-encoded signatures are not valid JWS.' }; }
      return subtle.verify(signParams(alg), key, sig, te.encode(d.signingInput)).then(function (ok) { return { valid: ok, alg: alg, kid: d.header.kid, reason: ok ? 'Signature verified with the supplied key.' : 'Signature does not match: wrong key or secret, or the token was altered.' }; });
    }).catch(function (e) { return { valid: false, alg: alg, reason: e.message || String(e) }; });
  }
  function sign(header, payload, material) {
    var alg = header.alg; if (!ALG[alg]) return Promise.reject(new Error('Unsupported algorithm ' + alg));
    var h = Object.assign({ typ: 'JWT' }, header);
    var input = b64uText(JSON.stringify(h)) + '.' + b64uText(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return importKey(material, alg, 'sign', h.kid).then(function (key) { return subtle.sign(signParams(alg), key, te.encode(input)); }).then(function (sig) { return input + '.' + b64uEncode(sig); });
  }
  function toPem(der, label) { var b = b64uEncode(der).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return '-----BEGIN ' + label + '-----\n' + b.replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END ' + label + '-----'; }
  function generateKey(alg, opts) {
    opts = opts || {};
    var a = ALG[alg]; if (!a) return Promise.reject(new Error('Unsupported algorithm ' + alg));
    if (a.kind === 'hmac') { var bytes = new Uint8Array({ HS256: 32, HS384: 48, HS512: 64 }[alg]); webcrypto.getRandomValues(bytes); return Promise.resolve({ alg: alg, secret: b64uEncode(bytes), jwk: { kty: 'oct', k: b64uEncode(bytes), alg: alg } }); }
    var params = algParams(alg);
    if (a.kind === 'rsa') { params.modulusLength = opts.bits || 2048; params.publicExponent = new Uint8Array([1, 0, 1]); }
    return subtle.generateKey(params, true, ['sign', 'verify']).then(function (kp) {
      return Promise.all([subtle.exportKey('spki', kp.publicKey), subtle.exportKey('pkcs8', kp.privateKey), subtle.exportKey('jwk', kp.publicKey), subtle.exportKey('jwk', kp.privateKey)]).then(function (r) {
        var kid = opts.kid || ('key-' + Date.now().toString(36));
        var pub = Object.assign({}, r[2], { kid: kid, alg: alg, use: 'sig' }), priv = Object.assign({}, r[3], { kid: kid, alg: alg, use: 'sig' });
        delete pub.key_ops; delete priv.key_ops; delete pub.ext; delete priv.ext;
        return { alg: alg, kid: kid, publicPem: toPem(new Uint8Array(r[0]), 'PUBLIC KEY'), privatePem: toPem(new Uint8Array(r[1]), 'PRIVATE KEY'), publicJwk: pub, privateJwk: priv, jwks: { keys: [pub] } };
      });
    });
  }

  // ----------------------------------------------------------------- JWE
  function pbkdf2Wrap(alg, password, header) {
    var hash = { 'PBES2-HS256+A128KW': ['SHA-256', 128], 'PBES2-HS384+A192KW': ['SHA-384', 192], 'PBES2-HS512+A256KW': ['SHA-512', 256] }[alg];
    var salt = concat(te.encode(alg), new Uint8Array([0]), b64uDecode(header.p2s || ''));
    return subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: header.p2c || 1000, hash: hash[0] }, base, { name: 'AES-KW', length: hash[1] }, false, ['unwrapKey']);
    });
  }
  function concatKdf(z, enc, apu, apv, bits) {
    var algId = te.encode(enc), lenBE = function (n) { return new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); };
    var other = concat(lenBE(algId.length), algId, lenBE(apu.length), apu, lenBE(apv.length), apv, lenBE(bits));
    return subtle.digest('SHA-256', concat(lenBE(1), z, other)).then(function (h) { return new Uint8Array(h).slice(0, bits / 8); });
  }
  function cekFor(enc) { var m = /^A(128|192|256)(GCM|CBC-HS(256|384|512))$/.exec(enc); if (!m) throw new Error('Unsupported enc ' + enc); return { bits: m[2] === 'GCM' ? +m[1] : 2 * +m[1], gcm: m[2] === 'GCM', keyBits: +m[1], hash: m[3] ? 'SHA-' + m[3] : null }; }
  function decryptJwe(token, material, opts) {
    opts = opts || {};
    var d = typeof token === 'string' ? decode(token) : token;
    if (d.error) return Promise.reject(new Error(d.error));
    if (d.kind !== 'jwe') return Promise.reject(new Error('Not a JWE: a JWE has five parts.'));
    var h = d.header, alg = h.alg, enc = h.enc, c;
    try { c = cekFor(enc); } catch (e) { return Promise.reject(e); }
    var ek = b64uDecode(d.encryptedKey), iv = b64uDecode(d.iv), ct = b64uDecode(d.ciphertext), tag = b64uDecode(d.tag), aad = te.encode(d.parts[0]);
    var cekPromise;
    var text = typeof material === 'string' ? material.trim() : '';
    var jwk = material && typeof material === 'object' ? material : (/^\s*\{/.test(text) ? JSON.parse(text) : null);
    if (jwk && jwk.keys) jwk = jwk.keys.filter(function (k) { return !h.kid || k.kid === h.kid; })[0] || jwk.keys[0];
    function rawSecret() { if (jwk && jwk.k) return b64uDecode(jwk.k); try { return b64uDecode(text); } catch (e) { return te.encode(text); } }
    if (alg === 'dir') cekPromise = Promise.resolve(rawSecret());
    else if (/^A(128|192|256)KW$/.test(alg)) cekPromise = subtle.importKey('raw', rawSecret(), 'AES-KW', false, ['unwrapKey']).then(function (kek) { return subtle.unwrapKey('raw', ek, kek, 'AES-KW', c.gcm ? { name: 'AES-GCM' } : { name: 'HMAC', hash: 'SHA-256' }, true, c.gcm ? ['decrypt'] : ['sign']).then(function (k) { return subtle.exportKey('raw', k); }).then(function (r) { return new Uint8Array(r); }); });
    else if (/^PBES2-/.test(alg)) cekPromise = pbkdf2Wrap(alg, text, h).then(function (kek) { return subtle.unwrapKey('raw', ek, kek, 'AES-KW', c.gcm ? { name: 'AES-GCM' } : { name: 'HMAC', hash: 'SHA-256' }, true, c.gcm ? ['decrypt'] : ['sign']); }).then(function (k) { return subtle.exportKey('raw', k); }).then(function (r) { return new Uint8Array(r); });
    else if (alg === 'RSA-OAEP' || alg === 'RSA-OAEP-256') {
      var hash = alg === 'RSA-OAEP' ? 'SHA-1' : 'SHA-256';
      var imp = jwk ? subtle.importKey('jwk', Object.assign({}, jwk, { alg: alg === 'RSA-OAEP' ? 'RSA-OAEP' : 'RSA-OAEP-256' }, { key_ops: ['decrypt'] }), { name: 'RSA-OAEP', hash: hash }, false, ['decrypt']) : Promise.resolve().then(function () { var pb = pemBody(text); if (!/PRIVATE KEY/.test(pb.label)) throw new Error('RSA-OAEP decryption needs the recipient private key (PKCS#8 PEM).'); return subtle.importKey('pkcs8', pb.der, { name: 'RSA-OAEP', hash: hash }, false, ['decrypt']); });
      cekPromise = imp.then(function (k) { return subtle.decrypt({ name: 'RSA-OAEP' }, k, ek); }).then(function (r) { return new Uint8Array(r); });
    }
    else if (/^ECDH-ES/.test(alg)) {
      if (!h.epk) return Promise.reject(new Error('ECDH-ES header has no epk'));
      var curve = h.epk.crv;
      var privImp = jwk ? subtle.importKey('jwk', Object.assign({}, jwk, { key_ops: ['deriveBits'] }), { name: 'ECDH', namedCurve: curve }, false, ['deriveBits']) : Promise.resolve().then(function () { var pb = pemBody(text); return subtle.importKey('pkcs8', pb.der, { name: 'ECDH', namedCurve: curve }, false, ['deriveBits']); });
      var pubImp = subtle.importKey('jwk', { kty: 'EC', crv: curve, x: h.epk.x, y: h.epk.y }, { name: 'ECDH', namedCurve: curve }, false, []);
      var wrapAlg = alg === 'ECDH-ES' ? null : alg.slice(8);
      var kdfBits = wrapAlg ? +/A(\d+)KW/.exec(wrapAlg)[1] : c.bits;
      cekPromise = Promise.all([privImp, pubImp]).then(function (k) { return subtle.deriveBits({ name: 'ECDH', public: k[1] }, k[0], { 'P-256': 256, 'P-384': 384, 'P-521': 528 }[curve]); })
        .then(function (z) { return concatKdf(new Uint8Array(z), wrapAlg || enc, h.apu ? b64uDecode(h.apu) : new Uint8Array(0), h.apv ? b64uDecode(h.apv) : new Uint8Array(0), kdfBits); })
        .then(function (derived) { if (!wrapAlg) return derived; return subtle.importKey('raw', derived, 'AES-KW', false, ['unwrapKey']).then(function (kek) { return subtle.unwrapKey('raw', ek, kek, 'AES-KW', c.gcm ? { name: 'AES-GCM' } : { name: 'HMAC', hash: 'SHA-256' }, true, c.gcm ? ['decrypt'] : ['sign']); }).then(function (k) { return subtle.exportKey('raw', k); }).then(function (r) { return new Uint8Array(r); }); });
    }
    else return Promise.reject(new Error('Unsupported JWE alg ' + alg));
    return cekPromise.then(function (cek) {
      if (cek.length * 8 !== c.bits) throw new Error((alg === 'dir' ? 'The key is ' : 'The unwrapped content key is ') + cek.length * 8 + ' bits; ' + enc + ' needs ' + c.bits + ' bits' + (alg === 'dir' ? ' (paste the key as base64url)' : '') + '.');
      if (c.gcm) return subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']).then(function (k) { return subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: aad, tagLength: 128 }, k, concat(ct, tag)); });
      var macKey = cek.slice(0, cek.length / 2), encKey = cek.slice(cek.length / 2);
      var al = new Uint8Array(8); var bits = aad.length * 8; for (var i = 7; i >= 0; i--) { al[i] = bits & 255; bits = Math.floor(bits / 256); }
      return subtle.importKey('raw', macKey, { name: 'HMAC', hash: c.hash }, false, ['sign']).then(function (mk) { return subtle.sign('HMAC', mk, concat(aad, iv, ct, al)); }).then(function (mac) {
        var expect = new Uint8Array(mac).slice(0, cek.length / 2), ok = expect.length === tag.length; for (var j = 0; j < expect.length; j++) ok = ok && expect[j] === tag[j];
        if (!ok) throw new Error('Authentication tag mismatch: wrong key or the token was altered.');
        return subtle.importKey('raw', encKey, 'AES-CBC', false, ['decrypt']).then(function (k) { return subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, ct); });
      });
    }).then(function (pt) { var text = td.decode(pt), json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } return { header: h, plaintext: text, json: json }; })
      .catch(function (e) { throw new Error(e.message || e.name || 'Decryption failed (wrong key or altered token)'); });
  }
  /** Encrypts a payload for round-trip tests: alg dir | A*KW | RSA-OAEP-256 with the given enc (GCM only). */
  function encryptJwe(payload, alg, enc, material, extraHeader) {
    var c = cekFor(enc); if (!c.gcm) return Promise.reject(new Error('This tool encrypts with AES-GCM content encryption only'));
    var h = Object.assign({ alg: alg, enc: enc }, extraHeader || {});
    var cek = new Uint8Array(c.bits / 8), iv = new Uint8Array(12);
    var text = typeof material === 'string' ? material.trim() : '';
    var jwk = material && typeof material === 'object' ? material : (/^\s*\{/.test(text) ? JSON.parse(text) : null);
    function rawSecret() { if (jwk && jwk.k) return b64uDecode(jwk.k); try { return b64uDecode(text); } catch (e) { return te.encode(text); } }
    var ekPromise;
    if (alg === 'dir') { cek = rawSecret(); ekPromise = Promise.resolve(new Uint8Array(0)); }
    else { webcrypto.getRandomValues(cek); if (/^A\d+KW$/.test(alg)) ekPromise = Promise.all([subtle.importKey('raw', rawSecret(), 'AES-KW', false, ['wrapKey']), subtle.importKey('raw', cek, 'AES-GCM', true, ['encrypt'])]).then(function (k) { return subtle.wrapKey('raw', k[1], k[0], 'AES-KW'); }).then(function (r) { return new Uint8Array(r); });
      else if (alg === 'RSA-OAEP' || alg === 'RSA-OAEP-256') { var hash = alg === 'RSA-OAEP' ? 'SHA-1' : 'SHA-256'; ekPromise = (jwk ? subtle.importKey('jwk', Object.assign({}, jwk, { alg: alg, key_ops: ['encrypt'] }), { name: 'RSA-OAEP', hash: hash }, false, ['encrypt']) : Promise.resolve().then(function () { var pb = pemBody(text); return subtle.importKey(/PRIVATE/.test(pb.label) ? 'pkcs8' : 'spki', pb.der, { name: 'RSA-OAEP', hash: hash }, false, [/PRIVATE/.test(pb.label) ? 'decrypt' : 'encrypt']); })).then(function (k) { if (k.type === 'private') throw new Error('Encryption needs the recipient public key'); return subtle.encrypt({ name: 'RSA-OAEP' }, k, cek); }).then(function (r) { return new Uint8Array(r); }); }
      else return Promise.reject(new Error('Unsupported alg for encryption: ' + alg)); }
    webcrypto.getRandomValues(iv);
    var protectedB64 = b64uText(JSON.stringify(h)), aad = te.encode(protectedB64);
    return ekPromise.then(function (ek) { return subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']).then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad, tagLength: 128 }, k, te.encode(typeof payload === 'string' ? payload : JSON.stringify(payload))); }).then(function (r) { var out = new Uint8Array(r); return protectedB64 + '.' + b64uEncode(ek) + '.' + b64uEncode(iv) + '.' + b64uEncode(out.slice(0, out.length - 16)) + '.' + b64uEncode(out.slice(out.length - 16)); }); });
  }

  return { decode: decode, lint: lint, timeline: timeline, importKey: importKey, verify: verify, sign: sign, generateKey: generateKey, decryptJwe: decryptJwe, encryptJwe: encryptJwe, SUPPORTED: SUPPORTED, ALG: ALG, b64uEncode: b64uEncode, b64uDecode: b64uDecode, b64uText: b64uText, human: human, toPem: toPem };
});
