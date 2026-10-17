/* Layerbit JSON engine. Pure functions, no DOM.
 *
 * locateError(message, raw)      -> {pos, line, col, message} for a JSON.parse failure
 * repair(text)                   -> {text, fixes[]} : comments, trailing commas, single quotes,
 *                                   unquoted keys, NaN/Infinity, smart quotes, BOM, Python literals
 * query(root, path)              -> [{path, value}] JSONPath subset ($, .k, ['k'], [n], [-1], [*], ..k,
 *                                   [a,b], [s:e], [?(@.x > 1 && @.y == 'z')], .length)
 * validate(schema, value)        -> [{path, keyword, message}] JSON Schema draft-07 / 2020-12 subset
 * inferSchema(value)             -> draft-07 schema with types, required, formats, enums
 * genTypes(value, lang, name)    -> TypeScript / Go / C# / Kotlin / Python / Java / Rust from a sample
 * toSql(value, opts)             -> CREATE TABLE + INSERT statements from an array of objects
 * toCsv(value)                   -> flattened CSV
 * parseNdjson(text)              -> {values, errors}
 * stats(value, raw)              -> counts, depth, sizes
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBJson = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------------------------------------------------------------- errors
  function locateError(message, raw) {
    var pos = -1, m = /position (\d+)/.exec(message);
    if (m) pos = Number(m[1]);
    else if (/end of JSON input/i.test(message)) pos = raw.length;
    else {
      var w = /Unexpected (?:token '(.)'|(non-whitespace character)[^,]*), (?:\.\.\.)?"(.*)"(?:\.\.\.)? is not valid JSON/s.exec(message);
      if (w) {
        var frag = w[3], idx = raw.indexOf(frag);
        if (idx < 0 && frag.length > 1) idx = raw.indexOf(frag.slice(1)) - 1;
        if (idx >= 0) {
          var tok = w[1];
          if (tok) { var best = -1, bestD = Infinity, k = -1; while ((k = frag.indexOf(tok, k + 1)) >= 0) { var d = Math.abs(k - frag.length / 2); if (d < bestD) { bestD = d; best = k; } } pos = best >= 0 ? idx + best : idx; }
          else pos = idx + Math.floor(frag.length / 2);
        }
      }
    }
    if (pos < 0) return { pos: -1, message: message };
    var before = raw.slice(0, pos);
    return { pos: pos, line: before.split('\n').length, col: pos - before.lastIndexOf('\n'), message: message.replace(/\s*\(line \d+ column \d+\)/, '') };
  }

  // --------------------------------------------------------------- repair
  /** Turns "almost JSON" into JSON. Conservative: only rewrites outside strings. */
  function repair(input) {
    var fixes = [], s = input;
    if (s.charCodeAt(0) === 0xFEFF) { s = s.slice(1); fixes.push('removed byte-order mark'); }
    // tokenise respecting strings
    var out = '', i = 0, n = s.length, counts = { comment: 0, single: 0, unquoted: 0, trailing: 0, nan: 0, smart: 0, py: 0, concat: 0 };
    while (i < n) {
      var c = s[i];
      if (c === '"' || c === "'" || c === '“' || c === '”' || c === '‘' || c === '’') {
        var q = c, close = c === '“' || c === '”' ? ['”', '“'] : c === '‘' || c === '’' ? ['’', '‘'] : [c];
        if (q !== '"') { if (q === "'") counts.single++; else counts.smart++; }
        var j = i + 1, str = '';
        var closes = function (k) { if (close.indexOf(s[k]) < 0) return false; if (q === '"') return true; var k2 = k + 1; while (k2 < n && (s[k2] === ' ' || s[k2] === '\t')) k2++; return k2 >= n || ',:}]\n\r'.indexOf(s[k2]) >= 0; };
        while (j < n && !closes(j)) { if (s[j] === '\\' && j + 1 < n) { if (q !== '"' && s[j + 1] === q) { str += q; j += 2; continue; } str += s[j] + s[j + 1]; j += 2; continue; } if (s[j] === '"' && q !== '"') str += '\\"'; else if (s[j] === '\n' && q !== '"') str += '\\n'; else str += s[j]; j++; }
        out += '"' + str + '"'; i = j + 1; continue;
      }
      if (c === '/' && s[i + 1] === '/') { var e = s.indexOf('\n', i); if (e < 0) e = n; i = e; counts.comment++; continue; }
      if (c === '/' && s[i + 1] === '*') { var e2 = s.indexOf('*/', i + 2); i = e2 < 0 ? n : e2 + 2; counts.comment++; continue; }
      if (c === '#' && /^\s*$/.test(out.slice(out.lastIndexOf('\n') + 1))) { var e3 = s.indexOf('\n', i); if (e3 < 0) e3 = n; i = e3; counts.comment++; continue; }
      if (c === ',' ) { var k2 = i + 1; for (;;) { while (k2 < n && /\s/.test(s[k2])) k2++; if (s[k2] === '/' && s[k2 + 1] === '/') { k2 = s.indexOf('\n', k2); if (k2 < 0) k2 = n; continue; } if (s[k2] === '/' && s[k2 + 1] === '*') { k2 = s.indexOf('*/', k2 + 2); k2 = k2 < 0 ? n : k2 + 2; continue; } break; } if (s[k2] === '}' || s[k2] === ']') { counts.trailing++; i++; continue; } }
      if (/[A-Za-z_$]/.test(c)) {
        var m2 = /^[A-Za-z_$][\w$]*/.exec(s.slice(i)), word = m2[0];
        var after = i + word.length, k3 = after; while (k3 < n && /[ \t]/.test(s[k3])) k3++;
        if (s[k3] === ':') { out += '"' + word + '"'; counts.unquoted++; i = after; continue; }
        if (word === 'NaN' || word === 'Infinity' || word === 'undefined') { out += 'null'; counts.nan++; i = after; continue; }
        if (word === 'True' || word === 'False' || word === 'None') { out += { True: 'true', False: 'false', None: 'null' }[word]; counts.py++; i = after; continue; }
        out += word; i = after; continue;
      }
      if (c === '-' && s.slice(i, i + 9) === '-Infinity') { out += 'null'; counts.nan++; i += 9; continue; }
      out += c; i++;
    }
    // second pass: a key that was unquoted but reached via a different path, e.g. numbers as keys
    out = out.replace(/([{,]\s*)(\d+)(\s*:)/g, function (_, a, b, c2) { counts.unquoted++; return a + '"' + b + '"' + c2; });
    if (counts.comment) fixes.push('removed ' + counts.comment + ' comment' + (counts.comment > 1 ? 's' : ''));
    if (counts.single) fixes.push('converted ' + counts.single + ' single-quoted string' + (counts.single > 1 ? 's' : ''));
    if (counts.smart) fixes.push('replaced ' + counts.smart + ' smart quote' + (counts.smart > 1 ? 's' : ''));
    if (counts.unquoted) fixes.push('quoted ' + counts.unquoted + ' bare key' + (counts.unquoted > 1 ? 's' : ''));
    if (counts.trailing) fixes.push('removed ' + counts.trailing + ' trailing comma' + (counts.trailing > 1 ? 's' : ''));
    if (counts.nan) fixes.push('replaced NaN/Infinity/undefined with null (' + counts.nan + ')');
    if (counts.py) fixes.push('converted Python True/False/None (' + counts.py + ')');
    // missing commas between adjacent values on separate lines: "a": 1\n "b": 2
    var before = out;
    out = out.replace(/("|\d|true|false|null|\}|\])(\s*\n\s*)(")/g, function (m0, a, ws, b) { return a + ',' + ws + b; });
    out = out.replace(/,\s*,/g, ',');
    if (out !== before) fixes.push('inserted missing commas between lines');
    return { text: out, fixes: fixes };
  }

  // ---------------------------------------------------------------- query
  function query(root, path) {
    var p = path.trim();
    if (!p || p === '$') return [{ path: '$', value: root }];
    if (p[0] === '$') p = p.slice(1); else if (p[0] !== '.' && p[0] !== '[') p = '.' + p;
    var segs = [], i = 0;
    while (i < p.length) {
      var c = p[i];
      if (c === '.' && p[i + 1] === '.') { i += 2; var m = /^([A-Za-z_$][\w$-]*|\*)/.exec(p.slice(i)); if (!m) throw new Error('expected a key after ".."'); segs.push({ type: 'desc', key: m[1] }); i += m[0].length; continue; }
      if (c === '.') { i++; var m2 = /^([A-Za-z_$][\w$-]*|\*)/.exec(p.slice(i)); if (!m2) throw new Error('expected a key after "."'); segs.push(m2[1] === '*' ? { type: 'wild' } : { type: 'key', key: m2[1] }); i += m2[0].length; continue; }
      if (c === '[') {
        var j = matchBracket(p, i), inner = p.slice(i + 1, j).trim(); i = j + 1;
        if (inner === '*') segs.push({ type: 'wild' });
        else if (/^\?\(/.test(inner)) segs.push({ type: 'filter', expr: inner.slice(2, -1) });
        else if (/^-?\d+$/.test(inner)) segs.push({ type: 'index', index: +inner });
        else if (/^-?\d*:-?\d*(:-?\d+)?$/.test(inner)) { var parts = inner.split(':'); segs.push({ type: 'slice', start: parts[0] === '' ? null : +parts[0], end: parts[1] === '' ? null : +parts[1], step: parts[2] ? +parts[2] : 1 }); }
        else if (/^(['"]).*\1$/.test(inner)) segs.push({ type: 'key', key: inner.slice(1, -1).replace(/\\(.)/g, '$1') });
        else if (inner.indexOf(',') >= 0) segs.push({ type: 'union', keys: inner.split(',').map(function (x) { x = x.trim(); return /^(['"]).*\1$/.test(x) ? x.slice(1, -1) : /^-?\d+$/.test(x) ? +x : x; }) });
        else segs.push({ type: 'key', key: inner });
        continue;
      }
      throw new Error('unexpected "' + p.slice(i, i + 8) + '"');
    }
    var cur = [{ path: '$', value: root }];
    segs.forEach(function (seg) {
      var next = [];
      cur.forEach(function (item) { applySeg(seg, item, next); });
      cur = next;
    });
    return cur;
  }
  function matchBracket(p, i) { var depth = 0, inStr = null; for (var j = i; j < p.length; j++) { var c = p[j]; if (inStr) { if (c === '\\') j++; else if (c === inStr) inStr = null; continue; } if (c === '"' || c === "'") inStr = c; else if (c === '[' || c === '(') depth++; else if (c === ']' || c === ')') { depth--; if (depth === 0 && c === ']') return j; } } throw new Error('unclosed "["'); }
  function childPath(base, key) { return typeof key === 'number' ? base + '[' + key + ']' : /^[A-Za-z_$][\w$]*$/.test(key) ? base + '.' + key : base + "['" + String(key).replace(/'/g, "\\'") + "']"; }
  function applySeg(seg, item, out) {
    var v = item.value, isArr = Array.isArray(v), isObj = v && typeof v === 'object';
    switch (seg.type) {
      case 'key':
        if (seg.key === 'length' && (isArr || typeof v === 'string')) { out.push({ path: item.path + '.length', value: v.length }); return; }
        if (isObj && !isArr && Object.prototype.hasOwnProperty.call(v, seg.key)) out.push({ path: childPath(item.path, seg.key), value: v[seg.key] });
        else if (isArr && /^\d+$/.test(seg.key) && +seg.key < v.length) out.push({ path: childPath(item.path, +seg.key), value: v[+seg.key] });
        return;
      case 'index': if (isArr) { var ix = seg.index < 0 ? v.length + seg.index : seg.index; if (ix >= 0 && ix < v.length) out.push({ path: childPath(item.path, ix), value: v[ix] }); } return;
      case 'wild': if (isArr) v.forEach(function (x, k) { out.push({ path: childPath(item.path, k), value: x }); }); else if (isObj) Object.keys(v).forEach(function (k) { out.push({ path: childPath(item.path, k), value: v[k] }); }); return;
      case 'slice': if (isArr) { var s = seg.start == null ? 0 : seg.start < 0 ? Math.max(0, v.length + seg.start) : seg.start, e = seg.end == null ? v.length : seg.end < 0 ? v.length + seg.end : Math.min(v.length, seg.end); for (var k2 = s; k2 < e; k2 += seg.step || 1) out.push({ path: childPath(item.path, k2), value: v[k2] }); } return;
      case 'union': seg.keys.forEach(function (k) { if (typeof k === 'number' && isArr) { var ix2 = k < 0 ? v.length + k : k; if (v[ix2] !== undefined) out.push({ path: childPath(item.path, ix2), value: v[ix2] }); } else if (isObj && !isArr && k in v) out.push({ path: childPath(item.path, k), value: v[k] }); }); return;
      case 'desc': (function walk(node, path) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) node.forEach(function (x, k) { if (seg.key === '*') out.push({ path: childPath(path, k), value: x }); walk(x, childPath(path, k)); }); else Object.keys(node).forEach(function (k) { if (k === seg.key || seg.key === '*') out.push({ path: childPath(path, k), value: node[k] }); walk(node[k], childPath(path, k)); }); })(v, item.path); return;
      case 'filter': { var list = isArr ? v.map(function (x, k) { return [k, x]; }) : isObj ? Object.keys(v).map(function (k) { return [k, v[k]]; }) : []; list.forEach(function (kv) { if (evalFilter(seg.expr, kv[1])) out.push({ path: childPath(item.path, kv[0]), value: kv[1] }); }); return; }
    }
  }
  // tiny expression evaluator: @.a.b op literal, joined by && / ||, with ! and parentheses; `@.k` alone tests existence
  function evalFilter(expr, ctx) {
    var toks = expr.match(/\s*(&&|\|\||==|!=|>=|<=|>|<|=~|\(|\)|!|@(?:\.[A-Za-z_$][\w$-]*|\[\d+\]|\['[^']*'\])*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|\/(?:[^\/\\]|\\.)+\/[gimsu]*|[A-Za-z_]+)\s*/g);
    if (!toks) throw new Error('empty filter');
    toks = toks.map(function (t) { return t.trim(); });
    var pos = 0;
    function peek() { return toks[pos]; }
    function val(t) {
      if (t === undefined) throw new Error('unexpected end of filter');
      if (t[0] === '@') { var cur = ctx, segs = t.slice(1).match(/\.[A-Za-z_$][\w$-]*|\[\d+\]|\['[^']*'\]/g) || []; for (var k = 0; k < segs.length; k++) { var sgm = segs[k]; var key = sgm[0] === '.' ? sgm.slice(1) : sgm[1] === "'" ? sgm.slice(2, -2) : +sgm.slice(1, -1); if (cur == null) return undefined; cur = cur[key]; } return cur; }
      if (t[0] === "'" || t[0] === '"') return t.slice(1, -1).replace(/\\(.)/g, '$1');
      if (/^-?\d/.test(t)) return +t;
      if (t === 'true') return true; if (t === 'false') return false; if (t === 'null') return null;
      if (t[0] === '/') { var mm = /^\/(.*)\/([gimsu]*)$/.exec(t); return new RegExp(mm[1], mm[2]); }
      throw new Error('bad token "' + t + '"');
    }
    function primary() {
      var t = peek();
      if (t === '(') { pos++; var r = orExpr(); if (peek() !== ')') throw new Error('expected )'); pos++; return r; }
      if (t === '!') { pos++; return !primary(); }
      var left = val(toks[pos++]);
      var op = peek();
      if (op === '==' || op === '!=' || op === '>' || op === '<' || op === '>=' || op === '<=' || op === '=~') {
        pos++; var right = val(toks[pos++]);
        switch (op) { case '==': return left === right; case '!=': return left !== right; case '>': return left > right; case '<': return left < right; case '>=': return left >= right; case '<=': return left <= right; case '=~': return right instanceof RegExp && typeof left === 'string' && right.test(left); }
      }
      return left !== undefined && left !== null && left !== false;
    }
    function andExpr() { var l = primary(); while (peek() === '&&') { pos++; var r = primary(); l = l && r; } return l; }
    function orExpr() { var l = andExpr(); while (peek() === '||') { pos++; var r = andExpr(); l = l || r; } return l; }
    var res = orExpr(); if (pos < toks.length) throw new Error('unexpected "' + toks[pos] + '"'); return !!res;
  }

  // ------------------------------------------------------------- validate
  var FORMATS = {
    'date-time': /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, uri: /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/, 'uri-reference': /^[^\s]*$/, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ipv4: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/, ipv6: /^[0-9a-f:]+$/i, hostname: /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i, regex: null
  };
  function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v; }
  function typeMatches(t, v) { var tv = typeOf(v); return t === tv || (t === 'number' && tv === 'integer'); }
  function deepEqual(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
  function canon(v) { if (Array.isArray(v)) return v.map(canon); if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; } return v; }
  function resolveRef(ref, rootSchema) {
    if (ref[0] !== '#') throw new Error('Only local $ref (#/...) is supported: ' + ref);
    var parts = ref.slice(1).split('/').filter(Boolean).map(function (p) { return decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'); });
    var cur = rootSchema; for (var i = 0; i < parts.length; i++) { if (cur == null || !(parts[i] in cur)) throw new Error('$ref not found: ' + ref); cur = cur[parts[i]]; }
    return cur;
  }
  function validate(schema, value, rootSchema, path, errs, depth) {
    rootSchema = rootSchema || schema; path = path || '$'; errs = errs || []; depth = depth || 0;
    if (depth > 200) { errs.push({ path: path, keyword: '$ref', message: 'schema recursion too deep' }); return errs; }
    if (schema === true || schema === undefined) return errs;
    if (schema === false) { errs.push({ path: path, keyword: 'false', message: 'no value is allowed here' }); return errs; }
    if (schema.$ref) { var target = resolveRef(schema.$ref, rootSchema); validate(target, value, rootSchema, path, errs, depth + 1); var rest = Object.assign({}, schema); delete rest.$ref; if (Object.keys(rest).filter(function (k) { return k[0] !== '$' && k !== 'description' && k !== 'title'; }).length) validate(rest, value, rootSchema, path, errs, depth + 1); return errs; }
    var t = typeOf(value);
    if (schema.type !== undefined) {
      var types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (schema.nullable && value === null) { /* OpenAPI nullable */ }
      else if (!types.some(function (x) { return typeMatches(x, value); })) errs.push({ path: path, keyword: 'type', message: 'expected ' + types.join(' or ') + ', got ' + t });
    }
    if (schema.enum !== undefined && !schema.enum.some(function (e) { return deepEqual(e, value); })) errs.push({ path: path, keyword: 'enum', message: 'must be one of ' + schema.enum.map(function (e) { return JSON.stringify(e); }).join(', ') });
    if (schema.const !== undefined && !deepEqual(schema.const, value)) errs.push({ path: path, keyword: 'const', message: 'must equal ' + JSON.stringify(schema.const) });
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errs.push({ path: path, keyword: 'minimum', message: value + ' is below the minimum ' + schema.minimum });
      if (schema.maximum !== undefined && value > schema.maximum) errs.push({ path: path, keyword: 'maximum', message: value + ' is above the maximum ' + schema.maximum });
      if (schema.exclusiveMinimum !== undefined && typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errs.push({ path: path, keyword: 'exclusiveMinimum', message: value + ' must be greater than ' + schema.exclusiveMinimum });
      if (schema.exclusiveMaximum !== undefined && typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) errs.push({ path: path, keyword: 'exclusiveMaximum', message: value + ' must be less than ' + schema.exclusiveMaximum });
      if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) errs.push({ path: path, keyword: 'multipleOf', message: value + ' is not a multiple of ' + schema.multipleOf });
    }
    if (typeof value === 'string') {
      var len = Array.from(value).length;
      if (schema.minLength !== undefined && len < schema.minLength) errs.push({ path: path, keyword: 'minLength', message: 'string is shorter than ' + schema.minLength + ' characters' });
      if (schema.maxLength !== undefined && len > schema.maxLength) errs.push({ path: path, keyword: 'maxLength', message: 'string is longer than ' + schema.maxLength + ' characters' });
      if (schema.pattern !== undefined) { try { if (!new RegExp(schema.pattern, 'u').test(value)) errs.push({ path: path, keyword: 'pattern', message: 'does not match pattern ' + schema.pattern }); } catch (e) { try { if (!new RegExp(schema.pattern).test(value)) errs.push({ path: path, keyword: 'pattern', message: 'does not match pattern ' + schema.pattern }); } catch (e2) { errs.push({ path: path, keyword: 'pattern', message: 'schema pattern is invalid: ' + e2.message }); } } }
      if (schema.format && FORMATS[schema.format] !== undefined) { var f = FORMATS[schema.format]; if (f === null) { try { new RegExp(value); } catch (e3) { errs.push({ path: path, keyword: 'format', message: 'is not a valid regex' }); } } else if (!f.test(value)) errs.push({ path: path, keyword: 'format', message: 'is not a valid ' + schema.format }); }
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errs.push({ path: path, keyword: 'minItems', message: 'needs at least ' + schema.minItems + ' items, has ' + value.length });
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push({ path: path, keyword: 'maxItems', message: 'allows at most ' + schema.maxItems + ' items, has ' + value.length });
      if (schema.uniqueItems) { var seen = {}; value.forEach(function (x, k) { var key = JSON.stringify(canon(x)); if (seen[key] !== undefined) errs.push({ path: path + '[' + k + ']', keyword: 'uniqueItems', message: 'duplicates item ' + seen[key] }); else seen[key] = k; }); }
      var prefix = schema.prefixItems || (Array.isArray(schema.items) ? schema.items : null);
      if (prefix) prefix.forEach(function (sub, k) { if (k < value.length) validate(sub, value[k], rootSchema, path + '[' + k + ']', errs, depth + 1); });
      var itemsSchema = schema.prefixItems ? schema.items : (Array.isArray(schema.items) ? schema.additionalItems : schema.items);
      if (itemsSchema !== undefined) value.forEach(function (x, k) { if (!prefix || k >= prefix.length) validate(itemsSchema, x, rootSchema, path + '[' + k + ']', errs, depth + 1); });
      if (schema.contains !== undefined && !value.some(function (x) { return validate(schema.contains, x, rootSchema, path, [], depth + 1).length === 0; })) errs.push({ path: path, keyword: 'contains', message: 'no item matches the "contains" schema' });
    }
    if (t === 'object') {
      var keys = Object.keys(value);
      (schema.required || []).forEach(function (k) { if (!(k in value)) errs.push({ path: path, keyword: 'required', message: 'missing required property "' + k + '"' }); });
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) errs.push({ path: path, keyword: 'minProperties', message: 'needs at least ' + schema.minProperties + ' properties' });
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errs.push({ path: path, keyword: 'maxProperties', message: 'allows at most ' + schema.maxProperties + ' properties' });
      keys.forEach(function (k) {
        var sub = path + (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : "['" + k + "']"), handled = false;
        if (schema.properties && k in schema.properties) { validate(schema.properties[k], value[k], rootSchema, sub, errs, depth + 1); handled = true; }
        if (schema.patternProperties) Object.keys(schema.patternProperties).forEach(function (pp) { if (new RegExp(pp).test(k)) { validate(schema.patternProperties[pp], value[k], rootSchema, sub, errs, depth + 1); handled = true; } });
        if (!handled && schema.additionalProperties !== undefined) { if (schema.additionalProperties === false) errs.push({ path: sub, keyword: 'additionalProperties', message: 'property "' + k + '" is not allowed' }); else validate(schema.additionalProperties, value[k], rootSchema, sub, errs, depth + 1); }
        if (schema.propertyNames) validate(schema.propertyNames, k, rootSchema, sub, errs, depth + 1);
      });
      var deps = schema.dependentRequired || (schema.dependencies ? Object.keys(schema.dependencies).reduce(function (o, k) { if (Array.isArray(schema.dependencies[k])) o[k] = schema.dependencies[k]; return o; }, {}) : null);
      if (deps) Object.keys(deps).forEach(function (k) { if (k in value) deps[k].forEach(function (need) { if (!(need in value)) errs.push({ path: path, keyword: 'dependentRequired', message: '"' + k + '" requires "' + need + '"' }); }); });
      if (schema.dependentSchemas) Object.keys(schema.dependentSchemas).forEach(function (k) { if (k in value) validate(schema.dependentSchemas[k], value, rootSchema, path, errs, depth + 1); });
    }
    if (schema.allOf) schema.allOf.forEach(function (s) { validate(s, value, rootSchema, path, errs, depth + 1); });
    if (schema.anyOf && !schema.anyOf.some(function (s) { return validate(s, value, rootSchema, path, [], depth + 1).length === 0; })) errs.push({ path: path, keyword: 'anyOf', message: 'matches none of the anyOf schemas' });
    if (schema.oneOf) { var hits = schema.oneOf.filter(function (s) { return validate(s, value, rootSchema, path, [], depth + 1).length === 0; }).length; if (hits !== 1) errs.push({ path: path, keyword: 'oneOf', message: hits === 0 ? 'matches none of the oneOf schemas' : 'matches ' + hits + ' oneOf schemas, must match exactly one' }); }
    if (schema.not !== undefined && validate(schema.not, value, rootSchema, path, [], depth + 1).length === 0) errs.push({ path: path, keyword: 'not', message: 'must not match the "not" schema' });
    if (schema.if !== undefined) { var ok = validate(schema.if, value, rootSchema, path, [], depth + 1).length === 0; if (ok && schema.then !== undefined) validate(schema.then, value, rootSchema, path, errs, depth + 1); if (!ok && schema.else !== undefined) validate(schema.else, value, rootSchema, path, errs, depth + 1); }
    return errs;
  }

  // ---------------------------------------------------------------- infer
  function detectFormat(s) {
    if (FORMATS['date-time'].test(s)) return 'date-time';
    if (FORMATS.date.test(s)) return 'date';
    if (FORMATS.uuid.test(s)) return 'uuid';
    if (FORMATS.email.test(s)) return 'email';
    if (/^https?:\/\/\S+$/.test(s)) return 'uri';
    if (FORMATS.ipv4.test(s)) return 'ipv4';
    return null;
  }
  /** Merges a sample into an accumulating "shape" record, then renders a schema. */
  function shapeOf(v, acc) {
    acc = acc || { types: {}, count: 0 };
    acc.count++;
    var t = typeOf(v);
    acc.types[t] = (acc.types[t] || 0) + 1;
    if (t === 'object') {
      acc.props = acc.props || {}; acc.objCount = (acc.objCount || 0) + 1;
      Object.keys(v).forEach(function (k) { acc.props[k] = shapeOf(v[k], acc.props[k]); });
    } else if (t === 'array') {
      acc.items = acc.items || null; acc.arrCount = (acc.arrCount || 0) + 1;
      v.forEach(function (x) { acc.items = shapeOf(x, acc.items); });
      acc.minItems = acc.minItems === undefined ? v.length : Math.min(acc.minItems, v.length);
    } else if (t === 'string') {
      acc.values = acc.values || {}; if (Object.keys(acc.values).length < 32) acc.values[v] = (acc.values[v] || 0) + 1;
      var f = detectFormat(v); acc.formats = acc.formats || {}; acc.formats[f || '-'] = (acc.formats[f || '-'] || 0) + 1;
    } else if (t === 'integer' || t === 'number') {
      acc.min = acc.min === undefined ? v : Math.min(acc.min, v); acc.max = acc.max === undefined ? v : Math.max(acc.max, v);
    }
    return acc;
  }
  function schemaFromShape(acc, opts) {
    opts = opts || {};
    var types = Object.keys(acc.types);
    var hasNull = types.indexOf('null') >= 0;
    var nonNull = types.filter(function (t) { return t !== 'null'; });
    if (nonNull.indexOf('number') >= 0 && nonNull.indexOf('integer') >= 0) nonNull = nonNull.filter(function (t) { return t !== 'integer'; });
    var s = {};
    if (nonNull.length === 0) s.type = 'null';
    else if (nonNull.length === 1) s.type = hasNull ? [nonNull[0], 'null'] : nonNull[0];
    else s.type = hasNull ? nonNull.concat('null') : nonNull;
    if (acc.props) {
      s.properties = {}; var req = [];
      Object.keys(acc.props).forEach(function (k) { s.properties[k] = schemaFromShape(acc.props[k], opts); if (acc.props[k].count === acc.objCount) req.push(k); });
      if (req.length) s.required = req;
      if (opts.closed) s.additionalProperties = false;
    }
    if (acc.arrCount) { s.items = acc.items ? schemaFromShape(acc.items, opts) : {}; }
    if (acc.values && nonNull.length === 1 && nonNull[0] === 'string') {
      var vals = Object.keys(acc.values), total = acc.types.string;
      var fmts = Object.keys(acc.formats).filter(function (f) { return f !== '-'; });
      if (fmts.length === 1 && acc.formats[fmts[0]] === total) s.format = fmts[0];
      else if (opts.enums !== false && total >= 4 && vals.length <= Math.max(2, Math.min(8, total / 2)) && vals.every(function (x) { return x.length <= 40; }) && !s.format) s.enum = vals.sort();
    }
    if (opts.ranges && (nonNull[0] === 'integer' || nonNull[0] === 'number') && acc.min !== undefined) { s.minimum = acc.min; s.maximum = acc.max; }
    return s;
  }
  function inferSchema(value, opts) {
    var s = schemaFromShape(shapeOf(value), opts);
    return Object.assign({ $schema: 'http://json-schema.org/draft-07/schema#', title: (opts && opts.title) || 'Root' }, s);
  }

  // ------------------------------------------------------------ type gen
  function pascal(s) { var p = String(s).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(''); if (!p) p = 'Field'; if (/^\d/.test(p)) p = 'N' + p; return p; }
  function camel(s) { var p = pascal(s); return p.charAt(0).toLowerCase() + p.slice(1); }
  function snake(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase().replace(/^_+|_+$/g, '') || 'field'; }
  var IRREGULAR = { data: 'datum', criteria: 'criterion', people: 'person', children: 'child', media: 'medium', indices: 'index', matrices: 'matrix', phenomena: 'phenomenon', items: 'item', entries: 'entry', results: 'result', rows: 'row', records: 'record' };
  function singular(n) { var l = String(n).toLowerCase(); if (IRREGULAR[l]) return IRREGULAR[l]; return /ies$/.test(n) ? n.slice(0, -3) + 'y' : /ses$/.test(n) ? n.slice(0, -2) : /s$/.test(n) && !/ss$/.test(n) ? n.slice(0, -1) : n; }
  function genTypes(value, lang, rootName) {
    rootName = pascal(rootName || 'Root');
    var shape = shapeOf(value);
    var decls = [], used = {};
    function uniq(n) { var b = n, k = 2; while (used[n]) n = b + (k++); used[n] = 1; return n; }
    // returns type expression; emits named declarations for objects
    function typeExpr(acc, nameHint) {
      var types = Object.keys(acc.types).filter(function (t) { return t !== 'null'; });
      var nullable = !!acc.types['null'];
      if (types.indexOf('number') >= 0 && types.indexOf('integer') >= 0) types = types.filter(function (t) { return t !== 'integer'; });
      var exprs = types.map(function (t) {
        if (t === 'object') return emitObject(acc, nameHint);
        if (t === 'array') return arr(acc.items ? typeExpr(acc.items, singular(nameHint)) : L.any);
        return L.prim[t];
      });
      if (!exprs.length) exprs = [L.any];
      var e = exprs.length === 1 ? exprs[0] : L.union(exprs);
      return nullable ? L.nullable(e) : e;
    }
    function arr(inner) { return L.array(inner); }
    function emitObject(acc, nameHint) {
      var name = uniq(pascal(nameHint));
      var fields = Object.keys(acc.props || {}).map(function (k) { return { key: k, optional: acc.props[k].count < acc.objCount, type: typeExpr(acc.props[k], k) }; });
      decls.push(L.object(name, fields));
      return name;
    }
    var L = LANGS[lang];
    if (!L) throw new Error('Unknown language ' + lang);
    var rootExpr = typeExpr(shape, rootName);
    if (rootExpr !== rootName && !(shape.types.object && Object.keys(shape.types).length === 1)) decls.push(L.alias(rootName, rootExpr));
    return (L.header ? L.header + '\n\n' : '') + decls.reverse().join('\n\n') + '\n';
  }
  var LANGS = {
    typescript: { any: 'unknown', prim: { string: 'string', integer: 'number', number: 'number', boolean: 'boolean' }, array: function (t) { return /[ |]/.test(t) ? '(' + t + ')[]' : t + '[]'; }, union: function (xs) { return xs.join(' | '); }, nullable: function (t) { return t + ' | null'; }, alias: function (n, t) { return 'export type ' + n + ' = ' + t + ';'; },
      object: function (n, f) { return 'export interface ' + n + ' {\n' + f.map(function (x) { return '  ' + (/^[A-Za-z_$][\w$]*$/.test(x.key) ? x.key : JSON.stringify(x.key)) + (x.optional ? '?' : '') + ': ' + x.type + ';'; }).join('\n') + '\n}'; } },
    go: { header: 'package main', any: 'interface{}', prim: { string: 'string', integer: 'int64', number: 'float64', boolean: 'bool' }, array: function (t) { return '[]' + t; }, union: function () { return 'interface{}'; }, nullable: function (t) { return t[0] === '*' || t.indexOf('[]') === 0 || t === 'interface{}' ? t : '*' + t; }, alias: function (n, t) { return 'type ' + n + ' = ' + t; },
      object: function (n, f) { return 'type ' + n + ' struct {\n' + f.map(function (x) { return '\t' + pascal(x.key) + ' ' + x.type + ' `json:"' + x.key + (x.optional ? ',omitempty' : '') + '"`'; }).join('\n') + '\n}'; } },
    csharp: { header: 'using System.Text.Json.Serialization;', any: 'object', prim: { string: 'string', integer: 'long', number: 'double', boolean: 'bool' }, array: function (t) { return 'List<' + t + '>'; }, union: function () { return 'object'; }, nullable: function (t) { return t + '?'; }, alias: function (n, t) { return '// ' + n + ' = ' + t; },
      object: function (n, f) { return 'public class ' + n + '\n{\n' + f.map(function (x) { return '    [JsonPropertyName("' + x.key + '")]\n    public ' + x.type + (x.optional && !/\?$/.test(x.type) ? '?' : '') + ' ' + pascal(x.key) + ' { get; set; }'; }).join('\n\n') + '\n}'; } },
    kotlin: { header: 'import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable', any: 'Any', prim: { string: 'String', integer: 'Long', number: 'Double', boolean: 'Boolean' }, array: function (t) { return 'List<' + t + '>'; }, union: function () { return 'Any'; }, nullable: function (t) { return t + '?'; }, alias: function (n, t) { return 'typealias ' + n + ' = ' + t; },
      object: function (n, f) { return '@Serializable\ndata class ' + n + '(\n' + f.map(function (x) { return '    @SerialName("' + x.key + '") val ' + camel(x.key) + ': ' + x.type + (x.optional ? (/\?$/.test(x.type) ? '' : '?') + ' = null' : ''); }).join(',\n') + '\n)'; } },
    python: { header: 'from __future__ import annotations\nfrom dataclasses import dataclass, field\nfrom typing import Any, Optional', any: 'Any', prim: { string: 'str', integer: 'int', number: 'float', boolean: 'bool' }, array: function (t) { return 'list[' + t + ']'; }, union: function (xs) { return xs.join(' | '); }, nullable: function (t) { return 'Optional[' + t + ']'; }, alias: function (n, t) { return n + ' = ' + t; },
      object: function (n, f) { var req = f.filter(function (x) { return !x.optional; }), opt = f.filter(function (x) { return x.optional; }); return '@dataclass\nclass ' + n + ':\n' + (f.length ? req.concat(opt).map(function (x) { return '    ' + snake(x.key) + ': ' + (x.optional ? 'Optional[' + x.type + '] = None' : x.type) + (snake(x.key) !== x.key ? '  # json: "' + x.key + '"' : ''); }).join('\n') : '    pass'); } },
    java: { header: 'import com.fasterxml.jackson.annotation.JsonProperty;\nimport java.util.List;', any: 'Object', prim: { string: 'String', integer: 'Long', number: 'Double', boolean: 'Boolean' }, array: function (t) { return 'List<' + t + '>'; }, union: function () { return 'Object'; }, nullable: function (t) { return t; }, alias: function (n, t) { return '// ' + n + ' = ' + t; },
      object: function (n, f) { return 'public record ' + n + '(\n' + f.map(function (x) { return '    @JsonProperty("' + x.key + '") ' + x.type + ' ' + camel(x.key); }).join(',\n') + '\n) {}'; } },
    rust: { header: 'use serde::{Deserialize, Serialize};', any: 'serde_json::Value', prim: { string: 'String', integer: 'i64', number: 'f64', boolean: 'bool' }, array: function (t) { return 'Vec<' + t + '>'; }, union: function () { return 'serde_json::Value'; }, nullable: function (t) { return 'Option<' + t + '>'; }, alias: function (n, t) { return 'pub type ' + n + ' = ' + t + ';'; },
      object: function (n, f) { return '#[derive(Debug, Serialize, Deserialize)]\npub struct ' + n + ' {\n' + f.map(function (x) { var fname = snake(x.key); return (fname !== x.key ? '    #[serde(rename = "' + x.key + '")]\n' : '') + (x.optional && !/^Option</.test(x.type) ? '    #[serde(skip_serializing_if = "Option::is_none")]\n' : '') + '    pub ' + (fname === 'type' ? 'r#type' : fname) + ': ' + (x.optional && !/^Option</.test(x.type) ? 'Option<' + x.type + '>' : x.type) + ','; }).join('\n') + '\n}'; } }
  };

  // -------------------------------------------------------------- SQL/CSV
  function flatten(obj, prefix, out, sep) {
    out = out || {}; sep = sep || '_';
    Object.keys(obj).forEach(function (k) {
      var v = obj[k], key = prefix ? prefix + sep + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out, sep);
      else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    });
    return out;
  }
  function rowsOf(value) {
    var arr = Array.isArray(value) ? value : value && typeof value === 'object' ? (function () { var k = Object.keys(value).filter(function (x) { return Array.isArray(value[x]) && value[x].length && typeof value[x][0] === 'object'; }); return k.length === 1 ? value[k[0]] : [value]; })() : [value];
    var rows = arr.map(function (r) { return r && typeof r === 'object' && !Array.isArray(r) ? flatten(r) : { value: r }; });
    var cols = []; rows.forEach(function (r) { Object.keys(r).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
    return { rows: rows, cols: cols };
  }
  function sqlType(values, dialect) {
    var ts = {}; values.forEach(function (v) { if (v === null || v === undefined) return; ts[typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'num') : typeof v === 'boolean' ? 'bool' : /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(String(v)) ? 'ts' : 'str'] = 1; });
    var k = Object.keys(ts);
    var maxLen = values.reduce(function (m, v) { return Math.max(m, v == null ? 0 : String(v).length); }, 0);
    if (k.length === 1 && k[0] === 'int') return dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
    if (k.length === 1 && k[0] === 'num' || (k.length === 2 && ts.int && ts.num)) return dialect === 'sqlite' ? 'REAL' : dialect === 'mysql' ? 'DOUBLE' : 'DOUBLE PRECISION';
    if (k.length === 1 && k[0] === 'bool') return dialect === 'sqlite' ? 'INTEGER' : dialect === 'mysql' ? 'TINYINT(1)' : 'BOOLEAN';
    if (k.length === 1 && k[0] === 'ts') return dialect === 'sqlite' ? 'TEXT' : dialect === 'mysql' ? 'DATETIME' : 'TIMESTAMP';
    return dialect === 'sqlite' ? 'TEXT' : maxLen > 255 || dialect === 'postgres' ? 'TEXT' : 'VARCHAR(' + Math.max(16, Math.ceil(maxLen * 1.5 / 16) * 16) + ')';
  }
  function toSql(value, opts) {
    opts = Object.assign({ table: 'data', dialect: 'postgres', batch: 500 }, opts || {});
    var rc = rowsOf(value), q = opts.dialect === 'mysql' ? function (s) { return '`' + s.replace(/`/g, '``') + '`'; } : function (s) { return '"' + s.replace(/"/g, '""') + '"'; };
    var ident = function (s) { return q(snake(s)); };
    var lit = function (v) { if (v === null || v === undefined) return 'NULL'; if (typeof v === 'number') return String(v); if (typeof v === 'boolean') return opts.dialect === 'sqlite' ? (v ? '1' : '0') : opts.dialect === 'mysql' ? (v ? '1' : '0') : (v ? 'TRUE' : 'FALSE'); return "'" + String(v).replace(/'/g, "''").replace(/\\/g, opts.dialect === 'mysql' ? '\\\\' : '\\') + "'"; };
    var out = 'CREATE TABLE ' + ident(opts.table) + ' (\n' + rc.cols.map(function (c) { var vals = rc.rows.map(function (r) { return r[c]; }); var nn = vals.every(function (v) { return v !== null && v !== undefined; }); return '  ' + ident(c) + ' ' + sqlType(vals, opts.dialect) + (nn ? ' NOT NULL' : ''); }).join(',\n') + '\n);\n\n';
    for (var i = 0; i < rc.rows.length; i += opts.batch) {
      var chunk = rc.rows.slice(i, i + opts.batch);
      out += 'INSERT INTO ' + ident(opts.table) + ' (' + rc.cols.map(ident).join(', ') + ') VALUES\n' + chunk.map(function (r) { return '  (' + rc.cols.map(function (c) { return lit(r[c]); }).join(', ') + ')'; }).join(',\n') + ';\n';
    }
    return { sql: out, rows: rc.rows.length, columns: rc.cols };
  }
  function toCsv(value, delim) {
    delim = delim || ',';
    var rc = rowsOf(value), q = function (v) { if (v === null || v === undefined) return ''; var s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) || s.indexOf(delim) >= 0 ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return rc.cols.map(q).join(delim) + '\n' + rc.rows.map(function (r) { return rc.cols.map(function (c) { return q(r[c]); }).join(delim); }).join('\n') + '\n';
  }
  function parseNdjson(text) {
    var values = [], errors = [];
    text.split(/\r?\n/).forEach(function (line, i) { var t = line.trim(); if (!t) return; try { values.push(JSON.parse(t)); } catch (e) { errors.push({ line: i + 1, message: e.message }); } });
    return { values: values, errors: errors };
  }
  function looksNdjson(text) { var lines = text.trim().split(/\r?\n/); if (lines.length < 2) return false; var n = 0; for (var i = 0; i < Math.min(lines.length, 20); i++) { var t = lines[i].trim(); if (!t) continue; if (!/^[\[{]/.test(t) || !/[\]}]$/.test(t)) return false; n++; } return n >= 2 && (function () { try { JSON.parse(text); return false; } catch (e) { return true; } })(); }

  // ---------------------------------------------------------------- stats
  function stats(value, raw) {
    var objects = 0, arrays = 0, keys = 0, primitives = 0, depth = 0, strings = 0, numbers = 0, nulls = 0, bools = 0, maxArr = 0;
    (function walk(v, d) {
      depth = Math.max(depth, d);
      if (Array.isArray(v)) { arrays++; maxArr = Math.max(maxArr, v.length); v.forEach(function (x) { walk(x, d + 1); }); }
      else if (v && typeof v === 'object') { objects++; var ks = Object.keys(v); keys += ks.length; ks.forEach(function (k) { walk(v[k], d + 1); }); }
      else { primitives++; if (typeof v === 'string') strings++; else if (typeof v === 'number') numbers++; else if (v === null) nulls++; else bools++; }
    })(value, 1);
    var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    var bytes = function (s) { return enc ? enc.encode(s).length : Buffer.byteLength(s); };
    var minified = JSON.stringify(value);
    return { objects: objects, arrays: arrays, keys: keys, primitives: primitives, strings: strings, numbers: numbers, nulls: nulls, booleans: bools, depth: depth, maxArray: maxArr, bytesIn: raw != null ? bytes(raw) : null, bytesMin: bytes(minified), bytesPretty: bytes(JSON.stringify(value, null, 2)) };
  }
  function sortKeysDeep(v) { if (Array.isArray(v)) return v.map(sortKeysDeep); if (v && typeof v === 'object') return Object.keys(v).sort().reduce(function (o, k) { o[k] = sortKeysDeep(v[k]); return o; }, {}); return v; }
  /** Finds integers beyond 2^53 in the raw text, which JSON.parse silently rounds. */
  function bigIntWarnings(raw) {
    var out = [], re = /(?:^|[:,\[\s])(-?\d{16,})(?![\d.eE"])/g, m;
    while ((m = re.exec(raw)) && out.length < 20) { var n = m[1]; if (n.replace('-', '').length > 16 || Math.abs(Number(n)) > 9007199254740991) out.push(n); }
    return out;
  }

  return { locateError: locateError, repair: repair, query: query, validate: validate, inferSchema: inferSchema, genTypes: genTypes, TYPE_LANGS: Object.keys(LANGS), toSql: toSql, toCsv: toCsv, flatten: flatten, rowsOf: rowsOf, parseNdjson: parseNdjson, looksNdjson: looksNdjson, stats: stats, sortKeysDeep: sortKeysDeep, bigIntWarnings: bigIntWarnings, typeOf: typeOf };
});
