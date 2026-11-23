/* Layerbit WebAssembly loader: engines compiled to WebAssembly live in
 * js/vendor/wasm/<name>.wasm and are fetched only when a tool first needs
 * them. Browser, Worker and Node (window.LBWasm / module.exports).
 *
 * load(name, imports)        -> Promise of {exports, instance, module}; one fetch per name
 * instantiate(bytes, imports) -> the same, from bytes already in memory
 * configure({base, fetch, cache})
 *
 * The bytes are kept in Cache Storage ('layerbit-wasm-v1') when the browser
 * offers it, so a module that has loaded once also loads offline. Names are
 * plain identifiers: no paths, so nothing outside js/vendor/wasm/ is loaded.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.LBWasm = factory(root);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  var CACHE = 'layerbit-wasm-v1', memo = {};
  // base: the site root, worked out from this script's own URL in a page
  var cfg = { base: null, fetch: null, cache: true };
  function guessBase() {
    try {
      var cur = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
      if (cur) return cur.replace(/js\/engines\/wasm\.js(\?.*)?$/, '');
      if (G.location) return new URL('/', G.location.href).href;
    } catch (e) { /* fall through */ }
    return '/';
  }
  var scriptBase = guessBase();

  function instantiate(bytes, imports) {
    return WebAssembly.instantiate(bytes, imports || {}).then(function (r) { return { exports: r.instance.exports, instance: r.instance, module: r.module }; });
  }
  function getBytes(url) {
    var f = cfg.fetch || (G.fetch && G.fetch.bind(G));
    var net = function () {
      return f(url).then(function (res) {
        if (!res.ok) throw new Error('Could not load the WebAssembly module ' + url.split('/').pop() + ' (HTTP ' + res.status + ')');
        return res.arrayBuffer().then(function (buf) {
          if (useCache()) G.caches.open(CACHE).then(function (c) { return c.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/wasm' } })); }).catch(function () { });
          return buf;
        });
      });
    };
    if (!useCache()) return net();
    return G.caches.open(CACHE).then(function (c) { return c.match(url); }).then(function (hit) { return hit ? hit.arrayBuffer() : net(); }, net);
  }
  function useCache() { return cfg.cache !== false && !!G.caches && typeof Response !== 'undefined'; }

  function load(name, imports) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(name))) throw new Error('A WebAssembly module name must be a plain identifier, not a path: ' + name);
    if (memo[name]) return memo[name];
    var url = (cfg.base || scriptBase) + 'js/vendor/wasm/' + name + '.wasm';
    var p = getBytes(url).then(function (buf) { return instantiate(buf, imports); });
    memo[name] = p;
    p.catch(function () { delete memo[name]; });
    return p;
  }
  function configure(o) { Object.keys(o || {}).forEach(function (k) { cfg[k] = o[k]; }); memo = {}; }

  return { load: load, instantiate: instantiate, configure: configure, CACHE: CACHE };
});
