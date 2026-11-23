/* Layerbit kernel: the shared runtime every page loads after base.css.
 *
 * It gives each tool, without any page-specific code, five things:
 *   - a command palette (Ctrl/Cmd+K, or the button in the header) that
 *     searches every tool and guide and lists what you ran recently;
 *   - shareable links: the tool's input and options are deflate-compressed
 *     into the URL fragment, which browsers never send to the server, so a
 *     link carries the work without the work ever leaving the browser;
 *   - "send to": any tool's output can be handed to any other tool;
 *   - drop-anywhere file loading and a local run history (IndexedDB, on
 *     this device only, clearable from the palette);
 *   - a live privacy indicator that counts network requests made by the
 *     page's own code, so "runs locally" is something you can see.
 *
 * A tool opts in by defining window.LB_TOOL before this script runs:
 *   { slug, input(text, name), getState(), setState(obj), run() }
 * Pages that define nothing still get the palette, the privacy pill,
 * shareable links for the first textarea, and drop-to-load.
 */
(function () {
  'use strict';
  if (window.Layerbit) return;

  // ------------------------------------------------------------------ registry
  // Every indexable tool and guide, so the palette and "send to" menu work on
  // any page without a network request. scripts/validate.py checks that this
  // list and src/pages/ agree.
  var TOOLS = [
    ['json-validator', 'JSON Formatter & Validator', 'json format validate minify tree jsonpath schema types fix', ['json', 'text']],
    ['text-diff-checker', 'Text Diff Checker & Merge Tool', 'diff compare merge patch three-way structural', ['text', 'json', 'csv']],
    ['regex-tester', 'Regex Tester & Debugger', 'regex regular expression match replace explain redos', ['text']],
    ['jwt-decoder', 'JWT Decoder & Verifier', 'jwt token sign verify jwk jwe claims', ['jwt', 'text']],
    ['flow', 'Flow: Data Pipeline Builder', 'pipeline recipe chain decode transform hash magic cyberchef', ['text', 'json', 'csv', 'base64', 'jwt', 'url']],
    ['sql-formatter', 'SQL Formatter & Beautifier', 'sql format beautify mysql postgres tsql', ['sql', 'text']],
    ['base64', 'Base64 Encoder & Decoder', 'base64 encode decode file', ['text', 'base64']],
    ['url-encoder', 'URL Encoder & Decoder', 'url percent encoding query string', ['text', 'url']],
    ['html-escape-unescape', 'HTML Escape & Unescape', 'html entities escape unescape', ['text', 'html']],
    ['hash-generator', 'Hash & HMAC Generator', 'sha256 sha512 md5 hmac checksum', ['text']],
    ['json-to-table', 'JSON to Table Viewer', 'json table csv export sort filter', ['json']],
    ['csv-to-json', 'CSV to JSON Converter', 'csv json convert delimiter', ['csv', 'json']],
    ['yaml-json-converter', 'YAML ⇄ JSON Converter', 'yaml json convert', ['yaml', 'json']],
    ['xml-formatter', 'XML Formatter & XPath Tester', 'xml format xpath validate', ['xml', 'text']],
    ['cron-generator', 'Cron Expression Generator', 'cron schedule crontab', ['text']],
    ['timestamp-converter', 'Unix Timestamp Converter', 'epoch timestamp date time zone iso 8601', ['text']],
    ['date-calculator', 'Date & Age Calculator', 'date days between dates add days working days business days age calculator birthday week number', ['text']],
    ['time-zone-converter', 'Time Zone Converter', 'time zone timezone convert world clock meeting planner ist est gst pst bst gmt utc dubai india uk us', ['text']],
    ['uuid-generator', 'UUID & ULID Generator', 'uuid guid ulid v4 v7', ['text']],
    ['subnet-calculator', 'CIDR & Subnet Calculator', 'subnet cidr ip ipv4 ipv6 mask', ['text']],
    ['unicode-inspector', 'Unicode & Invisible Character Inspector', 'unicode invisible zero-width code point utf-8', ['text']],
    ['log-analyzer', 'Log File Analyzer', 'log errors warnings filter', ['text']],
    ['qr-barcode', 'QR Code & Barcode Generator', 'qr code barcode ean svg upi payment wifi whatsapp', ['text', 'url']],
    ['password-generator', 'Strong Password Generator', 'password passphrase diceware pin random strength entropy', ['text']],
    ['color-converter', 'Color Converter & Contrast Checker', 'color colour hex rgb hsl oklch contrast wcag apca palette', ['text']],
    ['number-base-converter', 'Number Base Converter', 'binary hex decimal octal base twos complement bits bytes float ieee', ['text']],
    ['text-case-converter', 'Text Case Converter & Word Counter', 'camelcase snake_case kebab title case word count characters slug', ['text']],
    ['markdown-preview', 'Markdown Editor & Preview', 'markdown md preview html gfm readme', ['text']],
    ['vat-gst-calculator', 'VAT & GST Calculator', 'vat gst tax calculator uae 5% saudi 15% india cgst sgst igst invoice amount in words', ['text']],
    ['pint-ae-checker', 'UAE PINT-AE E-Invoice Checker', 'uae invoice pint ubl compliance', ['xml']],
    ['layerlink-sharer', 'LayerLink Screen Sharing', 'screen share remote', []],
    ['layerlink-viewer', 'LayerLink Viewer', 'screen share viewer', []]
  ];
  var GUIDES = [
    ['how-to-create-a-strong-password', 'Strong passwords: length beats symbols'],
    ['wcag-color-contrast-explained', 'WCAG color contrast explained'],
    ['twos-complement-explained', "Two's complement explained"],
    ['naming-conventions-camelcase-snake-case', 'Naming conventions by language'],
    ['markdown-cheat-sheet', 'Markdown cheat sheet'],
    ['json-syntax-errors-explained', 'JSON syntax errors explained'],
    ['json-schema-validation-explained', 'JSON Schema validation explained'],
    ['jsonpath-cheat-sheet', 'JSONPath cheat sheet'],
    ['three-way-merge-explained', 'Three-way merge explained'],
    ['jwt-signing-algorithms-compared', 'JWT signing algorithms compared'],
    ['jwt-decode-vs-verify', 'Decoding a JWT is not verifying it'],
    ['regex-catastrophic-backtracking', 'Regex catastrophic backtracking'],
    ['base64-explained', 'What Base64 actually does'],
    ['percent-encoding-explained', 'URL encoding explained'],
    ['html-escaping-and-xss-contexts', 'HTML escaping and XSS contexts'],
    ['hashing-vs-encryption-vs-encoding', 'Hashing vs encryption vs encoding'],
    ['csv-edge-cases', 'Why CSV is not really a format'],
    ['yaml-gotchas', "YAML's sharpest edges"],
    ['sql-formatting-and-dialects', 'SQL dialects compared'],
    ['cron-expressions-explained', 'Cron expression rules'],
    ['unix-time-and-time-zones', 'Unix time and time zones'],
    ['uuid-v4-vs-v7-database-keys', 'UUID v4 vs v7 for database keys'],
    ['subnetting-explained', 'Subnetting explained'],
    ['invisible-unicode-characters', 'Invisible Unicode characters'],
    ['xpath-cheat-sheet', 'XPath cheat sheet'],
    ['uae-einvoicing-pint-ae', 'UAE e-invoicing: PINT-AE']
  ];
  var SERVICES = [
    ['erp-development', 'Custom ERP development'],
    ['api-automation', 'API integration & automation'],
    ['app-development', 'Mobile app development'],
    ['custom-scripts', 'Custom scripts & automation'],
    ['static-sites', 'Static website engineering'],
    ['portfolio-design', 'Portfolio website design']
  ];

  var depth = location.pathname.split('/').filter(Boolean).length - (location.pathname.endsWith('/') ? 0 : 1);
  var PREFIX = '../'.repeat(Math.max(0, depth));
  var m = location.pathname.match(/\/tools\/([a-z0-9-]+)\.html$/);
  var SLUG = m ? m[1] : null;
  var TOOL = window.LB_TOOL || null;

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function icons(root) { if (window.lucide) try { lucide.createIcons({ nameAttr: 'data-lucide', attrs: {} }); } catch (e) { /* ignore */ } }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // --------------------------------------------------------------------- toast
  var toastTimer = null;
  // action: optional { label, fn } shown as a button in the toast (e.g. Undo).
  function toast(msg, kind, action) {
    var t = document.getElementById('lbToast');
    if (!t) { t = el('div', { id: 'lbToast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
    t.textContent = msg;
    if (action) {
      var b = el('button', { type: 'button', class: 'lb-toast-action', text: action.label });
      b.addEventListener('click', function () { t.className = ''; action.fn(); });
      t.appendChild(b);
    }
    t.className = 'show' + (kind ? ' ' + kind : '') + (action ? ' has-action' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, action ? 6000 : 2600);
  }

  // ----------------------------------------------------------------- URL state
  // Fragment format: #s=z:<base64url(deflate-raw(json))> or #s=j:<base64url(json)>.
  // The fragment is never sent in an HTTP request, so a share link is a
  // container for the work, not a copy of it on a server.
  function b64uEncode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function streamBytes(bytes, Ctor, fmt) {
    var st = new Ctor(fmt);
    var w = st.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(st.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function encodeState(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      return streamBytes(bytes, CompressionStream, 'deflate-raw').then(function (z) { return 'z:' + b64uEncode(z); });
    }
    return Promise.resolve('j:' + b64uEncode(bytes));
  }
  function decodeState(str) {
    if (!str) return Promise.resolve(null);
    var kind = str.slice(0, 2), body = str.slice(2);
    try {
      var bytes = b64uDecode(body);
      if (kind === 'z:') {
        if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('This browser cannot open compressed links'));
        return streamBytes(bytes, DecompressionStream, 'deflate-raw').then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
      }
      if (kind === 'j:') return Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(null);
  }
  function readFragment() {
    var h = location.hash;
    var mm = /[#&]s=([^&]+)/.exec(h);
    return mm ? decodeURIComponent(mm[1]) : null;
  }
  var state = {
    encode: encodeState,
    decode: decodeState,
    read: function () { return decodeState(readFragment()).catch(function () { return null; }); },
    write: function (obj) {
      return encodeState(obj).then(function (s) {
        var url = location.pathname + location.search + '#s=' + s;
        history.replaceState(null, '', url);
        return location.origin + url;
      });
    },
    clear: function () { if (location.hash) history.replaceState(null, '', location.pathname + location.search); },
    share: function (obj) {
      if (obj === undefined) obj = currentState();
      if (!obj) { toast('Nothing to share yet'); return Promise.resolve(null); }
      return state.write(obj).then(function (url) {
        if (url.length > 60000) { toast('Input is too large for a link (' + Math.round(url.length / 1024) + ' KB). Download or copy it instead.', 'warn'); return url; }
        return copy(url).then(function () { toast('Link copied. The input lives in the #fragment, which is never sent to a server.'); return url; });
      });
    }
  };
  function currentState() {
    if (TOOL && TOOL.getState) { try { return TOOL.getState(); } catch (e) { return null; } }
    var ta = firstTextarea();
    return ta && ta.value ? { input: ta.value } : null;
  }
  function firstTextarea() {
    var list = document.querySelectorAll('textarea');
    for (var i = 0; i < list.length; i++) if (list[i].offsetParent !== null) return list[i];
    return list[0] || null;
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function applyIncomingState() {
    var frag = readFragment();
    if (!frag) return;
    decodeState(frag).then(function (obj) {
      if (!obj) return;
      if (TOOL && TOOL.setState) { TOOL.setState(obj); }
      else if (typeof obj.input === 'string') {
        if (TOOL && TOOL.input) TOOL.input(obj.input, obj.name || '');
        else { var ta = firstTextarea(); if (ta) { ta.value = obj.input; ta.dispatchEvent(new Event('input', { bubbles: true })); } }
      }
      if (obj.input && obj.from) toast('Loaded from ' + obj.from);
    }).catch(function (e) { toast('Could not open the shared link: ' + e.message, 'warn'); });
  }

  // ------------------------------------------------------------------- history
  // IndexedDB 'layerbit' / store 'runs': {slug, ts, label, data}.
  // Saving is opt-in per tool: a "Save to history" switch (off by default,
  // remembered per tool in localStorage) and, with it on, only an explicit run
  // is written: the tool's primary button, Ctrl+Enter, or the "Save run"
  // button live tools show. Tools report their latest state with
  // history.push as they run; typing alone never writes anything.
  var DB_NAME = 'layerbit', STORE = 'runs', MAX_PER_TOOL = 50;
  function openDb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        var s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('slug', 'slug'); s.createIndex('ts', 'ts');
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var lastPush = {}, pending = {}, explicitAt = 0, undoShown = {};
  var OLD_SWITCH = { 'text-diff-checker': 'lb-diff-save-history' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  // An explicit run (primary button, Ctrl+Enter, Save run) lets the next
  // push within 2 s be written; asynchronous tools pass {explicit: true}.
  function markExplicit() { explicitAt = Date.now(); }
  function takeExplicit() { var ok = explicitAt && Date.now() - explicitAt < 2000; explicitAt = 0; return ok; }
  function commit(slug, entry) {
    var key = JSON.stringify(entry.data);
    if (lastPush[slug] === key || key.length > 2000000) return Promise.resolve(null);
    lastPush[slug] = key;
    return history_.list(slug, MAX_PER_TOOL + 5).then(function (rows) {
      return tx('readwrite', function (s) {
        rows.slice(MAX_PER_TOOL - 1).forEach(function (r) { s.delete(r.id); });
        return s.add({ slug: slug, ts: Date.now(), label: (entry.label || '').slice(0, 120), data: entry.data });
      });
    }).then(function (id) {
      if (id != null && !undoShown[slug]) {
        undoShown[slug] = true;
        toast('Saved to history on this device', null, { label: 'Undo', fn: function () { history_.remove(id); lastPush[slug] = null; } });
      }
      return id;
    }).catch(function () { return null; /* storage blocked: history is a convenience */ });
  }
  var history_ = {
    enabled: function (slug) {
      slug = slug || SLUG;
      var v = lsGet('lb-history-on:' + slug);
      if (v == null && OLD_SWITCH[slug]) v = lsGet(OLD_SWITCH[slug]);
      return v === '1';
    },
    setEnabled: function (slug, on) {
      slug = slug || SLUG;
      lsSet('lb-history-on:' + slug, on ? '1' : '0');
      if (OLD_SWITCH[slug]) lsSet(OLD_SWITCH[slug], on ? '1' : '0');
      syncSwitches();
    },
    // Records the tool's current state. It is written only when the switch is
    // on and this push follows an explicit run (or opts.explicit is set).
    push: function (slug, data, label, opts) {
      slug = slug || SLUG; if (!slug || !data) return Promise.resolve(null);
      pending[slug] = { data: data, label: label };
      if (!history_.enabled(slug)) { explicitAt = 0; return Promise.resolve(null); }
      if (!((opts && opts.explicit) || takeExplicit())) return Promise.resolve(null);
      return commit(slug, pending[slug]);
    },
    // Save run: writes the tool's latest state now (switch must be on).
    saveNow: function (slug) {
      slug = slug || SLUG;
      if (!history_.enabled(slug)) return Promise.resolve(null);
      if (!pending[slug]) { toast('Run the tool first, then save'); return Promise.resolve(null); }
      return commit(slug, pending[slug]);
    },
    remove: function (id) { return tx('readwrite', function (s) { s.delete(id); }).then(function () { toast('Removed from history'); }).catch(function () { }); },
    list: function (slug, n) {
      return openDb().then(function (db) {
        return new Promise(function (res, rej) {
          var out = [], idx = db.transaction(STORE).objectStore(STORE).index('ts');
          var req = idx.openCursor(null, 'prev');
          req.onsuccess = function () {
            var c = req.result;
            if (!c || out.length >= (n || 20)) return res(out);
            if (!slug || c.value.slug === slug) out.push(c.value);
            c.continue();
          };
          req.onerror = function () { rej(req.error); };
        });
      }).catch(function () { return []; });
    },
    clear: function () { return tx('readwrite', function (s) { s.clear(); }).then(function () { lastPush = {}; toast('History cleared on this device'); }).catch(function () { }); }
  };

  // Before the switch existed, some tools saved every run silently (a pasted
  // JWT, for one). Delete those once; the Diff Checker's runs were already
  // saved only behind its own switch, so they are kept.
  function purgeSilentRuns() {
    if (lsGet('lb-history-v2') || !window.indexedDB) return;
    var done = function () { lsSet('lb-history-v2', '1'); };
    tx('readwrite', function (s) {
      var req = s.openCursor();
      req.onsuccess = function () { var c = req.result; if (!c) return; if (c.value.slug !== 'text-diff-checker') c.delete(); c.continue(); };
    }).then(done, done);
  }

  // Switch UI: pages mark where it goes with [data-lb-history-slot]
  // (data-live adds a "Save run" button for tools that run as you type), or
  // provide their own input[data-lb-history-switch].
  function syncSwitches() {
    var on = history_.enabled(SLUG);
    document.querySelectorAll('input[data-lb-history-switch]').forEach(function (i) { i.checked = on; });
    document.querySelectorAll('[data-lb-history-save]').forEach(function (b) { b.hidden = !on; });
  }
  function installHistorySwitches() {
    document.querySelectorAll('[data-lb-history-slot]').forEach(function (slot) {
      if (slot.querySelector('input[data-lb-history-switch]')) return;
      var tip = 'Off: nothing is stored. On: each run you start (the run button, Ctrl+Enter or Save run) is kept in this browser so you can reopen it with Ctrl+H. Typing alone is never saved.';
      var lab = el('label', { class: 'toggle-label lb-history-switch', title: tip, html: '<input type="checkbox" data-lb-history-switch> Save to history' });
      slot.appendChild(lab);
      if (slot.hasAttribute('data-live')) {
        var b = el('button', { type: 'button', class: 'btn mini-btn', 'data-lb-history-save': '', title: 'Save the current input to history on this device', html: '<i data-lucide="history"></i> Save run' });
        b.addEventListener('click', function () { history_.saveNow(SLUG); });
        slot.appendChild(b);
      }
    });
    document.querySelectorAll('input[data-lb-history-switch]').forEach(function (i) {
      i.addEventListener('change', function () { history_.setEnabled(SLUG, i.checked); });
    });
    // a click on the tool's primary button is an explicit run
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-lb-primary]')) markExplicit(); }, true);
    syncSwitches();
  }
  function hasHistory() { return !!document.querySelector('input[data-lb-history-switch], [data-lb-history-slot]'); }

  // ------------------------------------------------------------------ palette
  var pal = null, palMode = 'search', palPayload = null, palItems = [], palIndex = 0;
  function buildPalette() {
    if (pal) return pal;
    pal = el('div', { id: 'lbPalette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, [
      el('div', { class: 'lb-pal-box' }, [
        el('div', { class: 'lb-pal-head' }, [
          el('i', { 'data-lucide': 'search' }),
          el('input', { id: 'lbPalInput', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Search tools, guides and actions…', 'aria-label': 'Search' }),
          el('kbd', { text: 'Esc' })
        ]),
        el('div', { id: 'lbPalList', class: 'lb-pal-list', role: 'listbox' }),
        el('div', { class: 'lb-pal-foot', html: '<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> toggle</span><span class="lb-pal-local"><i data-lucide="shield-check"></i> Everything here runs in your browser</span>' })
      ])
    ]);
    pal.addEventListener('click', function (e) { if (e.target === pal) closePalette(); });
    var inp = pal.querySelector('#lbPalInput');
    inp.addEventListener('input', function () { renderPalette(inp.value); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); var it = palItems[palIndex]; if (it) it.go(); }
      else if (e.key === 'Escape') { closePalette(); }
    });
    document.body.appendChild(pal);
    icons();
    return pal;
  }
  function score(q, text) {
    if (!q) return 1;
    text = text.toLowerCase(); q = q.toLowerCase();
    if (text.indexOf(q) >= 0) return 100 - text.indexOf(q);
    var ti = 0, hit = 0;
    for (var i = 0; i < q.length; i++) { var p = text.indexOf(q[i], ti); if (p < 0) { if (q[i] === ' ') continue; return 0; } hit += (p === ti ? 2 : 1); ti = p + 1; }
    return hit;
  }
  function candidates(q) {
    var out = [];
    var here = SLUG;
    if (palMode === 'send') {
      TOOLS.forEach(function (t) {
        if (t[0] === here || !t[3].length) return;
        var s = score(q, t[1] + ' ' + t[2]); if (!s) return;
        out.push({ group: 'Send to', title: t[1], hint: 'Opens with your text already loaded', icon: 'arrow-right-circle', s: s + (t[3].indexOf(palPayload.kind) >= 0 ? 50 : 0),
          go: function () { sendTo(t[0], palPayload.text, palPayload.kind); } });
      });
      return out;
    }
    if (!q) {
      out.push({ group: 'Actions', title: 'Share this as a link', hint: 'Copies a URL with your input compressed into the #fragment', icon: 'link', s: 5, go: function () { closePalette(); state.share(); } });
      if (TOOL || SLUG) out.push({ group: 'Actions', title: 'Run (Ctrl+Enter)', hint: 'Runs the tool', icon: 'play', s: 4, go: function () { closePalette(); runTool(); } });
      out.push({ group: 'Actions', title: 'Keyboard shortcuts', hint: 'Show the shortcut list', icon: 'keyboard', s: 3, go: function () { closePalette(); showShortcuts(); } });
      out.push({ group: 'Actions', title: 'Clear local history', hint: 'Deletes the run history stored in this browser', icon: 'trash-2', s: 2, go: function () { closePalette(); history_.clear(); } });
    } else {
      [['Share this as a link', 'share link copy url', 'link', function () { closePalette(); state.share(); }],
       ['Keyboard shortcuts', 'keyboard shortcuts help keys', 'keyboard', function () { closePalette(); showShortcuts(); }],
       ['Clear local history', 'clear delete history privacy', 'trash-2', function () { closePalette(); history_.clear(); }],
       ['Home', 'home index all tools', 'home', function () { location.href = PREFIX || './'; }],
       ['Privacy policy', 'privacy policy cookies data', 'shield', function () { location.href = PREFIX + 'privacy.html'; }],
       ['Contact Layerbit', 'contact email services hire', 'mail', function () { location.href = PREFIX + 'contact.html'; }]
      ].forEach(function (a) { var s = score(q, a[0] + ' ' + a[1]); if (s) out.push({ group: 'Actions', title: a[0], icon: a[2], s: s, go: a[3] }); });
    }
    TOOLS.forEach(function (t) {
      var s = score(q, t[1] + ' ' + t[2]); if (!s) return;
      out.push({ group: 'Tools', title: t[1], hint: t[0] === here ? 'You are here' : '', icon: 'wrench', s: s + (t[0] === here ? -30 : 0), go: function () { location.href = PREFIX + 'tools/' + t[0] + '.html'; } });
    });
    GUIDES.forEach(function (g) {
      var s = score(q, g[1]); if (!s) return;
      out.push({ group: 'Guides', title: g[1], icon: 'book-open', s: s - 5, go: function () { location.href = PREFIX + 'guides/' + g[0] + '.html'; } });
    });
    SERVICES.forEach(function (g) {
      var s = score(q, g[1] + ' service uae'); if (!s) return;
      out.push({ group: 'Services', title: g[1], icon: 'briefcase', s: s - 10, go: function () { location.href = PREFIX + 'tools/' + g[0] + '.html'; } });
    });
    return out;
  }
  function renderPalette(q, recents) {
    var list = pal.querySelector('#lbPalList');
    var items = candidates(q || '');
    if (recents && recents.length && !q && palMode === 'search') {
      recents.forEach(function (r) {
        var t = TOOLS.filter(function (x) { return x[0] === r.slug; })[0];
        items.unshift({ group: 'Recent on this device', title: (t ? t[1] : r.slug) + (r.label ? ': ' + r.label : ''), hint: new Date(r.ts).toLocaleString(), icon: 'history', s: 1000,
          go: function () { closePalette(); if (r.slug === SLUG && TOOL && TOOL.setState) TOOL.setState(r.data); else state.write(r.data).then(function () { if (r.slug !== SLUG) location.href = PREFIX + 'tools/' + r.slug + '.html' + location.hash; else applyIncomingState(); }); } });
      });
    }
    items.sort(function (a, b) { return b.s - a.s; });
    palItems = items.slice(0, 40); palIndex = 0;
    var html = '', lastGroup = null;
    palItems.forEach(function (it, i) {
      if (it.group !== lastGroup) { html += '<div class="lb-pal-group">' + esc(it.group) + '</div>'; lastGroup = it.group; }
      html += '<div class="lb-pal-item' + (i === 0 ? ' active' : '') + '" role="option" data-i="' + i + '"><i data-lucide="' + esc(it.icon) + '"></i><span class="lb-pal-title">' + esc(it.title) + '</span>' + (it.hint ? '<span class="lb-pal-hint">' + esc(it.hint) + '</span>' : '') + '</div>';
    });
    if (!palItems.length) html = '<div class="lb-pal-empty">No matches. Try "json", "diff" or "jwt".</div>';
    list.innerHTML = html;
    list.querySelectorAll('.lb-pal-item').forEach(function (n) {
      n.addEventListener('click', function () { palItems[+n.getAttribute('data-i')].go(); });
      n.addEventListener('mousemove', function () { setPal(+n.getAttribute('data-i')); });
    });
    icons();
  }
  function setPal(i) {
    palIndex = i;
    pal.querySelectorAll('.lb-pal-item').forEach(function (n, k) { n.classList.toggle('active', k === i); });
    var a = pal.querySelector('.lb-pal-item.active'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
  }
  function movePal(d) { if (!palItems.length) return; setPal((palIndex + d + palItems.length) % palItems.length); }
  function openPalette(mode, payload) {
    buildPalette();
    palMode = mode || 'search'; palPayload = payload || null;
    var inp = pal.querySelector('#lbPalInput');
    inp.value = '';
    inp.placeholder = palMode === 'send' ? 'Send this output to…' : 'Search tools, guides and actions…';
    pal.classList.add('open');
    document.body.classList.add('lb-modal-open');
    renderPalette('');
    if (palMode === 'search') history_.list(null, 6).then(function (r) { if (pal.classList.contains('open') && !inp.value) renderPalette('', r); });
    setTimeout(function () { inp.focus(); }, 10);
  }
  function closePalette() { if (pal) { pal.classList.remove('open'); document.body.classList.remove('lb-modal-open'); } }

  // ------------------------------------------------------------------ send to
  function sendTo(slug, text, kind) {
    var from = TOOLS.filter(function (t) { return t[0] === SLUG; })[0];
    encodeState({ input: text, kind: kind || 'text', from: from ? from[1] : 'Layerbit' }).then(function (s) {
      location.href = PREFIX + 'tools/' + slug + '.html#s=' + s;
    });
  }

  // ------------------------------------------------------------------ drop
  var dropHandler = null, dragDepth = 0, overlay = null;
  // ------------------------------------------------------------ file reading
  // Files are read as bytes and decoded here, not with readAsText (UTF-8
  // only, which turns every Windows-1252 accent into U+FFFD): a BOM decides
  // (UTF-8, UTF-16 LE/BE), then BOM-less UTF-16 is recognised by its zero
  // bytes, then strict UTF-8 is tried, and Windows-1252 is the fallback,
  // since it maps every byte. The toast after loading names the encoding and
  // offers to read the same bytes another way.
  var ENCODINGS = [{ v: 'utf-8', n: 'UTF-8' }, { v: 'windows-1252', n: 'Windows-1252 (Western European)' }, { v: 'utf-16le', n: 'UTF-16 LE' }, { v: 'utf-16be', n: 'UTF-16 BE' },
    { v: 'windows-1256', n: 'Windows-1256 (Arabic)' }, { v: 'windows-1251', n: 'Windows-1251 (Cyrillic)' }, { v: 'iso-8859-7', n: 'ISO-8859-7 (Greek)' }, { v: 'shift_jis', n: 'Shift_JIS (Japanese)' }, { v: 'gb18030', n: 'GB18030 (Chinese)' }];
  var ENC_NAME = { 'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'windows-1256': 'Windows-1256', 'windows-1251': 'Windows-1251', 'iso-8859-7': 'ISO-8859-7', 'shift_jis': 'Shift_JIS', 'gb18030': 'GB18030' };
  function decodeBytes(u8, forced) {
    var dec = function (label, bytes, fatal) { return new TextDecoder(label, { fatal: !!fatal }).decode(bytes); };
    if (forced) {
      var skip = forced === 'utf-8' && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF ? 3 : /^utf-16/.test(forced) && ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF)) ? 2 : 0;
      return { text: dec(forced, u8.subarray(skip)), encoding: ENC_NAME[forced] || forced, label: forced, bom: skip > 0 };
    }
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return { text: dec('utf-8', u8.subarray(3)), encoding: 'UTF-8', label: 'utf-8', bom: true };
    if (u8[0] === 0xFF && u8[1] === 0xFE) return { text: dec('utf-16le', u8.subarray(2)), encoding: 'UTF-16 LE', label: 'utf-16le', bom: true };
    if (u8[0] === 0xFE && u8[1] === 0xFF) return { text: dec('utf-16be', u8.subarray(2)), encoding: 'UTF-16 BE', label: 'utf-16be', bom: true };
    var n = Math.min(u8.length, 4096) & ~1, ze = 0, zo = 0;
    for (var i = 0; i < n; i += 2) { if (u8[i] === 0) ze++; if (u8[i + 1] === 0) zo++; }
    if (n >= 4 && zo > n / 2 * 0.3 && ze < n / 2 * 0.05) return { text: dec('utf-16le', u8), encoding: 'UTF-16 LE', label: 'utf-16le', bom: false };
    if (n >= 4 && ze > n / 2 * 0.3 && zo < n / 2 * 0.05) return { text: dec('utf-16be', u8), encoding: 'UTF-16 BE', label: 'utf-16be', bom: false };
    try { return { text: dec('utf-8', u8, true), encoding: 'UTF-8', label: 'utf-8', bom: false }; }
    catch (e) { return { text: dec('windows-1252', u8), encoding: 'Windows-1252', label: 'windows-1252', bom: false }; }
  }
  /** {name, text, encoding, label, bom, bytes} for a File; opts.encoding forces one. */
  function readFileInfo(file, opts) {
    return file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), d = decodeBytes(u8, opts && opts.encoding);
      return { name: file.name, text: d.text, encoding: d.encoding + (d.bom ? ' with BOM' : ''), label: d.label, bom: d.bom, bytes: u8 };
    });
  }
  var lastRead = null;
  /** Promise of the decoded text (as before). The page's callbacks are
   *  remembered, so choosing another encoding re-delivers the text to them. */
  function readFile(file) {
    var handlers = [];
    var p = readFileInfo(file).then(function (info) {
      lastRead = { info: info, handlers: handlers };
      // after the page's own callbacks (and any "Loaded" toast they show)
      setTimeout(function () { toast('Loaded ' + info.name + ' (' + fmtBytes(info.bytes.length) + ', ' + info.encoding + ')', null, { label: 'Change encoding', fn: openEncoding }); }, 0);
      return info.text;
    });
    var then = p.then.bind(p);
    p.then = function (f, r) { if (typeof f === 'function') handlers.push(f); return then(f, r); };
    return p;
  }
  var encDlg = null;
  function openEncoding() {
    if (!lastRead) return;
    if (!encDlg) {
      encDlg = el('div', { id: 'lbEncoding', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose the text encoding' }, [
        el('div', { class: 'lb-pal-box' }, [
          el('div', { class: 'lb-pal-head', html: '<i data-lucide="languages"></i><strong style="flex:1">Read the file as…</strong><kbd>Esc</kbd>' }),
          el('div', { id: 'lbEncList', class: 'lb-pal-list' }),
          el('div', { class: 'lb-pal-foot', html: '<span>The same bytes, decoded another way. Pick the line that reads correctly.</span>' })
        ])
      ]);
      encDlg.addEventListener('click', function (e) {
        if (e.target === encDlg) { closeEncoding(); return; }
        var it = e.target.closest('[data-enc]'); if (!it) return;
        var d = decodeBytes(lastRead.info.bytes, it.getAttribute('data-enc'));
        lastRead.info.text = d.text; lastRead.info.encoding = d.encoding + (d.bom ? ' with BOM' : '');
        closeEncoding();
        lastRead.handlers.forEach(function (h) { try { h(d.text); } catch (x) { /* the page reports its own errors */ } });
        toast('Read ' + lastRead.info.name + ' as ' + d.encoding);
      });
      document.body.appendChild(encDlg);
    }
    var b = lastRead.info.bytes, sample = b.subarray(0, 4000);
    encDlg.querySelector('#lbEncList').innerHTML = ENCODINGS.map(function (e) {
      var prev;
      try { prev = decodeBytes(sample, e.v).text.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || ''; } catch (x) { prev = '(not available in this browser)'; }
      var cur = lastRead.info.label === e.v;
      return '<div class="lb-pal-item' + (cur ? ' active' : '') + '" data-enc="' + e.v + '"><i data-lucide="' + (cur ? 'check' : 'type') + '"></i><span class="lb-pal-title">' + esc(e.n) + '</span><span class="lb-pal-hint lb-enc-prev">' + esc(prev.slice(0, 70)) + '</span></div>';
    }).join('');
    encDlg.classList.add('open'); document.body.classList.add('lb-modal-open'); icons();
  }
  function closeEncoding() { if (encDlg) { encDlg.classList.remove('open'); document.body.classList.remove('lb-modal-open'); } }
  function installDrop() {
    overlay = el('div', { id: 'lbDrop', html: '<div><i data-lucide="file-down"></i><strong>Drop to load</strong><span>The file is read by this page only. It is not uploaded.</span></div>' });
    document.body.appendChild(overlay);
    document.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; dragDepth++; overlay.classList.add('show'); });
    document.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.classList.remove('show'); });
    document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      dragDepth = 0; overlay.classList.remove('show');
      if (!hasFiles(e)) return;
      if (e.defaultPrevented && e.target.closest && e.target.closest('.pane, [data-lb-drop]')) return; // a pane handled it
      e.preventDefault();
      var files = Array.prototype.slice.call(e.dataTransfer.files);
      if (dropHandler) { dropHandler(files, e); return; }
      if (TOOL && TOOL.files) { TOOL.files(files); return; }
      var f = files[0];
      if (f.size > 50 * 1024 * 1024) { toast('That file is ' + Math.round(f.size / 1048576) + ' MB; this page handles up to 50 MB', 'warn'); return; }
      readFile(f).then(function (text) {
        if (TOOL && TOOL.input) TOOL.input(text, f.name);
        else { var ta = firstTextarea(); if (!ta) { toast('This page has nowhere to drop a file'); return; } ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    });
  }
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

  // ------------------------------------------------------------- privacy pill
  // Counts requests the page's own code makes (fetch, XHR, sendBeacon), minus
  // the ad/analytics domains disclosed in the privacy policy. Lucide, fonts
  // and stylesheets are static assets, not data leaving the page.
  var DISCLOSED = /(^|\.)(googletagmanager\.com|google-analytics\.com|googlesyndication\.com|doubleclick\.net|googleadservices\.com|google\.com|google\.co\.in|gstatic\.com|googleapis\.com|adtrafficquality\.google)$/;
  var netCount = 0, netLog = [];
  function noteRequest(url, how) {
    try {
      var u = new URL(url, location.href);
      if (u.origin === location.origin) return;
      if (DISCLOSED.test(u.hostname)) return;
      netCount++; netLog.push(how + ' ' + u.origin);
      renderPill();
    } catch (e) { /* ignore */ }
  }
  function installNetWatch() {
    if (window.fetch) { var f0 = window.fetch; window.fetch = function (input, init) { noteRequest(typeof input === 'string' ? input : (input && input.url) || '', 'fetch'); return f0.apply(this, arguments); }; }
    if (window.XMLHttpRequest) { var o0 = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (mth, url) { noteRequest(url, 'xhr'); return o0.apply(this, arguments); }; }
    if (navigator.sendBeacon) { var b0 = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function (url, data) { noteRequest(url, 'beacon'); return b0(url, data); }; }
    if (window.WebSocket) { var W0 = window.WebSocket; var W = function (url, p) { noteRequest(url, 'websocket'); return p === undefined ? new W0(url) : new W0(url, p); }; W.prototype = W0.prototype; ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { W[k] = W0[k]; }); window.WebSocket = W; }
  }
  var pill = null;
  function renderPill() {
    if (!pill) return;
    var cloud = SLUG && /^layerlink-/.test(SLUG);
    if (netCount === 0) { pill.className = 'lb-pill lb-pill-ok'; pill.innerHTML = '<i data-lucide="shield-check"></i><span>Local · nothing sent</span>'; pill.title = 'This page has made no request carrying your data. Ads and analytics are counted separately and disclosed in the privacy policy.'; }
    else { pill.className = 'lb-pill lb-pill-info'; pill.innerHTML = '<i data-lucide="cloud"></i><span>' + netCount + ' network request' + (netCount > 1 ? 's' : '') + '</span>'; pill.title = 'Requests made by this page: ' + netLog.slice(-5).join(', '); }
    icons();
  }

  // ------------------------------------------------------------------ header
  function installHeader() {
    var header = document.querySelector('body > header, header');
    if (!header) return;
    // Mark the current section in the main navigation.
    var path = location.pathname;
    var navEnd = /^\/(guides\/|blog\.html)/.test(path) ? 'blog.html' : /^\/tools\//.test(path) ? '#tools'
      : /^\/(about|author)\.html$/.test(path) ? 'about.html' : /^\/(work|contact)\.html$/.test(path) ? path.slice(1) : '';
    if (navEnd) header.querySelectorAll('.site-nav a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.slice(-navEnd.length) === navEnd) a.setAttribute('aria-current', 'page');
    });
    // The homepage has its own search (bottom-left pill) and the Support button
    // top-right, so it gets no header pills; Ctrl+K still opens the palette.
    if (/^\/(index\.html)?$/.test(location.pathname)) return;
    var box = el('div', { class: 'lb-header-tools' });
    var sb = el('button', { type: 'button', class: 'lb-pill lb-pill-btn', id: 'lbPaletteBtn', 'aria-label': 'Search tools (Ctrl+K)', title: 'Search every tool and guide (Ctrl+K)', html: '<i data-lucide="search"></i><span>Search</span><kbd>Ctrl K</kbd>', onclick: function () { openPalette('search'); } });
    box.appendChild(sb);
    if (SLUG && !/^layerlink-|^(api-automation|app-development|custom-scripts|erp-development|portfolio-design|static-sites)$/.test(SLUG)) {
      box.appendChild(el('button', { type: 'button', class: 'lb-pill lb-pill-btn', id: 'lbShareBtn', title: 'Copy a link that carries your input in the #fragment (never sent to a server)', html: '<i data-lucide="link"></i><span>Share link</span>', onclick: function () { state.share(); } }));
      box.appendChild(el('button', { type: 'button', class: 'lb-pill lb-pill-btn', id: 'lbHistoryBtn', title: 'Runs saved on this device (Ctrl+H)', html: '<i data-lucide="history"></i><span>History</span>', onclick: function () { openHistory(); } }));
    }
    // The privacy indicator belongs on local tool pages only: the homepage and
    // LayerLink pages talk to the visitor counter / signalling service by design,
    // and the service pages have nothing to indicate.
    if (SLUG && !/^layerlink-|^(api-automation|app-development|custom-scripts|erp-development|portfolio-design|static-sites)$/.test(SLUG)) {
      pill = el('div', { class: 'lb-pill lb-pill-ok', id: 'lbPrivacyPill', role: 'status' });
      box.appendChild(pill);
    }
    header.appendChild(box);
    renderPill();
    icons();
  }

  // ------------------------------------------------------------------ history UI
  var hist = null;
  function openHistory() {
    if (!hist) {
      hist = el('div', { id: 'lbHistory', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Run history' }, [
        el('div', { class: 'lb-pal-box' }, [
          el('div', { class: 'lb-pal-head', html: '<i data-lucide="history"></i><strong style="flex:1">History on this device</strong><button type="button" class="lb-pill lb-pill-btn" id="lbHistClear"><i data-lucide="trash-2"></i><span>Clear</span></button><kbd>Esc</kbd>' }),
          el('div', { id: 'lbHistSwitchRow', class: 'lb-hist-switch-row' }),
          el('div', { id: 'lbHistList', class: 'lb-pal-list' }),
          el('div', { class: 'lb-pal-foot', html: '<span>Stored in this browser\'s IndexedDB only. Never synced, never sent. Up to 50 runs per tool.</span>' })
        ])
      ]);
      hist.addEventListener('click', function (e) { if (e.target === hist) closeHistory(); });
      document.body.appendChild(hist);
      hist.querySelector('#lbHistClear').addEventListener('click', function () { history_.clear().then(function () { renderHistory(); }); });
    }
    var row = hist.querySelector('#lbHistSwitchRow');
    if (hasHistory()) {
      row.innerHTML = '<label class="toggle-label"><input type="checkbox" data-lb-history-switch> Save this tool\'s runs to history on this device</label>';
      row.querySelector('input').addEventListener('change', function (e) { history_.setEnabled(SLUG, e.target.checked); });
      syncSwitches();
    } else row.innerHTML = '<span>This tool does not save runs.</span>';
    hist.classList.add('open'); document.body.classList.add('lb-modal-open');
    renderHistory();
  }
  function closeHistory() { if (hist) { hist.classList.remove('open'); document.body.classList.remove('lb-modal-open'); } }
  function renderHistory() {
    history_.list(SLUG, 50).then(function (rows) {
      var list = hist.querySelector('#lbHistList');
      if (!rows.length) { list.innerHTML = '<div class="lb-pal-empty">Nothing saved. History is off unless you turn on Save to history for a tool; then each run you start is kept here.</div>'; return; }
      list.innerHTML = rows.map(function (r, i) {
        var prev = r.label || (typeof r.data.input === 'string' ? r.data.input.slice(0, 80).replace(/\s+/g, ' ') : JSON.stringify(r.data).slice(0, 80));
        return '<div class="lb-pal-item" data-i="' + i + '"><i data-lucide="corner-up-left"></i><span class="lb-pal-title">' + esc(prev) + '</span><span class="lb-pal-hint">' + esc(new Date(r.ts).toLocaleString()) + '</span></div>';
      }).join('');
      list.querySelectorAll('.lb-pal-item').forEach(function (n) {
        n.addEventListener('click', function () {
          var r = rows[+n.getAttribute('data-i')];
          closeHistory();
          if (TOOL && TOOL.setState) TOOL.setState(r.data);
          else if (typeof r.data.input === 'string') { var ta = firstTextarea(); if (ta) { ta.value = r.data.input; ta.dispatchEvent(new Event('input', { bubbles: true })); } }
          toast('Restored from history');
        });
      });
      icons();
    });
  }

  // --------------------------------------------------------------- shortcuts
  var SHORTCUTS = [['Ctrl / ⌘ + K', 'Search tools, guides and actions'], ['Ctrl / ⌘ + Enter', 'Run the tool'], ['Ctrl / ⌘ + Shift + S', 'Copy a share link'], ['Ctrl / ⌘ + H', 'Open run history'], ['?', 'This list'], ['Esc', 'Close any panel']];
  var sc = null;
  function showShortcuts() {
    if (!sc) {
      sc = el('div', { id: 'lbShortcuts', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' }, [
        el('div', { class: 'lb-pal-box' }, [
          el('div', { class: 'lb-pal-head', html: '<i data-lucide="keyboard"></i><strong style="flex:1">Keyboard shortcuts</strong><kbd>Esc</kbd>' }),
          el('div', { class: 'lb-pal-list', html: SHORTCUTS.map(function (s) { return '<div class="lb-pal-item static"><kbd>' + esc(s[0]) + '</kbd><span class="lb-pal-title">' + esc(s[1]) + '</span></div>'; }).join('') })
        ])
      ]);
      sc.addEventListener('click', function (e) { if (e.target === sc) sc.classList.remove('open'); });
      document.body.appendChild(sc);
    }
    sc.classList.add('open'); icons();
  }
  function runTool() {
    markExplicit();
    if (TOOL && TOOL.run) TOOL.run();
    else { var b = document.querySelector('[data-lb-primary], .btn-primary'); if (b) b.click(); }
    // a tool that runs as you type has already reported its state: save it
    // if the explicit run did not produce a push of its own
    if (hasHistory() && history_.enabled(SLUG)) setTimeout(function () { if (explicitAt) { explicitAt = 0; history_.saveNow(SLUG); } }, 60);
  }
  function inEditable(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  function installKeys() {
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (pal && pal.classList.contains('open')) closePalette(); else openPalette('search'); return; }
      if (e.key === 'Escape') { closePalette(); closeHistory(); closeEncoding(); if (sc) sc.classList.remove('open'); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); runTool(); return; }
      if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); state.share(); return; }
      if (mod && !e.shiftKey && (e.key === 'h' || e.key === 'H') && SLUG) { e.preventDefault(); openHistory(); return; }
      if (e.key === '?' && !inEditable(e.target) && !mod) { e.preventDefault(); showShortcuts(); }
    });
  }

  // ------------------------------------------------------------------- PWA
  function installSw() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    try { navigator.serviceWorker.register(PREFIX + 'sw.js', { scope: PREFIX || './' }).catch(function () { }); } catch (e) { /* ignore */ }
  }

  // --------------------------------------------------------- first-visit example
  // The first time someone opens a tool in this browser, press the sample
  // button the page marks with data-lb-autosample, so the tool opens showing
  // a worked example instead of an empty box. Never when a shared link brought
  // its own input, never over text already in the page, and once per tool:
  // returning visitors get the empty tool they expect.
  function autoSample() {
    var btn = document.querySelector('[data-lb-autosample]');
    if (!btn || !SLUG || readFragment()) return;
    var key = 'layerbit-sampled:' + SLUG;
    try {
      if (localStorage.getItem('layerbit-autosample') === 'off' || localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch (e) { return; }
    var typed = Array.prototype.some.call(document.querySelectorAll('textarea'), function (t) { return t.value.trim() !== ''; });
    if (typed) return;
    btn.click();
  }

  // --------------------------------------------------------------------- boot
  function boot() {
    installHeader();
    installDrop();
    installKeys();
    installSw();
    installHistorySwitches();
    purgeSilentRuns();
    applyIncomingState();
    document.querySelectorAll('[data-lb-send]').forEach(function (b) {
      b.addEventListener('click', function () {
        var src = document.getElementById(b.getAttribute('data-lb-send'));
        var text = src ? (src.value !== undefined ? src.value : src.innerText) : '';
        if (!text) { toast('Nothing to send yet'); return; }
        openPalette('send', { text: text, kind: b.getAttribute('data-lb-kind') || 'text' });
      });
    });
  }
  installNetWatch();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // after the page's own start-up code has run
  if (document.readyState === 'complete') setTimeout(autoSample, 60); else window.addEventListener('load', function () { setTimeout(autoSample, 60); });

  window.Layerbit = {
    version: '1.0.0', prefix: PREFIX, slug: SLUG, tools: TOOLS, guides: GUIDES,
    toast: toast, copy: copy, state: state, history: history_, fmtBytes: fmtBytes,
    palette: openPalette, sendTo: function (text, kind) { openPalette('send', { text: text, kind: kind || 'text' }); },
    // Line endings for text a tool turns into bytes: a textarea always holds
    // LF, so 'crlf' rewrites every line break as CRLF (Windows files).
    eol: function (text, mode) { return mode === 'crlf' ? String(text).replace(/\r?\n/g, '\r\n') : String(text); },
    onDrop: function (fn) { dropHandler = fn; }, readFile: readFile, readFileInfo: readFileInfo, decodeBytes: decodeBytes, run: runTool,
    register: function (cfg) { TOOL = cfg; window.LB_TOOL = cfg; },
    netRequests: function () { return netLog.slice(); }
  };
})();
