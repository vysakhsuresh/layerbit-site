/* Layerbit service worker: makes the site installable and usable offline.
 *
 * - Page navigations go network-first (so you always get the latest page)
 *   and fall back to the cached copy, then to offline.html.
 * - Same-origin assets (css, js, fonts, images) are served from cache while
 *   a fresh copy is fetched in the background (stale-while-revalidate).
 *   Pages link css and js as file.css?v=<content hash>, so a changed file has
 *   a new URL that is fetched from the network, never served stale; the
 *   previous copy of that file is dropped when the new one is stored.
 * - Cross-origin requests (ads, analytics, Google Fonts) are never cached
 *   or touched; they pass straight through.
 * - On a 'warm' message (sent by the kernel once a day, never with Data
 *   Saver on) every tool page, its versioned scripts and styles and the
 *   WebAssembly modules are fetched into the cache, so the whole site works
 *   offline. build.py writes that list (PRECACHE) and the cache VERSION.
 * Nothing here reads request bodies or tool input. */
/* BUILD:PRECACHE:BEGIN */
var VERSION = 'lb-79fe326e54';
var PRECACHE = ["./","css/base.css?v=2b24d32e4f","css/tool.css?v=9cec66c40e","fonts/fira-code-latin-ext.woff2","fonts/fira-code-latin.woff2","fonts/space-grotesk-latin-ext.woff2","fonts/space-grotesk-latin.woff2","index.html","js/engines/batch.js?v=a7b8f5a639","js/engines/color.js?v=b352023be0","js/engines/csv.js?v=a78b81af7d","js/engines/datecalc.js?v=7bf11eac8d","js/engines/diff.js?v=9317f7d0af","js/engines/flow.js?v=e128225b7b","js/engines/hashx.js","js/engines/hashx.js?v=9f24f52b41","js/engines/json.js","js/engines/json.js?v=22c280d000","js/engines/jsonx.js?v=350f9c740a","js/engines/jwt.js?v=440f7f3df4","js/engines/lossless-json.js?v=88a67e6c17","js/engines/numbase.js?v=7dd93e0f4f","js/engines/password.js?v=4641f2f0ed","js/engines/regex.js?v=a485be8648","js/engines/stream.js","js/engines/stream.js?v=09549f4666","js/engines/tabular.js?v=729bf51eab","js/engines/tax.js?v=e6141b7889","js/engines/textcase.js?v=9c322c5711","js/engines/tz.js?v=6a76e5f6db","js/engines/xmlv.js?v=013d2c5e54","js/engines/zip.js?v=1c95003bb0","js/kernel.js?v=eb69348d32","js/md5.js?v=ac86a35839","js/shared.js?v=e2441a1728","js/ui/virtual.js?v=db3f27d059","js/vendor/JsBarcode.all.min.js?v=e307d9489a","js/vendor/ajv.min.js","js/vendor/cronstrue.min.js?v=ab14cc655f","js/vendor/diff.min.js?v=3a29bd9374","js/vendor/eff-wordlist.js?v=37e214ea8f","js/vendor/fontoxpath.min.js","js/vendor/hash-wasm.min.js","js/vendor/jmespath.min.js","js/vendor/js-yaml.min.js","js/vendor/js-yaml.min.js?v=45dc3dd03d","js/vendor/jsonquery.min.js","js/vendor/lucide.min.js?v=1e48b7de34","js/vendor/marked.umd.js?v=99634095d9","js/vendor/purify.min.js?v=c2b2880796","js/vendor/qrcode.min.js?v=c541ef0632","js/vendor/schemas/compose-spec.json","js/vendor/schemas/github-workflow.json","js/vendor/schemas/k8s-configmap.json","js/vendor/schemas/k8s-cronjob.json","js/vendor/schemas/k8s-daemonset.json","js/vendor/schemas/k8s-deployment.json","js/vendor/schemas/k8s-ingress.json","js/vendor/schemas/k8s-job.json","js/vendor/schemas/k8s-pod.json","js/vendor/schemas/k8s-secret.json","js/vendor/schemas/k8s-service.json","js/vendor/schemas/k8s-statefulset.json","js/vendor/smol-toml.min.js","js/vendor/sql-formatter.min.js","js/vendor/sql-formatter.min.js?v=8abbf85e89","js/vendor/wasm/jq.js","js/vendor/wasm/jq.wasm","js/vendor/wasm/selftest.wasm","js/vendor/xlsx.full.min.js","js/vendor/xlsx.full.min.js?v=c9506197ca","js/vendor/xmllint/index-browser.mjs","js/vendor/xmllint/xmllint-browser.mjs","js/vendor/xmllint/xmllint.wasm","js/vendor/yaml.min.js","main.js?v=8db3ffd433","manifest.json","offline.html","tools/api-automation.html","tools/app-development.html","tools/base64.html","tools/color-converter.html","tools/cron-generator.html","tools/csv-to-json.html","tools/custom-scripts.html","tools/date-calculator.html","tools/erp-development.html","tools/flow.html","tools/hash-generator.html","tools/html-escape-unescape.html","tools/json-to-table.html","tools/json-validator.html","tools/jwt-decoder.html","tools/layerlink-sharer.html","tools/layerlink-viewer.html","tools/log-analyzer.html","tools/markdown-preview.html","tools/number-base-converter.html","tools/password-generator.html","tools/pint-ae-checker.html","tools/portfolio-design.html","tools/qr-barcode.html","tools/regex-tester.html","tools/sql-formatter.html","tools/static-sites.html","tools/subnet-calculator.html","tools/text-case-converter.html","tools/text-diff-checker.html","tools/time-zone-converter.html","tools/timestamp-converter.html","tools/unicode-inspector.html","tools/url-encoder.html","tools/uuid-generator.html","tools/vat-gst-calculator.html","tools/xml-formatter.html","tools/yaml-json-converter.html"];
/* BUILD:PRECACHE:END */
var SHELL = ['./', 'index.html', 'offline.html', 'css/base.css', 'css/tool.css', 'css/article.css', 'js/kernel.js', 'js/shared.js', 'js/vendor/lucide.min.js', 'main.js', 'icon-192.png', 'icon-512.png', 'manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
// Fetch the full list into the cache, a few at a time, skipping what is
// already there; reply with how many entries the cache holds for the list.
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'warm') return;
  var src = e.source;
  e.waitUntil(caches.open(VERSION).then(function (c) {
    var queue = PRECACHE.slice(), n = 0;
    function next() {
      var u = queue.shift();
      if (!u) return Promise.resolve();
      var req = new Request(new URL(u, self.registration.scope).href);
      return c.match(req).then(function (hit) {
        if (hit) { n++; return; }
        return fetch(req).then(function (res) { if (res.ok) { n++; return store(c, req, res); } }).catch(function () { });
      }).then(next);
    }
    return Promise.all([next(), next(), next(), next()]).then(function () { if (src) src.postMessage({ type: 'warmed', count: n, total: PRECACHE.length }); });
  }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('offline.html'); });
    }));
    return;
  }
  if (/\.(css|js|png|jpg|svg|ico|woff2?|json|webmanifest|wasm)$/.test(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) store(c, req, res.clone()); return res; })
          .catch(function () { return hit || c.match(req, { ignoreSearch: true }); });
        return hit || net;
      });
    }));
  }
});

// Store a fresh asset and drop older versions of the same file (same path,
// different ?v= hash), so the cache holds one copy of each file.
function store(c, req, res) {
  var path = new URL(req.url).pathname;
  return c.keys().then(function (keys) {
    keys.forEach(function (k) { if (k.url !== req.url && new URL(k.url).pathname === path) c.delete(k); });
    return c.put(req, res);
  });
}
