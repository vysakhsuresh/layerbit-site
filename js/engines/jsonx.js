/* Layerbit JSON extras: the JSON Formatter's readers, converters and
 * layouts that are not plain JSON. Pure functions, no DOM. Browser / Worker
 * (self.LBJsonX) and Node (module.exports). Numbers come back as
 * LosslessNumbers (js/engines/lossless-json.js), so nothing is rounded.
 *
 * parseDialect(text, 'json5' | 'jsonc') -> {value, notes}
 *     JSONC: JSON plus comments and trailing commas (VS Code settings,
 *     tsconfig). JSON5: also unquoted keys, single quotes, hex, leading or
 *     trailing decimal points, + signs, line continuations, Infinity / NaN
 *     (no JSON form: written as null, listed in notes). Errors carry line
 *     and column.
 * xmlToJson(text) -> value: attributes as "@name", text beside elements as
 *     "#text", repeated elements as arrays, an element with only text as a
 *     string. A small well-formed-XML reader (no DTD processing, so no
 *     entity expansion attacks).
 * jsonToXml(value, {root}) -> text, the same conventions back
 * sampleFromSchema(schema) -> a document that satisfies the schema (types,
 *     required, enum, const, default, examples, formats, ranges, lengths,
 *     $ref, allOf, oneOf/anyOf)
 * graph(value, {maxNodes}) -> {nodes, edges, truncated, width, height}: one
 *     node per object or array listing its plain values; laid out left to
 *     right
 * compare(a, b) -> [{kind: added | removed | changed, path, from, to}]
 * findTables(value) -> [{path, count}] arrays of objects, largest first
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lossless-json.js'));
  else root.LBJsonX = factory(root.LBLossless);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  var isLN = L.isLosslessNumber;
  function setKey(o, k, v) { if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); else o[k] = v; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !isLN(v); }
  function childPath(base, key) { return typeof key === 'number' ? base + '[' + key + ']' : /^[A-Za-z_$][\w$]*$/.test(key) ? base + '.' + key : base + "['" + String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']"; }

  // ---- JSON5 / JSONC
  function parseDialect(text, dialect) {
    var s = String(text), i = 0, n = s.length, notes = [], json5 = dialect === 'json5';
    if (s.charCodeAt(0) === 0xFEFF) i = 1;
    function where(p) { var before = s.slice(0, p), line = before.split(/\r\n|\n|\r/).length; return 'line ' + line + ', column ' + (p - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))); }
    function fail(msg, p) { var e = new SyntaxError(msg + ' at ' + where(p == null ? i : p)); e.pos = p == null ? i : p; throw e; }
    function only5(what, p) { if (!json5) fail(what + ' is allowed in JSON5 but not in JSONC (JSON with comments)', p); }
    function ws() {
      for (;;) {
        var c = s[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿' || (json5 && (c === ' ' || c === ' ' || c === ' ' || c === '\v' || c === '\f'))) { i++; continue; }
        if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
        if (c === '/' && s[i + 1] === '*') { var e = s.indexOf('*/', i + 2); if (e < 0) fail('A /* comment is never closed'); i = e + 2; continue; }
        return;
      }
    }
    function str(q) {
      var start = i; i++;
      var out = '';
      for (;;) {
        if (i >= n) fail('Unterminated string (end of input)', start);
        var c = s[i++];
        if (c === q) return out;
        if (c === '\n' || c === '\r') fail('A line break inside a string must be escaped', i - 1);
        if (c !== '\\') { out += c; continue; }
        var e = s[i++];
        if (e === 'n') out += '\n'; else if (e === 't') out += '\t'; else if (e === 'r') out += '\r'; else if (e === 'b') out += '\b'; else if (e === 'f') out += '\f';
        else if (e === '"' || e === '\\' || e === '/') out += e;
        else if (e === 'u') { var h = s.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('Bad \\u escape', i); out += String.fromCharCode(parseInt(h, 16)); i += 4; }
        else if (json5 && e === "'") out += "'";
        else if (json5 && e === 'x') { var hx = s.slice(i, i + 2); if (!/^[0-9a-fA-F]{2}$/.test(hx)) fail('Bad \\x escape', i); out += String.fromCharCode(parseInt(hx, 16)); i += 2; }
        else if (json5 && e === 'v') out += '\v';
        else if (json5 && e === '0' && !/[0-9]/.test(s[i])) out += '\0';
        else if (json5 && (e === '\n' || e === '\r' || e === ' ' || e === ' ')) { if (e === '\r' && s[i] === '\n') i++; }
        else if (json5 && e !== undefined && !/[0-9]/.test(e)) out += e;
        else fail('Bad escape \\' + (e || ''), i - 1);
      }
    }
    function num(path) {
      var start = i, sign = '';
      if (s[i] === '+' || s[i] === '-') { if (s[i] === '+') only5('A + sign', i); sign = s[i] === '-' ? '-' : ''; i++; }
      if (s.startsWith('Infinity', i)) { only5('Infinity', start); i += 8; notes.push((sign ? '-' : '') + 'Infinity at ' + path + ' has no JSON form; written as null.'); return null; }
      if (s.startsWith('NaN', i)) { only5('NaN', start); i += 3; notes.push('NaN at ' + path + ' has no JSON form; written as null.'); return null; }
      if (s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
        only5('A hexadecimal number', start); i += 2; var hs = i; while (/[0-9a-fA-F]/.test(s[i] || '')) i++;
        if (i === hs) fail('Bad hexadecimal number', start);
        var dec = typeof BigInt === 'function' ? BigInt('0x' + s.slice(hs, i)).toString() : String(parseInt(s.slice(hs, i), 16));
        return new L.LosslessNumber(sign + dec);
      }
      var body = i;
      while (/[0-9]/.test(s[i] || '')) i++;
      var intPart = s.slice(body, i), frac = '';
      if (s[i] === '.') { i++; var fs = i; while (/[0-9]/.test(s[i] || '')) i++; frac = s.slice(fs, i); if (!intPart && !frac) fail('Bad number', start); if (!intPart || !frac) only5('A number with a leading or trailing decimal point', start); }
      else if (!intPart) fail('Unexpected character ' + JSON.stringify(s[start] || 'end of input'), start);
      if (intPart.length > 1 && intPart[0] === '0') fail('A number cannot start with 0', start);
      var exp = '';
      if (s[i] === 'e' || s[i] === 'E') { var es = i; i++; if (s[i] === '+' || s[i] === '-') i++; var ds = i; while (/[0-9]/.test(s[i] || '')) i++; if (i === ds) fail('Bad exponent', es); exp = s.slice(es, i); }
      var txt = sign + (intPart || '0') + (frac ? '.' + frac : '') + exp;
      return new L.LosslessNumber(txt);
    }
    function key() {
      var c = s[i];
      if (c === '"') return str('"');
      if (c === "'") { only5('A single-quoted key', i); return str("'"); }
      var m = /^[A-Za-z_$À-￿][\w$À-￿]*/.exec(s.slice(i, i + 256));
      if (m) { only5('An unquoted key', i); i += m[0].length; return m[0]; }
      fail('Expected a key in double quotes');
    }
    function value(path, depth) {
      if (depth > 4000) fail('Nested too deeply');
      ws();
      var c = s[i];
      if (c === '{') {
        i++; var o = {}; ws();
        if (s[i] === '}') { i++; return o; }
        for (;;) {
          ws(); var k = key(); ws();
          if (s[i] !== ':') fail('Expected : after the key ' + JSON.stringify(k));
          i++; setKey(o, k, value(childPath(path, k), depth + 1)); ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === '}') { i++; return o; } continue; }
          if (s[i] === '}') { i++; return o; }
          fail(i >= n ? 'The object is not closed (end of input)' : 'Expected , or } after a value');
        }
      }
      if (c === '[') {
        i++; var a = []; ws();
        if (s[i] === ']') { i++; return a; }
        for (;;) {
          a.push(value(path + '[' + a.length + ']', depth + 1)); ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === ']') { i++; return a; } continue; }
          if (s[i] === ']') { i++; return a; }
          fail(i >= n ? 'The array is not closed (end of input)' : 'Expected , or ] after a value');
        }
      }
      if (c === '"') return str('"');
      if (c === "'") { only5('A single-quoted string', i); return str("'"); }
      if (s.startsWith('true', i)) { i += 4; return true; }
      if (s.startsWith('false', i)) { i += 5; return false; }
      if (s.startsWith('null', i)) { i += 4; return null; }
      if (i >= n) fail('Unexpected end of input');
      return num(path);
    }
    var v = value('$', 0); ws();
    if (i < n) fail('Unexpected text after the document');
    return { value: v, notes: notes };
  }

  // ---- XML -> JSON (a small reader for well-formed documents)
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decodeEnt(t, failAt) {
    return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/g, function (m, e) {
      if (e[0] === '#') { var cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch (x) { return m; } }
      if (ENT.hasOwnProperty(e)) return ENT[e];
      failAt('Unknown entity &' + e + ';');
    });
  }
  function xmlToJson(text) {
    var s = String(text), i = 0, n = s.length;
    if (s.charCodeAt(0) === 0xFEFF) i = 1;
    function where(p) { var b = s.slice(0, p); return 'line ' + b.split('\n').length + ', column ' + (p - b.lastIndexOf('\n')); }
    function fail(msg, p) { throw new SyntaxError(msg + ' at ' + where(p == null ? i : p)); }
    var NAME = /^[A-Za-z_:À-￿][\w.:·À-￿-]*/;
    function skipMisc() {
      for (;;) {
        while (/\s/.test(s[i] || '')) i++;
        if (s.startsWith('<?', i)) { var e = s.indexOf('?>', i); if (e < 0) fail('A <? instruction is not closed'); i = e + 2; continue; }
        if (s.startsWith('<!--', i)) { var c = s.indexOf('-->', i); if (c < 0) fail('A comment is not closed'); i = c + 3; continue; }
        if (s.startsWith('<!DOCTYPE', i)) { var depth = 0; for (; i < n; i++) { if (s[i] === '[') depth++; else if (s[i] === ']') depth--; else if (s[i] === '>' && depth <= 0) { i++; break; } } continue; }
        return;
      }
    }
    function element() {
      var start = i;
      if (s[i] !== '<') fail('Expected an element');
      i++;
      var m = NAME.exec(s.slice(i, i + 512)); if (!m) fail('Bad element name');
      var name = m[0]; i += name.length;
      var obj = {}, hasAttr = false;
      for (;;) {
        while (/\s/.test(s[i] || '')) i++;
        if (s[i] === '/' && s[i + 1] === '>') { i += 2; return { name: name, value: hasAttr ? obj : '' }; }
        if (s[i] === '>') { i++; break; }
        var am = NAME.exec(s.slice(i, i + 512)); if (!am) fail(i >= n ? 'The tag <' + name + '> is not closed (end of input)' : 'Bad attribute in <' + name + '>');
        i += am[0].length; while (/\s/.test(s[i] || '')) i++;
        if (s[i] !== '=') fail('Expected = after the attribute ' + am[0]);
        i++; while (/\s/.test(s[i] || '')) i++;
        var q = s[i]; if (q !== '"' && q !== "'") fail('Attribute values need quotes');
        var e = s.indexOf(q, i + 1); if (e < 0) fail('An attribute value is not closed');
        var ap = i; setKey(obj, '@' + am[0], decodeEnt(s.slice(i + 1, e), function (msg) { fail(msg, ap); })); hasAttr = true; i = e + 1;
      }
      var text = '', kids = 0, onlyText = true;
      for (;;) {
        if (i >= n) fail('<' + name + '> (opened at ' + where(start) + ') is not closed (end of input)');
        if (s.startsWith('</', i)) {
          var cm = NAME.exec(s.slice(i + 2, i + 514)), close = cm ? cm[0] : '';
          if (close !== name) fail('Expected </' + name + '> but found </' + close + '>');
          i += 2 + close.length; while (/\s/.test(s[i] || '')) i++;
          if (s[i] !== '>') fail('Bad closing tag');
          i++; break;
        }
        if (s.startsWith('<!--', i)) { var ce = s.indexOf('-->', i); if (ce < 0) fail('A comment is not closed'); i = ce + 3; continue; }
        if (s.startsWith('<![CDATA[', i)) { var de = s.indexOf(']]>', i); if (de < 0) fail('A CDATA section is not closed'); text += s.slice(i + 9, de); i = de + 3; continue; }
        if (s.startsWith('<?', i)) { var pe = s.indexOf('?>', i); if (pe < 0) fail('A <? instruction is not closed'); i = pe + 2; continue; }
        if (s[i] === '<') {
          var child = element(); kids++; onlyText = false;
          if (Object.prototype.hasOwnProperty.call(obj, child.name)) { var cur = obj[child.name]; if (!Array.isArray(cur) || !cur.__lbMulti) { cur = [cur]; Object.defineProperty(cur, '__lbMulti', { value: true }); setKey(obj, child.name, cur); } cur.push(child.value); }
          else setKey(obj, child.name, child.value);
          continue;
        }
        var lt = s.indexOf('<', i); if (lt < 0) lt = n;
        var tp = i; text += decodeEnt(s.slice(i, lt), function (msg) { fail(msg, tp); }); i = lt;
      }
      var t = kids ? text.trim() : text;
      if (!hasAttr && onlyText) return { name: name, value: kids ? '' : t.trim() === '' ? '' : t };
      if (t.trim() !== '') setKey(obj, '#text', kids ? t : t);
      return { name: name, value: obj };
    }
    skipMisc();
    if (i >= n) fail('No root element');
    var r = element(); skipMisc();
    if (i < n) fail('Text after the root element');
    var out = {}; setKey(out, r.name, r.value);
    return JSON.parse(JSON.stringify(out));
  }

  // ---- JSON -> XML
  function xmlName(k) {
    var x = String(k).replace(/[^\w.:-]/g, '_');
    if (!/^[A-Za-z_]/.test(x)) x = '_' + x;
    return x;
  }
  function escX(t, attr) { var r = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); return attr ? r.replace(/"/g, '&quot;') : r; }
  function scalarText(v) { return isLN(v) ? v.value : v === null ? '' : String(v); }
  function jsonToXml(value, o) {
    o = o || {};
    var out = ['<?xml version="1.0" encoding="UTF-8"?>'];
    function el(name, v, pad) {
      var tag = xmlName(name);
      if (Array.isArray(v)) { v.forEach(function (x) { el(name, x, pad); }); return; }
      if (isObj(v)) {
        var keys = Object.keys(v), attrs = '', kids = [], text = null;
        keys.forEach(function (k) {
          if (k[0] === '@' && k.length > 1 && !isObj(v[k]) && !Array.isArray(v[k])) attrs += ' ' + xmlName(k.slice(1)) + '="' + escX(scalarText(v[k]), true) + '"';
          else if (k === '#text') text = scalarText(v[k]);
          else kids.push(k);
        });
        if (!kids.length) { out.push(pad + '<' + tag + attrs + (text === null || text === '' ? '/>' : '>' + escX(text) + '</' + tag + '>')); return; }
        out.push(pad + '<' + tag + attrs + '>');
        if (text !== null && text !== '') out.push(pad + '  ' + escX(text));
        kids.forEach(function (k) { el(k, v[k], pad + '  '); });
        out.push(pad + '</' + tag + '>');
        return;
      }
      if (v === null || v === undefined || v === '') { out.push(pad + '<' + tag + '/>'); return; }
      out.push(pad + '<' + tag + '>' + escX(scalarText(v)) + '</' + tag + '>');
    }
    var keys = isObj(value) ? Object.keys(value) : [];
    if (keys.length === 1 && !Array.isArray(value[keys[0]])) el(keys[0], value[keys[0]], '');
    else el(o.root || 'root', Array.isArray(value) ? { item: value } : value, '');
    return out.join('\n') + '\n';
  }

  // ---- sample documents from a JSON Schema
  function sampleFromSchema(schema) {
    var rootSchema = schema, seq = 0;
    function resolve(ref) {
      if (typeof ref !== 'string' || ref[0] !== '#') return {};
      return ref.slice(1).split('/').filter(Boolean).reduce(function (o, k) { k = k.replace(/~1/g, '/').replace(/~0/g, '~'); return o && typeof o === 'object' ? o[k] : undefined; }, rootSchema) || {};
    }
    function merge(list) { var out = {}; list.forEach(function (s) { Object.keys(s || {}).forEach(function (k) { if (k === 'properties') out.properties = Object.assign({}, out.properties, s.properties); else if (k === 'required') out.required = (out.required || []).concat(s.required); else out[k] = s[k]; }); }); return out; }
    function hex(len) { var t = ''; for (var k = 0; k < len; k++) t += '0123456789abcdef'[(seq * 7 + k * 13 + 5) % 16]; return t; }
    function str(s) {
      var f = s.format, v;
      if (f === 'email') v = 'user@example.com';
      else if (f === 'uuid') { seq++; v = hex(8) + '-' + hex(4) + '-4' + hex(3) + '-a' + hex(3) + '-' + hex(12); }
      else if (f === 'date-time') v = '2026-01-15T09:30:00Z';
      else if (f === 'date') v = '2026-01-15';
      else if (f === 'time') v = '09:30:00';
      else if (f === 'uri' || f === 'url' || f === 'iri') v = 'https://example.com/';
      else if (f === 'hostname') v = 'example.com';
      else if (f === 'ipv4') v = '192.0.2.1';
      else if (f === 'ipv6') v = '2001:db8::1';
      else v = 'string';
      var min = s.minLength || 0, max = s.maxLength == null ? Infinity : s.maxLength;
      while (v.length < min) v += 'x';
      if (v.length > max) v = v.slice(0, max);
      return v;
    }
    function numb(s, integer) {
      var lo = s.minimum != null ? s.minimum : s.exclusiveMinimum != null ? s.exclusiveMinimum + (integer ? 1 : 0.5) : null;
      var hi = s.maximum != null ? s.maximum : s.exclusiveMaximum != null ? s.exclusiveMaximum - (integer ? 1 : 0.5) : null;
      var v = lo != null ? lo : hi != null ? Math.min(0, hi) : 0;
      if (integer) v = Math.ceil(v);
      if (s.multipleOf) v = Math.ceil(v / s.multipleOf) * s.multipleOf;
      return v;
    }
    function gen(s, depth) {
      if (s === true || s == null) return null;
      if (s === false) return null;
      if (s.$ref) { if (depth > 6) return null; return gen(Object.assign({}, resolve(s.$ref), (function () { var c = Object.assign({}, s); delete c.$ref; return c; })()), depth + 1); }
      if (s.const !== undefined) return s.const;
      if (s.default !== undefined) return s.default;
      if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
      if (s.example !== undefined) return s.example;
      if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
      if (s.allOf) return gen(merge(s.allOf.concat([(function () { var c = Object.assign({}, s); delete c.allOf; return c; })()])), depth + 1);
      if (s.oneOf || s.anyOf) return gen((s.oneOf || s.anyOf)[0], depth + 1);
      var type = Array.isArray(s.type) ? s.type[0] : s.type;
      if (!type) type = s.properties ? 'object' : s.items ? 'array' : 'string';
      if (type === 'object') {
        var o = {}, props = s.properties || {}, req = s.required || [];
        Object.keys(props).forEach(function (k) { if (depth < 8 || req.indexOf(k) >= 0) { var v = gen(props[k], depth + 1); if (v !== undefined && (depth < 6 || req.indexOf(k) >= 0)) setKey(o, k, v); } });
        req.forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(o, k)) setKey(o, k, depth > 6 ? null : 'value'); });
        return o;
      }
      if (type === 'array') {
        var count = Math.max(s.minItems || 1, 1); if (s.maxItems != null) count = Math.min(count, s.maxItems);
        if (depth > 6) count = s.minItems || 0;
        var a = [];
        if (Array.isArray(s.prefixItems)) s.prefixItems.forEach(function (p) { a.push(gen(p, depth + 1)); });
        while (a.length < count) a.push(gen(s.items || {}, depth + 1));
        return a;
      }
      if (type === 'integer') return numb(s, true);
      if (type === 'number') return numb(s, false);
      if (type === 'boolean') return false;
      if (type === 'null') return null;
      return str(s);
    }
    return gen(schema, 0);
  }

  // ---- graph layout
  function scalarShort(v) {
    if (isLN(v)) return v.value;
    if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 57) + '…' : v);
    return String(v);
  }
  function graph(value, o) {
    o = o || {};
    var max = o.maxNodes || 1500, maxFields = o.maxFields || 40, COLW = 300, GAP = 26, HEAD = 26, ROW = 20;
    var nodes = [], edges = [], truncated = 0;
    function add(v, path, depth, label) {
      if (nodes.length >= max) { truncated++; return null; }
      var isArr = Array.isArray(v), keys = isArr ? v.map(function (_, k) { return k; }) : Object.keys(v);
      var node = { id: nodes.length, path: path, depth: depth, kind: isArr ? 'array' : 'object', label: label, count: keys.length, fields: [], more: 0, children: [] };
      nodes.push(node);
      keys.forEach(function (k) {
        var c = v[k], cp = childPath(path, k);
        if (c !== null && typeof c === 'object' && !isLN(c)) {
          var child = add(c, cp, depth + 1, String(k));
          if (child) { edges.push({ from: node.id, to: child.id, label: String(k) }); node.children.push(child); }
        } else if (node.fields.length < maxFields) node.fields.push({ key: String(k), text: scalarShort(c), kind: c === null ? 'null' : isLN(c) ? 'number' : typeof c, path: cp });
        else node.more++;
      });
      node.w = COLW - 40; node.h = HEAD + ROW * (node.fields.length + (node.more ? 1 : 0)) + 8;
      return node;
    }
    if (value === null || typeof value !== 'object' || isLN(value)) return { nodes: [], edges: [], truncated: 0, width: 0, height: 0 };
    add(value, '$', 0, value && Array.isArray(value) ? 'array' : 'root');
    // tidy layout: leaves stacked in order, a parent centred on its children
    var nextY = 0;
    function place(nd) {
      nd.x = nd.depth * COLW;
      if (!nd.children.length) { nd.y = nextY; nextY += nd.h + GAP; return; }
      nd.children.forEach(place);
      var first = nd.children[0], last = nd.children[nd.children.length - 1];
      var mid = (first.y + last.y + last.h) / 2 - nd.h / 2;
      nd.y = Math.max(mid, 0);
    }
    place(nodes[0]);
    // keep each column free of overlaps (a tall parent can reach a neighbour)
    var cols = {};
    nodes.forEach(function (nd) { (cols[nd.depth] = cols[nd.depth] || []).push(nd); });
    Object.keys(cols).forEach(function (d) {
      var col = cols[d].sort(function (a, b) { return a.y - b.y; }), floor = 0;
      col.forEach(function (nd) { if (nd.y < floor) nd.y = floor; floor = nd.y + nd.h + GAP; });
    });
    var width = 0, height = 0;
    nodes.forEach(function (nd) { width = Math.max(width, nd.x + nd.w); height = Math.max(height, nd.y + nd.h); delete nd.children; });
    return { nodes: nodes, edges: edges, truncated: truncated, width: width, height: height };
  }

  // ---- structural compare
  function numEq(a, b) { return L.canonicalNumber(a.value) === L.canonicalNumber(b.value); }
  function compare(a, b) {
    var out = [];
    function walk(x, y, path) {
      if (isLN(x) && isLN(y)) { if (!numEq(x, y)) out.push({ kind: 'changed', path: path, from: x, to: y }); return; }
      if (Array.isArray(x) && Array.isArray(y)) {
        for (var i = 0; i < Math.max(x.length, y.length); i++) {
          if (i >= y.length) out.push({ kind: 'removed', path: path + '[' + i + ']', from: x[i] });
          else if (i >= x.length) out.push({ kind: 'added', path: path + '[' + i + ']', to: y[i] });
          else walk(x[i], y[i], path + '[' + i + ']');
        }
        return;
      }
      if (isObj(x) && isObj(y)) {
        Object.keys(x).forEach(function (k) { var p = childPath(path, k); if (!Object.prototype.hasOwnProperty.call(y, k)) out.push({ kind: 'removed', path: p, from: x[k] }); else walk(x[k], y[k], p); });
        Object.keys(y).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(x, k)) out.push({ kind: 'added', path: childPath(path, k), to: y[k] }); });
        return;
      }
      if (x !== y) out.push({ kind: 'changed', path: path, from: x, to: y });
    }
    walk(a, b, '$');
    return out;
  }

  // ---- arrays of objects, for the table view
  function findTables(value) {
    var out = [], seen = 0;
    function walk(v, path, depth) {
      if (seen++ > 200000 || depth > 50) return;
      if (Array.isArray(v)) {
        var objs = v.filter(isObj).length;
        if (v.length && objs >= Math.max(1, v.length * 0.8)) out.push({ path: path, count: v.length });
        v.slice(0, 50).forEach(function (x, i) { if (x && typeof x === 'object') walk(x, path + '[' + i + ']', depth + 1); });
      } else if (isObj(v)) Object.keys(v).forEach(function (k) { walk(v[k], childPath(path, k), depth + 1); });
    }
    walk(value, '$', 0);
    return out.sort(function (a, b) { return b.count - a.count; }).slice(0, 30);
  }

  return { parseDialect: parseDialect, xmlToJson: xmlToJson, jsonToXml: jsonToXml, sampleFromSchema: sampleFromSchema, graph: graph, compare: compare, findTables: findTables, childPath: childPath };
});
