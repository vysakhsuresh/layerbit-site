/* Layerbit regex engines: run a pattern on the real engine of another
 * language, compiled to WebAssembly, so matches are exact for that language.
 * Browser only (window.LBRxEngines); every engine loads on first use.
 *
 * ENGINES[id] = { name, lang, version, replaceSyntax, notes, load() }
 * find(id, pattern, flags, text, all) -> Promise<{ok, error, matches: [{index, m: [whole, g1, ...], named}]}>
 *   flags: any of 'i', 'm', 's', 'x', 'u' (other letters are ignored); index and group
 *   values are in JavaScript string (UTF-16) terms whatever the engine counts in.
 * replace(id, pattern, flags, text, replacement, all) -> Promise<{ok, error, text}>
 * UNAVAILABLE: engines with no browser build, and why.
 */
(function (root) {
  'use strict';
  var VENDOR = '../js/vendor/';
  var te = new TextEncoder(), td = new TextDecoder();

  function script(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src.split('/').pop())); }; document.head.appendChild(s); }); }
  function once(fn) { var p = null; return function () { return p || (p = fn().catch(function (e) { p = null; throw e; })); }; }

  // UTF-8 byte offset -> UTF-16 index, and code point index -> UTF-16 index
  function byteMap(text) {
    var bytes = te.encode(text), map = new Int32Array(bytes.length + 1), b = 0, u = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.codePointAt(i), n = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4, w = c > 0xffff ? 2 : 1;
      for (var k = 0; k < n; k++) map[b + k] = u;
      b += n; u += w; if (w === 2) i++;
    }
    map[b] = u;
    return map;
  }
  function cpMap(text) { var map = [], u = 0; for (var i = 0; i < text.length; i++) { map.push(u); var c = text.codePointAt(i); if (c > 0xffff) { i++; u += 2; } else u++; } map.push(u); return map; }
  function fromSpans(text, res, map) {
    if (!res.ok) return res;
    var names = res.names || [];
    return { ok: true, matches: res.matches.map(function (spans) {
      var m = spans.map(function (s) { return s ? text.slice(map[s[0]], map[s[1]]) : undefined; }), named = null;
      names.forEach(function (n, i) { if (n) { named = named || {}; named[n] = m[i]; } });
      return { index: map[spans[0][0]], m: m, named: named };
    }) };
  }
  var has = function (f, c) { return f.indexOf(c) >= 0; };

  // ------------------------------------------------------------ PCRE2
  var pcre = once(function () { return script(VENDOR + 'pcre2.min.js').then(function () { return root.LBPcre2.create(); }); });
  function pcreFlags(f) { var F = root.LBPcre2.FLAGS, v = 0; if (has(f, 'i')) v |= F.CASELESS; if (has(f, 'm')) v |= F.MULTILINE; if (has(f, 's')) v |= F.DOTALL; if (has(f, 'x')) v |= F.EXTENDED; if (has(f, 'u')) v |= F.UTF | F.UCP; else v |= F.UTF; return v; }

  // ------------------------------------------------------------ Rust
  var rust = once(function () {
    return fetch(VENDOR + 'wasm/regex-rust.wasm').then(function (r) { if (!r.ok) throw new Error('Could not load the Rust engine'); return r.arrayBuffer(); })
      .then(function (b) { return WebAssembly.instantiate(b, {}); }).then(function (x) { return x.instance.exports; });
  });
  function rustCall(ex, fn, strs, nums) {
    var ptrs = strs.map(function (s) { var u = te.encode(s), p = ex.alloc(u.length); new Uint8Array(ex.memory.buffer, p, u.length).set(u); return [p, u.length]; });
    var args = [ptrs[0][0], ptrs[0][1], nums[0], ptrs[1][0], ptrs[1][1]];
    if (fn === 'find_all') args.push(nums[1]); else args.push(ptrs[2][0], ptrs[2][1]);
    ex[fn].apply(null, args);
    var out = JSON.parse(td.decode(new Uint8Array(ex.memory.buffer, ex.out_ptr(), ex.out_len())));
    ptrs.forEach(function (p) { ex.dealloc(p[0], p[1]); });
    return out;
  }
  function rustFlags(f) { return (has(f, 'i') ? 1 : 0) | (has(f, 'm') ? 2 : 0) | (has(f, 's') ? 4 : 0) | (has(f, 'x') ? 8 : 0); }

  // ------------------------------------------------------------ Go
  var go = once(function () {
    return script(VENDOR + 'go-wasm-exec.js').then(function () {
      var g = new root.Go();
      return fetch(VENDOR + 'wasm/regex-go.wasm').then(function (r) { if (!r.ok) throw new Error('Could not load the Go engine'); return r.arrayBuffer(); })
        .then(function (b) { return WebAssembly.instantiate(b, g.importObject); }).then(function (x) { g.run(x.instance); return root.lbGoRegex; });
    });
  });
  function goFlags(f) { return ['i', 'm', 's'].filter(function (c) { return has(f, c); }).join(''); }

  // ------------------------------------------------------------ Python (CPython via Pyodide)
  var PY = [
    'import re, json',
    'def lb_flags(f):',
    '    v = 0',
    '    for c, b in (("i", re.I), ("m", re.M), ("s", re.S), ("x", re.X)):',
    '        if c in f: v |= b',
    '    return v',
    'def lb_find(p, f, t, n):',
    '    try: r = re.compile(p, lb_flags(f))',
    '    except re.error as e: return json.dumps({"ok": False, "error": str(e)})',
    '    out = []',
    '    for m in r.finditer(t):',
    '        out.append([list(m.span(i)) if m.span(i)[0] >= 0 else None for i in range(r.groups + 1)])',
    '        if len(out) >= n: break',
    '    names = [None] * (r.groups + 1)',
    '    for k, i in r.groupindex.items(): names[i] = k',
    '    return json.dumps({"ok": True, "names": names, "matches": out})',
    'def lb_sub(p, f, t, rep, n):',
    '    try: return json.dumps({"ok": True, "text": re.compile(p, lb_flags(f)).sub(rep, t, count=0 if n else 1)})',
    '    except (re.error, IndexError) as e: return json.dumps({"ok": False, "error": str(e)})'
  ].join('\n');
  var python = once(function () {
    return script(VENDOR + 'pyodide/pyodide.js').then(function () { return root.loadPyodide({ indexURL: new URL(VENDOR + 'pyodide/', location.href).href }); })
      .then(function (py) { py.runPython(PY); return { find: py.globals.get('lb_find'), sub: py.globals.get('lb_sub'), version: py.runPython('import sys; sys.version.split()[0]') }; });
  });

  // ------------------------------------------------------------ Oniguruma
  var onig = once(function () {
    return script(VENDOR + 'onig/onig.js').then(function () { return fetch(VENDOR + 'onig/onig.wasm'); }).then(function (r) { if (!r.ok) throw new Error('Could not load Oniguruma'); return r.arrayBuffer(); })
      .then(function (b) { return root.onig.loadWASM(b); }).then(function () { return root.onig; });
  });
  // Ruby-style options: (?i) case, (?m) makes . match newlines, (?x) extended; ^ and $ always match at lines
  function onigPrefix(f) { var o = (has(f, 'i') ? 'i' : '') + (has(f, 's') ? 'm' : '') + (has(f, 'x') ? 'x' : ''); return o ? '(?' + o + ')' : ''; }

  var ENGINES = {
    js: { name: 'JavaScript', lang: 'JavaScript, TypeScript (this browser\'s engine)', replaceSyntax: '$1, $<name>, $&', load: function () { return Promise.resolve(); } },
    pcre2: { name: 'PCRE2 10.49', lang: 'PHP (preg_*), R, nginx, Apache, grep -P', replaceSyntax: '$1, ${1}, ${name}', load: pcre },
    python: { name: 'Python re', lang: 'Python 3.14 (CPython\'s own re module, through Pyodide; about 13 MB on first use)', replaceSyntax: '\\1, \\g<1>, \\g<name>', load: python },
    go: { name: 'Go regexp', lang: 'Go (the standard library\'s RE2-syntax engine, Go 1.24)', replaceSyntax: '$1, ${1}, ${name}', load: go },
    rust: { name: 'Rust regex', lang: 'Rust (the regex crate 1.13)', replaceSyntax: '$1, ${1}, ${name}', load: rust },
    onig: { name: 'Oniguruma', lang: 'TextMate grammars, PHP mb_ereg; Ruby uses Onigmo, a fork, so Ruby-only syntax can differ', replaceSyntax: '(replace preview not available)', load: onig }
  };
  var UNAVAILABLE = { java: 'Java (java.util.regex) has no WebAssembly build that runs in a browser page.', dotnet: '.NET (System.Text.RegularExpressions) needs the whole .NET runtime in the browser, about 30 MB.' };

  function find(id, pattern, flags, text, all) {
    var limit = all ? 100000 : 1;
    return ENGINES[id].load().then(function (E) {
      if (id === 'js') {
        var f = ['i', 'm', 's', 'u'].filter(function (c) { return has(flags, c); }).join('') + 'g', re;
        try { re = new RegExp(pattern, f); } catch (e) { return { ok: false, error: e.message }; }
        var out = [], m;
        while ((m = re.exec(text)) && out.length < limit) { out.push({ index: m.index, m: Array.from(m), named: m.groups ? Object.assign({}, m.groups) : null }); if (m[0] === '') re.lastIndex++; }
        return { ok: true, matches: out };
      }
      if (id === 'pcre2') {
        var rx;
        try { rx = E.compile(pattern, pcreFlags(flags)); } catch (e) { return { ok: false, error: e.message.replace(/^PCRE2 compile error/, 'Compile error') }; }
        try { var r = rx.matchAll(text).slice(0, limit); return { ok: true, matches: r.map(function (x) { var named = x.namedGroups && Object.keys(x.namedGroups).length ? x.namedGroups : null; return { index: x.index, m: [x.match].concat(x.groups.map(function (g) { return g === null ? undefined : g; })), named: named }; }) }; }
        catch (e) { return { ok: false, error: e.message }; } finally { rx.destroy(); }
      }
      if (id === 'rust') return fromSpans(text, rustCall(E, 'find_all', [pattern, text], [rustFlags(flags), limit]), byteMap(text));
      if (id === 'go') return fromSpans(text, JSON.parse(E.findAll(pattern, goFlags(flags), text, all ? -1 : 1)), byteMap(text));
      if (id === 'python') return fromSpans(text, JSON.parse(E.find(pattern, flags, text, limit)), cpMap(text));
      if (id === 'onig') {
        var sc;
        try { sc = new E.OnigScanner([onigPrefix(flags) + pattern]); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
        var os = new E.OnigString(text), res = [], pos = 0;
        try {
          while (pos <= text.length && res.length < limit) {
            var hit = sc.findNextMatchSync(os, pos); if (!hit) break;
            var c = hit.captureIndices, whole = c[0];
            res.push({ index: whole.start, m: c.map(function (g) { return g.start < 0 || g.end < 0 ? undefined : text.slice(g.start, g.end); }), named: null });
            pos = whole.end > whole.start ? whole.end : whole.end + 1;
          }
        } finally { os.dispose(); sc.dispose(); }
        return { ok: true, matches: res };
      }
    });
  }
  function replace(id, pattern, flags, text, rep, all) {
    return ENGINES[id].load().then(function (E) {
      if (id === 'js') { try { return { ok: true, text: text.replace(new RegExp(pattern, ['i', 'm', 's', 'u'].filter(function (c) { return has(flags, c); }).join('') + (all ? 'g' : '')), rep) }; } catch (e) { return { ok: false, error: e.message }; } }
      if (id === 'pcre2') { try { return { ok: true, text: all ? E.replaceAll(pattern, text, rep, pcreFlags(flags)) : E.replace(pattern, text, rep, pcreFlags(flags)) }; } catch (e) { return { ok: false, error: e.message }; } }
      if (id === 'rust') { if (!all) return { ok: false, error: 'This preview replaces every match for Rust.' }; return rustCall(E, 'replace_all', [pattern, text, rep], [rustFlags(flags)]); }
      if (id === 'go') return JSON.parse(E.replaceAll(pattern, goFlags(flags), text, rep));
      if (id === 'python') return JSON.parse(E.sub(pattern, flags, text, rep, all ? 1 : 0));
      return { ok: false, error: 'Oniguruma has no replace function in this build.' };
    });
  }
  root.LBRxEngines = { ENGINES: ENGINES, UNAVAILABLE: UNAVAILABLE, find: find, replace: replace };
})(typeof self !== 'undefined' ? self : this);
