/* Layerbit batch: run one operation over many files (or any items) and
 * produce a report. Browser (window.LBBatch), Worker and Node; the folder
 * helpers at the bottom need a browser.
 *
 * run(items, fn(item, index) -> Promise, {concurrency, signal, onProgress})
 *     -> Promise of [{item, ok, value | error, ms}] in input order. A failing
 *     item is recorded and the rest still run; an aborted batch starts no
 *     new items and rejects with an AbortError.
 * report(results, {title, options, generated, columns: [{label, get(result)}]})
 *     -> {csv, html}; both start with the title, the options and the date,
 *     add a Status column, escape HTML and guard spreadsheet formulas.
 * archive(files) -> zip bytes ([{name, data}]), via LBZip.
 * fromFileList(fileList) / fromDrop(dataTransfer) -> Promise of [{path, file}]
 *     (folders picked with webkitdirectory, or dropped folders, walked).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./csv.js'), require('./zip.js'));
  else root.LBBatch = factory(root.LBCsv, root.LBZip);
})(typeof self !== 'undefined' ? self : this, function (CSV, Z) {
  'use strict';
  function abortError() { var e = new Error('The batch was cancelled.'); e.name = 'AbortError'; return e; }

  function run(items, fn, opts) {
    opts = opts || {};
    var n = items.length, results = new Array(n), next = 0, done = 0, limit = Math.max(1, opts.concurrency || 4), aborted = false;
    var now = function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };
    return new Promise(function (resolve, reject) {
      if (!n) { resolve([]); return; }
      function startOne() {
        if (aborted) return;
        if (opts.signal && opts.signal.aborted) { aborted = true; reject(abortError()); return; }
        if (next >= n) return;
        var i = next++, t0 = now();
        Promise.resolve().then(function () { return fn(items[i], i); }).then(function (v) {
          results[i] = { item: items[i], ok: true, value: v, ms: now() - t0 };
        }, function (e) {
          results[i] = { item: items[i], ok: false, error: e && e.message ? e.message : String(e), ms: now() - t0 };
        }).then(function () {
          if (aborted) return;
          done++;
          if (opts.onProgress) opts.onProgress(done, n);
          if (done === n) resolve(results); else startOne();
        });
      }
      for (var k = 0; k < Math.min(limit, n); k++) startOne();
    });
  }

  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function report(results, o) {
    o = o || {};
    var cols = (o.columns || []).concat([{ label: 'Status', get: function (r) { return r.ok ? 'ok' : 'error: ' + r.error; } }]);
    var generated = o.generated || new Date().toISOString(), title = o.title || 'Layerbit batch report';
    var rows = results.map(function (r) { return cols.map(function (c) { var v = c.get(r); return v == null ? '' : v; }); });
    var csv = CSV.line(['Report', title]) + CSV.line(['Generated', generated]) + CSV.line(['Options', o.options || '']) + '\r\n' +
      CSV.line(cols.map(function (c) { return c.label; })) + rows.map(function (r) { return CSV.line(r, { safe: true }); }).join('');
    var ok = results.filter(function (r) { return r.ok; }).length;
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escHtml(title) + '</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;font-size:.9em}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #ddd;font-family:ui-monospace,monospace}th{background:#f4f4f5}.meta{color:#555;margin-bottom:16px}.err{color:#b91c1c}</style></head><body>' +
      '<h1>' + escHtml(title) + '</h1><div class="meta">Generated ' + escHtml(generated) + '<br>Options: ' + escHtml(o.options || 'none') + '<br>' + ok + ' of ' + results.length + ' succeeded</div>' +
      '<table><thead><tr>' + cols.map(function (c) { return '<th>' + escHtml(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, i) { return '<tr' + (results[i].ok ? '' : ' class="err"') + '>' + r.map(function (v) { return '<td>' + escHtml(v) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></body></html>';
    return { csv: csv, html: html };
  }

  function archive(files) { return Z.zipStore(files); }

  // ---- browser: folders from an <input webkitdirectory> or a drop
  function fromFileList(list) {
    return Promise.resolve(Array.prototype.map.call(list, function (f) { return { path: f.webkitRelativePath || f.name, file: f }; }));
  }
  function fromDrop(dt) {
    var out = [], walks = [];
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    function walk(entry, prefix) {
      if (entry.isFile) return new Promise(function (res) { entry.file(function (f) { out.push({ path: prefix + entry.name, file: f }); res(); }, function () { res(); }); });
      if (!entry.isDirectory) return Promise.resolve();
      var reader = entry.createReader(), all = [];
      return new Promise(function (res) {
        (function readMore() {
          reader.readEntries(function (batch) {
            if (!batch.length) { Promise.all(all.map(function (e) { return walk(e, prefix + entry.name + '/'); })).then(res); return; }
            all = all.concat(Array.prototype.slice.call(batch)); readMore();
          }, function () { res(); });
        })();
      });
    }
    items.forEach(function (it) { var e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) walks.push(walk(e, '')); });
    if (!walks.length && dt.files) return fromFileList(dt.files);
    return Promise.all(walks).then(function () { return out; });
  }

  return { run: run, report: report, archive: archive, fromFileList: fromFileList, fromDrop: fromDrop };
});
