/* Layerbit service worker: makes the site installable and usable offline.
 *
 * - Page navigations go network-first (so you always get the latest page)
 *   and fall back to the cached copy, then to offline.html.
 * - Same-origin assets (css, js, fonts, images) are served from cache while
 *   a fresh copy is fetched in the background (stale-while-revalidate).
 * - Cross-origin requests (ads, analytics, Google Fonts) are never cached
 *   or touched; they pass straight through.
 * Nothing here reads request bodies or tool input. */
var VERSION = 'lb-2026-10-17b';
var SHELL = ['./', 'index.html', 'offline.html', 'css/base.css', 'css/tool.css', 'css/article.css', 'js/kernel.js', 'js/shared.js', 'js/vendor/lucide.min.js', 'main.js', 'layerbit-logo.png', 'icon-192.png', 'icon-512.png', 'manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
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
  if (/\.(css|js|png|jpg|svg|ico|woff2?|json|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
