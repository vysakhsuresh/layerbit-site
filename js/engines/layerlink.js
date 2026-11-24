/* LayerLink multi-viewer protocol, for the web sharer and viewer pages.
 *
 * The original one-viewer protocol (sessions/{id}/offer, answer, offerCandidates,
 * answerCandidates, rejoin) is shared with the LayerLink Android app and is left
 * exactly as it was: the pages keep their own code for it. A session started by
 * this web sharer is marked with sessions/{id}/multi and uses per-viewer paths:
 *
 *   multi                         {v: 1, locked, approval, max}          sharer
 *   joins/{push}                  {vid, name}                            viewer
 *   viewers/{vid}/status          pending | approved | denied | full | removed   sharer
 *   viewers/{vid}/offer           SDP (sealed with the room password when locked)
 *   viewers/{vid}/answer          SDP (sealed when locked)                viewer
 *   viewers/{vid}/offerCandidates/{push}, answerCandidates/{push}  (sealed when locked)
 *
 * With a password, everything that would let someone connect (SDP and ICE candidates,
 * which also carry IP addresses) is AES-GCM encrypted with a key derived from the
 * password (PBKDF2-SHA-256, 150,000 rounds), so a viewer without it cannot connect.
 * Each viewer gets its own RTCPeerConnection with the screen (and audio) tracks and a
 * data channel for chat, files and annotations.
 *
 * Signal adapters: firebaseSignal(db) and localSignal() (localStorage + storage events,
 * for tests on localhost). Both expose set/get/onValue/push/onChild/remove on paths.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBLink = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CHUNK = 16 * 1024;

  // ------------------------------------------------------------ signalling
  function firebaseSignal(db) {
    return {
      set: function (p, v) { return db.ref(p).set(v); },
      get: function (p) { return db.ref(p).once('value').then(function (s) { return s.val(); }); },
      onValue: function (p, cb) { var r = db.ref(p), h = function (s) { cb(s.val()); }; r.on('value', h); return function () { r.off('value', h); }; },
      push: function (p, v) { return db.ref(p).push(v); },
      onChild: function (p, cb) { var r = db.ref(p), h = function (s) { cb(s.val(), s.key); }; r.on('child_added', h); return function () { r.off('child_added', h); }; },
      remove: function (p) { return db.ref(p).remove(); },
      removeOnDisconnect: function (p) { try { db.ref(p).onDisconnect().remove(); } catch (e) { /* older SDK */ } }
    };
  }
  function localSignal(store) {
    store = store || (typeof localStorage !== 'undefined' ? localStorage : null);
    var P = 'llsig:', listeners = [];
    function fire(key, val) { listeners.slice().forEach(function (l) { l(key, val); }); }
    if (typeof window !== 'undefined') window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf(P) === 0) fire(e.key.slice(P.length), e.newValue === null ? null : JSON.parse(e.newValue)); });
    var seq = 0;
    return {
      set: function (p, v) { if (v === null || v === undefined) store.removeItem(P + p); else store.setItem(P + p, JSON.stringify(v)); fire(p, v === undefined ? null : v); return Promise.resolve(); },
      get: function (p) { var r = store.getItem(P + p); return Promise.resolve(r === null ? null : JSON.parse(r)); },
      onValue: function (p, cb) {
        var r = store.getItem(P + p); setTimeout(function () { cb(r === null ? null : JSON.parse(r)); }, 0);
        var l = function (k, v) { if (k === p) cb(v); }; listeners.push(l); return function () { listeners.splice(listeners.indexOf(l), 1); };
      },
      push: function (p, v) { var k = Date.now().toString(36) + (++seq).toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 6); return this.set(p + '/' + k, v).then(function () { return { key: k }; }); },
      onChild: function (p, cb) {
        var seen = {}, pre = p + '/';
        var deliver = function (k, v) { var rest = k.slice(pre.length); if (k.indexOf(pre) === 0 && rest.indexOf('/') < 0 && !seen[rest] && v !== null) { seen[rest] = 1; cb(v, rest); } };
        setTimeout(function () {
          var keys = []; for (var i = 0; i < store.length; i++) { var k = store.key(i); if (k.indexOf(P + pre) === 0) keys.push(k.slice(P.length)); }
          keys.sort().forEach(function (k) { deliver(k, JSON.parse(store.getItem(P + k))); });
        }, 0);
        var l = function (k, v) { deliver(k, v); }; listeners.push(l); return function () { listeners.splice(listeners.indexOf(l), 1); };
      },
      remove: function (p) { var dead = []; for (var i = 0; i < store.length; i++) { var k = store.key(i); if (k === P + p || k.indexOf(P + p + '/') === 0) dead.push(k); } dead.forEach(function (k) { store.removeItem(k); fire(k.slice(P.length), null); }); return Promise.resolve(); },
      removeOnDisconnect: function () { }
    };
  }

  // --------------------------------------------------------------- crypto
  var te = new TextEncoder(), td = new TextDecoder();
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var keyCache = {};
  function deriveKey(password, salt) {
    var id = password + '|' + salt;
    if (!keyCache[id]) keyCache[id] = crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('layerlink:' + salt), iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
    return keyCache[id];
  }
  function seal(obj, password, salt) {
    if (!password) return Promise.resolve(JSON.stringify(obj));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt).then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, te.encode(JSON.stringify(obj))); })
      .then(function (ct) { return JSON.stringify({ sealed: 1, iv: b64(iv), data: b64(new Uint8Array(ct)) }); });
  }
  function open(text, password, salt) {
    var o = typeof text === 'string' ? JSON.parse(text) : text;
    if (!o || !o.sealed) return Promise.resolve(o);
    if (!password) return Promise.reject(Object.assign(new Error('This broadcast needs a password.'), { code: 'password' }));
    return deriveKey(password, salt).then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, k, unb64(o.data)); })
      .then(function (pt) { return JSON.parse(td.decode(pt)); }, function () { throw Object.assign(new Error('Wrong password.'), { code: 'password' }); });
  }

  // ---------------------------------------------------- data channel helpers
  function wireChannel(ch, emit, who) {
    ch.binaryType = 'arraybuffer';
    var incoming = null;
    ch.onmessage = function (e) {
      if (typeof e.data !== 'string') {
        if (incoming) { incoming.parts.push(e.data); incoming.got += e.data.byteLength; emit('file-progress', { who: who, id: incoming.id, name: incoming.name, got: incoming.got, size: incoming.size }); }
        return;
      }
      var m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'file-start') incoming = { id: m.id, name: String(m.name).slice(0, 200), size: m.size, type: m.type || 'application/octet-stream', parts: [], got: 0, from: m.from };
      else if (m.t === 'file-end' && incoming && incoming.id === m.id) {
        var blob = new Blob(incoming.parts, { type: incoming.type });
        emit('file', { who: who, name: incoming.name, size: blob.size, complete: blob.size === incoming.size, blob: blob, from: incoming.from });
        incoming = null;
      } else emit(m.t, Object.assign({ who: who }, m));
    };
  }
  function sendFile(ch, file, from) {
    var id = Math.random().toString(36).slice(2), off = 0;
    ch.send(JSON.stringify({ t: 'file-start', id: id, name: file.name, size: file.size, type: file.type, from: from }));
    ch.bufferedAmountLowThreshold = 1 << 20;
    return new Promise(function (resolve, reject) {
      function pump() {
        if (ch.readyState !== 'open') return reject(new Error('The connection closed before the file was sent.'));
        if (off >= file.size) { ch.send(JSON.stringify({ t: 'file-end', id: id })); return resolve(file.size); }
        if (ch.bufferedAmount > 4 << 20) { ch.onbufferedamountlow = function () { ch.onbufferedamountlow = null; pump(); }; return; }
        file.slice(off, off + CHUNK).arrayBuffer().then(function (buf) { ch.send(buf); off += buf.byteLength; pump(); }, reject);
      }
      pump();
    });
  }
  var rid = function () { return Math.random().toString(36).slice(2, 10); };

  // ---------------------------------------------------------------- sharer
  function Sharer(o) {
    this.o = o; this.sig = o.signal; this.base = 'sessions/' + o.sid; this.viewers = {}; this.unsub = []; this.listeners = {};
  }
  Sharer.prototype.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; };
  Sharer.prototype.emit = function (ev, d) { (this.listeners[ev] || []).forEach(function (f) { f(d); }); };
  Sharer.prototype.start = function () {
    var self = this, o = this.o;
    this.sig.removeOnDisconnect(this.base);
    var check = o.password ? seal({ ok: 'layerlink' }, o.password, o.sid) : Promise.resolve(null);
    return check.then(function (c) {
      var meta = { v: 1, locked: !!o.password, approval: !!o.approval, max: o.max || 4, at: Date.now() };
      if (c) meta.check = c;
      return self.sig.set(self.base + '/multi', meta);
    }).then(function () {
      self.unsub.push(self.sig.onChild(self.base + '/joins', function (j) { if (j && j.vid && !self.viewers[j.vid]) self.join(j); }));
    });
  };
  Sharer.prototype.active = function () { var n = 0; for (var k in this.viewers) if (/pending|approved/.test(this.viewers[k].state)) n++; return n; };
  Sharer.prototype.join = function (j) {
    var v = { vid: j.vid, name: String(j.name || 'Viewer').slice(0, 40), state: 'pending' };
    this.viewers[j.vid] = v;
    if (this.active() > (this.o.max || 4)) { v.state = 'full'; this.sig.set(this.base + '/viewers/' + j.vid + '/status', 'full'); this.emit('viewers', this.list()); return; }
    if (this.o.approval) { this.sig.set(this.base + '/viewers/' + j.vid + '/status', 'pending'); this.emit('request', v); this.emit('viewers', this.list()); }
    else this.approve(j.vid);
  };
  Sharer.prototype.list = function () { var self = this; return Object.keys(this.viewers).map(function (k) { return self.viewers[k]; }); };
  Sharer.prototype.approve = function (vid) {
    var self = this, o = this.o, v = this.viewers[vid], p = this.base + '/viewers/' + vid;
    if (!v || v.state === 'approved' || v.pc) return Promise.resolve();
    v.state = 'approved';
    var pc = v.pc = new RTCPeerConnection({ iceServers: o.iceServers || [] });
    o.stream.getTracks().forEach(function (t) { pc.addTrack(t, o.stream); });
    var ch = v.ch = pc.createDataChannel('layerlink', { ordered: true });
    wireChannel(ch, function (ev, d) { self.onData(vid, ev, d); }, vid);
    ch.onopen = function () { self.emit('channel', v); };
    pc.onconnectionstatechange = function () { v.conn = pc.connectionState; self.emit('viewers', self.list()); if (pc.connectionState === 'failed' || pc.connectionState === 'closed') v.state = v.state === 'removed' ? 'removed' : 'left'; };
    pc.onicecandidate = function (e) { if (e.candidate) seal(e.candidate.toJSON(), o.password, o.sid).then(function (s) { self.sig.push(p + '/offerCandidates', s); }); };
    var gotAnswer = false, queue = [];
    this.unsub.push(this.sig.onValue(p + '/answer', function (a) {
      if (!a || gotAnswer) return;
      open(a, o.password, o.sid).then(function (desc) { gotAnswer = true; return pc.setRemoteDescription(desc); }).then(function () { queue.forEach(function (c) { pc.addIceCandidate(c); }); queue = []; }).catch(function (e) { self.emit('error', e); });
    }));
    this.unsub.push(this.sig.onChild(p + '/answerCandidates', function (c) {
      open(c, o.password, o.sid).then(function (cand) { if (gotAnswer) pc.addIceCandidate(cand); else queue.push(cand); }).catch(function () { });
    }));
    this.emit('viewers', this.list());
    return pc.createOffer().then(function (off) { return pc.setLocalDescription(off); })
      .then(function () { return seal({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }, o.password, o.sid); })
      .then(function (s) { return self.sig.set(p + '/offer', s); }).then(function () { return self.sig.set(p + '/status', 'approved'); });
  };
  Sharer.prototype.deny = function (vid) { var v = this.viewers[vid]; if (!v) return; v.state = 'denied'; this.sig.set(this.base + '/viewers/' + vid + '/status', 'denied'); this.emit('viewers', this.list()); };
  Sharer.prototype.remove = function (vid) {
    var v = this.viewers[vid]; if (!v) return;
    v.state = 'removed'; this.sig.set(this.base + '/viewers/' + vid + '/status', 'removed');
    if (v.pc) v.pc.close();
    this.emit('viewers', this.list());
  };
  Sharer.prototype.channels = function () { var out = []; for (var k in this.viewers) { var c = this.viewers[k].ch; if (c && c.readyState === 'open' && this.viewers[k].state === 'approved') out.push(c); } return out; };
  Sharer.prototype.broadcast = function (msg, except) { var s = JSON.stringify(msg), self = this; Object.keys(this.viewers).forEach(function (k) { var c = self.viewers[k].ch; if (k !== except && c && c.readyState === 'open' && self.viewers[k].state === 'approved') c.send(s); }); };
  Sharer.prototype.onData = function (vid, ev, d) {
    var v = this.viewers[vid];
    if (!v || v.state !== 'approved') return;
    if (ev === 'chat') { var m = { t: 'chat', text: String(d.text).slice(0, 2000), from: v.name, at: Date.now() }; this.emit('chat', m); this.broadcast(m, vid); }
    else if (ev === 'draw' || ev === 'clear') { var dm = ev === 'clear' ? { t: 'clear', from: v.name } : { t: 'draw', pts: d.pts, color: d.color, from: v.name }; this.emit(ev, dm); this.broadcast(dm, vid); }
    else if (ev === 'file') { d.from = v.name; this.emit('file', d); }
    else if (ev === 'file-progress') this.emit('file-progress', d);
  };
  Sharer.prototype.chat = function (text) { var m = { t: 'chat', text: String(text).slice(0, 2000), from: this.o.name || 'Host', at: Date.now() }; this.broadcast(m); return m; };
  Sharer.prototype.draw = function (pts, color) { this.broadcast({ t: 'draw', pts: pts, color: color, from: this.o.name || 'Host' }); };
  Sharer.prototype.clear = function () { this.broadcast({ t: 'clear', from: this.o.name || 'Host' }); };
  Sharer.prototype.sendFile = function (file) { var self = this; return Promise.all(this.channels().map(function (c) { return sendFile(c, file, self.o.name || 'Host'); })); };
  Sharer.prototype.stop = function () {
    this.unsub.forEach(function (u) { try { u(); } catch (e) { } });
    for (var k in this.viewers) if (this.viewers[k].pc) this.viewers[k].pc.close();
    return this.sig.remove(this.base);
  };

  // ---------------------------------------------------------------- viewer
  function Viewer(o) { this.o = o; this.sig = o.signal; this.base = 'sessions/' + o.sid; this.vid = rid(); this.listeners = {}; this.unsub = []; this.remote = new MediaStream(); }
  Viewer.prototype.on = Sharer.prototype.on;
  Viewer.prototype.emit = Sharer.prototype.emit;
  Viewer.prototype.join = function (meta) {
    var self = this, o = this.o, p = this.base + '/viewers/' + this.vid;
    this.meta = meta;
    var pc = this.pc = new RTCPeerConnection({ iceServers: o.iceServers || [] });
    pc.ontrack = function (e) { self.remote.addTrack(e.track); self.emit('track', { stream: self.remote, track: e.track }); };
    pc.ondatachannel = function (e) { self.ch = e.channel; wireChannel(self.ch, function (ev, d) { self.emit(ev, d); }, 'host'); self.ch.onopen = function () { self.emit('channel', self.ch); }; };
    pc.onconnectionstatechange = function () { self.emit('state', pc.connectionState); };
    pc.onicecandidate = function (e) { if (e.candidate) seal(e.candidate.toJSON(), self.password, o.sid).then(function (s) { self.sig.push(p + '/answerCandidates', s); }); };
    var haveRemote = false, queue = [], pendingCands = [];
    this.unsub.push(this.sig.onValue(p + '/status', function (s) { if (s) self.emit('status', s); }));
    var tryOffer = function (raw) {
      return open(raw, self.password, o.sid).then(function (desc) {
        return pc.setRemoteDescription(desc).then(function () { haveRemote = true; queue.forEach(function (c) { pc.addIceCandidate(c); }); queue = []; pendingCands.forEach(handleCand); pendingCands = []; return pc.createAnswer(); })
          .then(function (ans) { return pc.setLocalDescription(ans); })
          .then(function () { return seal({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }, self.password, o.sid); })
          .then(function (s) { return self.sig.set(p + '/answer', s); }).then(function () { self.emit('answered'); });
      });
    };
    this.retry = null;
    this.unsub.push(this.sig.onValue(p + '/offer', function (raw) {
      if (!raw || haveRemote) return;
      tryOffer(raw).catch(function (e) { if (e.code === 'password') { self.retry = function () { return tryOffer(raw); }; self.emit('password', e.message); } else self.emit('error', e); });
    }));
    function handleCand(raw) { open(raw, self.password, o.sid).then(function (c) { if (haveRemote) pc.addIceCandidate(c); else queue.push(c); }).catch(function () { }); }
    this.unsub.push(this.sig.onChild(p + '/offerCandidates', function (raw) { if (haveRemote) handleCand(raw); else pendingCands.push(raw); }));
    return this.sig.push(this.base + '/joins', { vid: this.vid, name: String(o.name || 'Viewer').slice(0, 40) });
  };
  Viewer.prototype.setPassword = function (pw) { this.password = pw; return this.retry ? this.retry() : Promise.resolve(); };
  Viewer.prototype.send = function (m) { if (this.ch && this.ch.readyState === 'open') { this.ch.send(JSON.stringify(m)); return true; } return false; };
  Viewer.prototype.chat = function (text) { var m = { t: 'chat', text: String(text).slice(0, 2000) }; return this.send(m) ? { t: 'chat', text: m.text, from: this.o.name || 'You', at: Date.now() } : null; };
  Viewer.prototype.draw = function (pts, color) { return this.send({ t: 'draw', pts: pts, color: color }); };
  Viewer.prototype.clear = function () { return this.send({ t: 'clear' }); };
  Viewer.prototype.sendFile = function (file) { if (!this.ch || this.ch.readyState !== 'open') return Promise.reject(new Error('Not connected yet.')); return sendFile(this.ch, file, this.o.name || 'Viewer'); };
  Viewer.prototype.leave = function () { this.unsub.forEach(function (u) { try { u(); } catch (e) { } }); if (this.pc) this.pc.close(); };

  // A viewer checks the password against the room's sealed token before joining,
  // so a wrong password is reported at once instead of after the host approves.
  function checkPassword(meta, password, sid) {
    if (!meta || !meta.locked) return Promise.resolve(true);
    if (!meta.check) return Promise.resolve(true);
    return open(meta.check, password, sid).then(function (o) { return !!(o && o.ok === 'layerlink'); }, function () { return false; });
  }

  // Where a video of vw x vh is drawn inside a cw x ch box with object-fit: contain.
  function fitRect(vw, vh, cw, ch) {
    if (!vw || !vh || !cw || !ch) return { x: 0, y: 0, w: cw || 0, h: ch || 0 };
    var s = Math.min(cw / vw, ch / vh), w = vw * s, h = vh * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h };
  }

  // Annotation layer: a canvas over the video. Points are stored as fractions of the
  // video picture (not of the canvas), so a stroke lands on the same spot of the shared
  // screen for everyone, whatever their window size.
  function Board(canvas, video, onStroke) {
    var self = this;
    this.canvas = canvas; this.video = video; this.strokes = []; this.enabled = false; this.color = '#f43f5e'; this.cur = null;
    var ctx = canvas.getContext('2d');
    function rect() { return fitRect(video.videoWidth, video.videoHeight, canvas.clientWidth, canvas.clientHeight); }
    function norm(e) { var b = canvas.getBoundingClientRect(), r = rect(); return [Math.round(((e.clientX - b.left - r.x) / r.w) * 10000) / 10000, Math.round(((e.clientY - b.top - r.y) / r.h) * 10000) / 10000]; }
    this.redraw = function () {
      var dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      var r = rect();
      self.strokes.concat(self.cur ? [self.cur] : []).forEach(function (st) {
        if (!st.pts || st.pts.length < 1) return;
        ctx.strokeStyle = st.color || '#f43f5e'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        st.pts.forEach(function (p, i) { var x = r.x + p[0] * r.w, y = r.y + p[1] * r.h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        if (st.pts.length === 1) ctx.lineTo(r.x + st.pts[0][0] * r.w + 0.1, r.y + st.pts[0][1] * r.h);
        ctx.stroke();
      });
    };
    canvas.addEventListener('pointerdown', function (e) { if (!self.enabled) return; e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (err) { } self.cur = { pts: [norm(e)], color: self.color }; self.redraw(); });
    canvas.addEventListener('pointermove', function (e) { if (!self.cur) return; self.cur.pts.push(norm(e)); if (self.cur.pts.length > 2000) self.cur.pts.shift(); self.redraw(); });
    function end() { if (!self.cur) return; var st = self.cur; self.cur = null; self.strokes.push(st); self.redraw(); if (onStroke) onStroke(st); }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { self.redraw(); }).observe(canvas);
    video.addEventListener('loadedmetadata', function () { self.redraw(); });
    video.addEventListener('resize', function () { self.redraw(); });
  }
  Board.prototype.setEnabled = function (on) { this.enabled = !!on; this.canvas.style.pointerEvents = on ? 'auto' : 'none'; this.canvas.style.cursor = on ? 'crosshair' : ''; };
  Board.prototype.add = function (st) { if (st && Array.isArray(st.pts)) { this.strokes.push({ pts: st.pts.slice(0, 2000), color: /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : '#f43f5e' }); this.redraw(); } };
  Board.prototype.clear = function () { this.strokes = []; this.cur = null; this.redraw(); };

  // One outgoing stream: the captured video plus, when both are present, the captured
  // audio and the microphone mixed into a single track (a recording keeps only one).
  function mixAudio(tracks) {
    tracks = tracks.filter(Boolean);
    if (tracks.length < 2) return { track: tracks[0] || null, close: function () { } };
    var AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), dest = ac.createMediaStreamDestination();
    tracks.forEach(function (t) { ac.createMediaStreamSource(new MediaStream([t])).connect(dest); });
    return { track: dest.stream.getAudioTracks()[0], close: function () { try { ac.close(); } catch (e) { } } };
  }

  // -------------------------------------------------------------- recording
  function recorder(stream) {
    var types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    var type = types.filter(function (t) { return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t); })[0] || '';
    var rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), parts = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
    return {
      start: function () { rec.start(1000); },
      stop: function () { return new Promise(function (res) { rec.onstop = function () { res(new Blob(parts, { type: rec.mimeType || 'video/webm' })); }; rec.stop(); }); },
      type: function () { return rec.mimeType || type || 'video/webm'; }
    };
  }

  return { firebaseSignal: firebaseSignal, localSignal: localSignal, seal: seal, open: open, checkPassword: checkPassword, fitRect: fitRect, Board: Board, mixAudio: mixAudio, Sharer: Sharer, Viewer: Viewer, recorder: recorder, sessionId: function () { return Math.random().toString(36).substring(2, 8); } };
});
