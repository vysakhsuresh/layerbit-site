/* Layerbit XML validation helpers that need no WebAssembly. Pure
 * functions, no DOM. Browser / Worker (self.LBXmlV) and Node.
 *
 * parseTree(text) -> {doctype: {name, subset} | null, root}
 *     element nodes {name, attrs, children, text, line}; text is the
 *     element's own character data, entities decoded
 * validateDtd(xml, dtdText) -> [{line, message}]
 *     validates against the DTD given, or the document's internal subset:
 *     content models (sequences, choices, ? * +, mixed, EMPTY, ANY),
 *     undeclared elements and attributes, #REQUIRED, #FIXED, enumerations,
 *     ID uniqueness and IDREF / IDREFS targets, and the DOCTYPE root name.
 *     Throws when the DTD itself cannot be read or there is none.
 *
 * XSD and RelaxNG use libxml2 compiled to WebAssembly (js/vendor/xmllint);
 * this build of libxml2 leaves out DTD validation, hence this module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBXmlV = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decode(t) {
    return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/g, function (m, e) {
      if (e[0] === '#') { var cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch (x) { return m; } }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  var NAME = /^[A-Za-z_:À-￿][\w.:·À-￿-]*/;

  function parseTree(text) {
    var s = String(text), i = 0, n = s.length, line = 1, doctype = null;
    if (s.charCodeAt(0) === 0xFEFF) i = 1;
    function adv(to) { for (var k = i; k < to; k++) if (s.charCodeAt(k) === 10) line++; i = to; }
    function fail(msg) { throw new SyntaxError(msg + ' (line ' + line + ')'); }
    function skipTo(str) { var e = s.indexOf(str, i); if (e < 0) fail('Missing ' + str); adv(e + str.length); }
    function misc() {
      for (;;) {
        var ws = /^\s*/.exec(s.slice(i, i + 4096))[0]; adv(i + ws.length);
        if (s.startsWith('<?', i)) { skipTo('?>'); continue; }
        if (s.startsWith('<!--', i)) { skipTo('-->'); continue; }
        if (s.startsWith('<!DOCTYPE', i)) {
          var start = i; adv(i + 9); var ws2 = /^\s*/.exec(s.slice(i))[0]; adv(i + ws2.length);
          var m = NAME.exec(s.slice(i, i + 512)); var name = m ? m[0] : '';
          var depth = 0, subStart = -1, subEnd = -1, q = null;
          for (var k = i; k < n; k++) {
            var c = s[k];
            if (q) { if (c === q) q = null; continue; }
            if (c === '"' || c === "'") { q = c; continue; }
            if (c === '[') { if (depth === 0) subStart = k + 1; depth++; }
            else if (c === ']') { depth--; if (depth === 0) subEnd = k; }
            else if (c === '>' && depth <= 0) { adv(k + 1); break; }
          }
          doctype = { name: name, subset: subStart >= 0 ? s.slice(subStart, subEnd) : '' };
          if (i === start) fail('Unclosed DOCTYPE');
          continue;
        }
        return;
      }
    }
    function element() {
      var startLine = line; adv(i + 1);
      var m = NAME.exec(s.slice(i, i + 512)); if (!m) fail('Bad element name');
      var el = { name: m[0], attrs: {}, children: [], text: '', line: startLine };
      adv(i + m[0].length);
      for (;;) {
        var ws = /^\s*/.exec(s.slice(i, i + 4096))[0]; adv(i + ws.length);
        if (s.startsWith('/>', i)) { adv(i + 2); return el; }
        if (s[i] === '>') { adv(i + 1); break; }
        var am = NAME.exec(s.slice(i, i + 512)); if (!am) fail('Bad attribute in <' + el.name + '>');
        adv(i + am[0].length); var w = /^\s*=\s*/.exec(s.slice(i, i + 64)); if (!w) fail('Expected = after ' + am[0]); adv(i + w[0].length);
        var qc = s[i]; if (qc !== '"' && qc !== "'") fail('Attribute values need quotes');
        var e = s.indexOf(qc, i + 1); if (e < 0) fail('Unclosed attribute value');
        el.attrs[am[0]] = decode(s.slice(i + 1, e)); adv(e + 1);
      }
      for (;;) {
        if (i >= n) fail('<' + el.name + '> is not closed');
        if (s.startsWith('</', i)) { var cm = NAME.exec(s.slice(i + 2, i + 514)); if (!cm || cm[0] !== el.name) fail('Expected </' + el.name + '>'); skipTo('>'); return el; }
        if (s.startsWith('<!--', i)) { skipTo('-->'); continue; }
        if (s.startsWith('<![CDATA[', i)) { var ce = s.indexOf(']]>', i); if (ce < 0) fail('Unclosed CDATA'); el.text += s.slice(i + 9, ce); adv(ce + 3); continue; }
        if (s.startsWith('<?', i)) { skipTo('?>'); continue; }
        if (s[i] === '<') { el.children.push(element()); continue; }
        var lt = s.indexOf('<', i); if (lt < 0) lt = n;
        el.text += decode(s.slice(i, lt)); adv(lt);
      }
    }
    misc();
    if (s[i] !== '<') fail('No root element');
    var rootEl = element(); misc();
    return { doctype: doctype, root: rootEl };
  }

  // ---- DTD
  function parseDtd(text) {
    var s = String(text).replace(/<!--[\s\S]*?-->/g, ' '), pe = {}, elements = {}, attlists = {};
    // parameter entities first, then expand them
    s.replace(/<!ENTITY\s+%\s+([\w.:-]+)\s+(["'])([\s\S]*?)\2\s*>/g, function (m, name, q, val) { pe[name] = val; return ''; });
    for (var k = 0; k < 10 && /%[\w.:-]+;/.test(s); k++) s = s.replace(/%([\w.:-]+);/g, function (m, name) { return pe.hasOwnProperty(name) ? pe[name] : m; });
    var re = /<!(ELEMENT|ATTLIST|ENTITY|NOTATION)\s+([\s\S]*?)>/g, m, count = 0;
    while ((m = re.exec(s))) {
      count++;
      var body = m[2].trim();
      if (m[1] === 'ELEMENT') {
        var em = /^([\w.:-]+)\s+([\s\S]+)$/.exec(body); if (!em) throw new Error('DTD: cannot read <!ELEMENT ' + body + '>');
        elements[em[1]] = compileModel(em[2].trim(), em[1]);
      } else if (m[1] === 'ATTLIST') {
        var am = /^([\w.:-]+)\s+([\s\S]*)$/.exec(body); if (!am) continue;
        var list = attlists[am[1]] = attlists[am[1]] || {};
        var ar = /([\w.:-]+)\s+(CDATA|ID|IDREFS?|ENTITY|ENTITIES|NMTOKENS?|NOTATION\s*\([^)]*\)|\([^)]*\))\s+(#REQUIRED|#IMPLIED|(?:#FIXED\s+)?(?:"[^"]*"|'[^']*'))/g, a;
        while ((a = ar.exec(am[2]))) {
          var def = a[3], fixed = /^#FIXED/.test(def), val = /["']([\s\S]*)["']$/.exec(def);
          var en = /^(?:NOTATION\s*)?\(([^)]*)\)$/.exec(a[2]);
          list[a[1]] = { type: en ? 'enum' : a[2], values: en ? en[1].split('|').map(function (x) { return x.trim(); }) : null, required: def === '#REQUIRED', fixed: fixed, value: val ? val[1] : null };
        }
      }
    }
    var leftover = s.replace(re, '').replace(/<!ENTITY[\s\S]*?>/g, '').trim();
    if (/<!ELEMENT|<!ATTLIST/.test(leftover) || (!count && leftover)) throw new Error('DTD: a declaration is not closed or cannot be read near "' + leftover.slice(0, 60) + '"');
    return { elements: elements, attlists: attlists };
  }
  function escRe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function compileModel(model, name) {
    if (model === 'EMPTY') return { kind: 'empty' };
    if (model === 'ANY') return { kind: 'any' };
    if (/^\(\s*#PCDATA/.test(model)) {
      var names = model.replace(/^\(\s*#PCDATA\s*/, '').replace(/\)\*?$/, '').split('|').map(function (x) { return x.trim(); }).filter(Boolean);
      return { kind: 'mixed', allowed: names };
    }
    var depth = 0;
    for (var k = 0; k < model.length; k++) { if (model[k] === '(') depth++; else if (model[k] === ')') depth--; if (depth < 0) break; }
    if (depth !== 0 || !/^\(/.test(model)) throw new Error('DTD: the content model of ' + name + ' is not balanced: ' + model);
    var src = model.replace(/\s+/g, '').replace(/[\w.:-]+/g, function (nm) { return '(?:' + escRe(nm) + ',)'; }).replace(/,(?=[^)]*?(?:\(|$))|,(?![^(]*\))/g, function (c, off, str) { return c; });
    // commas between particles are sequence (concatenation); inside (?:name,) they stay
    src = src.replace(/\),(?=[(])/g, ')').replace(/\)([?*+]?),(?=\(|\))/g, ')$1').replace(/\(,/g, '(');
    src = cleanSeq(src);
    var rx;
    try { rx = new RegExp('^' + src + '$'); } catch (e) { throw new Error('DTD: cannot read the content model of ' + name + ': ' + model); }
    return { kind: 'children', re: rx, model: model };
  }
  // turns the DTD separators into regex: a,b -> ab ; a|b stays
  function cleanSeq(src) {
    var out = '', i = 0;
    while (i < src.length) {
      if (src.startsWith('(?:', i)) { var e = src.indexOf(',)', i); out += src.slice(i, e + 2); i = e + 2; continue; }
      var c = src[i];
      if (c === ',') { i++; continue; }
      out += c; i++;
    }
    return out;
  }

  function validateDtd(xml, dtdText) {
    var doc = parseTree(xml);
    var text = dtdText && String(dtdText).trim() ? dtdText : doc.doctype && doc.doctype.subset ? doc.doctype.subset : '';
    if (!String(text).trim()) throw new Error('There is no DTD: paste one, or give the document a DOCTYPE with an internal subset.');
    var dtd = parseDtd(text), errs = [], ids = {}, refs = [];
    function err(node, msg) { errs.push({ line: node.line, message: msg }); }
    if (doc.doctype && doc.doctype.name && doc.doctype.name !== doc.root.name) err(doc.root, 'The root element is <' + doc.root.name + '> but the DOCTYPE says <' + doc.doctype.name + '>.');
    (function walk(el) {
      var decl = dtd.elements[el.name], atts = dtd.attlists[el.name] || {};
      if (!decl) err(el, 'Element <' + el.name + '> is not declared in the DTD.');
      else {
        var kids = el.children.map(function (c) { return c.name; }), hasText = el.text.trim() !== '';
        if (decl.kind === 'empty' && (kids.length || el.text !== '')) err(el, 'Element <' + el.name + '> is declared EMPTY but has content.');
        else if (decl.kind === 'mixed') kids.forEach(function (k, j) { if (decl.allowed.indexOf(k) < 0) err(el.children[j], 'Element <' + k + '> is not allowed inside <' + el.name + '> (allowed: text' + (decl.allowed.length ? ', ' + decl.allowed.join(', ') : '') + ').'); });
        else if (decl.kind === 'children') {
          if (hasText) err(el, 'Element <' + el.name + '> may contain only elements, but it has text: "' + el.text.trim().slice(0, 40) + '".');
          if (!decl.re.test(kids.map(function (k) { return k + ','; }).join(''))) err(el, 'The content of <' + el.name + '> (' + (kids.join(', ') || 'nothing') + ') does not match its declaration ' + decl.model + '.');
        }
      }
      Object.keys(el.attrs).forEach(function (a) {
        var d = atts[a], v = el.attrs[a];
        if (!d) { if (decl && !/^xmlns(:|$)/.test(a) && a.indexOf('xml:') !== 0) err(el, 'Attribute ' + a + ' on <' + el.name + '> is not declared.'); return; }
        if (d.fixed && v !== d.value) err(el, 'Attribute ' + a + ' on <' + el.name + '> is fixed to "' + d.value + '" but is "' + v + '".');
        if (d.type === 'enum' && d.values.indexOf(v) < 0) err(el, 'Attribute ' + a + ' on <' + el.name + '> is "' + v + '" but must be one of ' + d.values.join(', ') + '.');
        if (d.type === 'ID') { if (ids[v]) err(el, 'The ID "' + v + '" is used more than once (first on line ' + ids[v] + ').'); else ids[v] = el.line; }
        if (d.type === 'IDREF' || d.type === 'IDREFS') v.split(/\s+/).filter(Boolean).forEach(function (r) { refs.push({ el: el, attr: a, ref: r }); });
      });
      Object.keys(atts).forEach(function (a) { if (atts[a].required && !Object.prototype.hasOwnProperty.call(el.attrs, a)) err(el, 'Element <' + el.name + '> is missing the required attribute ' + a + '.'); });
      el.children.forEach(walk);
    })(doc.root);
    refs.forEach(function (r) { if (!ids[r.ref]) err(r.el, 'The IDREF "' + r.ref + '" in ' + r.attr + ' on <' + r.el.name + '> points to no element with that ID.'); });
    return errs.sort(function (a, b) { return a.line - b.line; });
  }

  return { parseTree: parseTree, parseDtd: parseDtd, validateDtd: validateDtd };
});
