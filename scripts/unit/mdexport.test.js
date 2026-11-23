// Node unit tests for js/engines/mdexport.js: Word and ePub packages.
// Run: node scripts/unit/mdexport.test.js
const assert = require('assert');
let X;
let n = 0, failed = 0;
function t(name, fn) { try { if (!X) X = require('../../js/engines/mdexport.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
const el = (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children });
// a small well-formedness check: every tag closes in order
function wellFormed(s) {
  const stack = [], re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<\?[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g;
  let m, last = 0;
  while ((m = re.exec(s))) {
    if (/[<>]/.test(s.slice(last, m.index))) throw new Error('stray < or > near ' + s.slice(last, m.index).slice(0, 60));
    last = re.lastIndex;
    if (!m[2]) continue;
    if (m[1]) { const top = stack.pop(); if (top !== m[2]) throw new Error(`</${m[2]}> closes <${top}>`); }
    else if (!m[4]) stack.push(m[2]);
  }
  if (stack.length) throw new Error('unclosed: ' + stack.join(','));
  return true;
}
const byName = files => Object.fromEntries(files.map(f => [f.name, f.data]));
const TREE = el('body', null,
  el('h1', { id: 'report' }, 'Report & <notes>'),
  el('p', null, 'Some ', el('strong', null, 'bold'), ', ', el('em', null, 'italic'), ' and a ', el('a', { href: 'https://example.com/?a=1&b=2' }, 'link'), '.'),
  el('ul', null, el('li', null, 'one', el('ul', null, el('li', null, 'nested'))), el('li', null, el('input', { type: 'checkbox', checked: '' }), ' done')),
  el('ol', { start: '3' }, el('li', null, 'third')),
  el('table', null, el('thead', null, el('tr', null, el('th', null, 'A'), el('th', { align: 'right' }, 'B'))), el('tbody', null, el('tr', null, el('td', null, '1'), el('td', null, '2')))),
  el('pre', null, el('code', null, 'line 1\n  line 2\n')),
  el('blockquote', null, el('p', null, 'quoted')),
  el('p', null, 'Math ', el('span', { 'data-math': 'x^2 < y' }, 'x2')),
  el('p', null, el('img', { src: 'images/pasted-1.png', alt: 'shot' }), el('img', { src: 'https://x/y.png', alt: 'remote' })),
  el('hr'));

t('docx: the parts Word needs, all well-formed', () => {
  const f = byName(X.docx(TREE, { title: 'Report', images: { 'images/pasted-1.png': { data: new Uint8Array([1, 2]), type: 'image/png', width: 1200, height: 600 } } }));
  for (const k of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']) { assert.ok(f[k], k); wellFormed(f[k]); }
  assert.ok(f['word/media/image1.png'], 'image part');
});
t('docx: headings, runs, links, lists, tables, code, quote, math, images', () => {
  const files = X.docx(TREE, { images: { 'images/pasted-1.png': { data: new Uint8Array([1]), type: 'image/png', width: 1200, height: 600 } } });
  const d = byName(files)['word/document.xml'], rels = byName(files)['word/_rels/document.xml.rels'];
  assert.ok(d.includes('<w:pStyle w:val="Heading1"/>') && d.includes('Report &amp; &lt;notes&gt;'));
  assert.ok(d.includes('<w:b/>') && d.includes('<w:i/>'));
  assert.ok(/<w:hyperlink r:id="rId\d+"/.test(d) && rels.includes('https://example.com/?a=1&amp;b=2') && rels.includes('TargetMode="External"'));
  assert.ok(d.includes('<w:ilvl w:val="1"/>'), 'nested list level');
  assert.ok(d.includes('☑'), 'checked task box');
  assert.ok(byName(files)['word/numbering.xml'].includes('<w:startOverride w:val="3"/>'), 'ordered list start');
  assert.ok(d.includes('<w:tbl>') && d.includes('<w:jc w:val="right"/>'));
  assert.ok(d.includes('<w:pStyle w:val="Code"/>') && d.includes('  line 2'));
  assert.ok(d.includes('<w:pStyle w:val="Quote"/>'));
  assert.ok(d.includes('Cambria Math') && d.includes('x^2 &lt; y'));
  assert.ok(d.includes('<w:drawing>') && d.includes('cx="' + 576 * 9525 + '"'), 'image scaled to the page width');
  assert.ok(d.includes('[remote]'), 'an image that is not embedded becomes its alt text');
});
t('docx: an empty document is still valid', () => {
  const d = byName(X.docx({ tag: 'body', children: [] }))['word/document.xml'];
  wellFormed(d); assert.ok(d.includes('<w:p>'));
});
t('epub: mimetype first, OPF metadata, nested nav, images and properties', () => {
  const files = X.epub({ title: 'Report & co', lang: 'en', id: 'urn:uuid:1234', modified: '2026-11-23T10:00:00.123Z', xhtml: '<h1 id="a">A</h1><h2 id="b">B</h2><h3 id="c">C</h3><h2 id="d">D</h2>', toc: [{ id: 'a', text: 'A', level: 1 }, { id: 'b', text: 'B', level: 2 }, { id: 'c', text: 'C', level: 3 }, { id: 'd', text: 'D', level: 2 }], css: 'body{}', images: [{ name: 'images/p.png', type: 'image/png', data: new Uint8Array([1]) }], svg: true });
  assert.strictEqual(files[0].name, 'mimetype'); assert.strictEqual(files[0].data, 'application/epub+zip');
  const f = byName(files);
  for (const k of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter.xhtml']) wellFormed(f[k]);
  assert.ok(f['OEBPS/content.opf'].includes('<dc:title>Report &amp; co</dc:title>') && f['OEBPS/content.opf'].includes('2026-11-23T10:00:00Z'));
  assert.ok(f['OEBPS/content.opf'].includes('properties="svg"') && f['OEBPS/content.opf'].includes('href="images/p.png" media-type="image/png"'));
  assert.ok(f['OEBPS/nav.xhtml'].includes('<li><a href="chapter.xhtml#b">B</a><ol><li><a href="chapter.xhtml#c">C</a></li></ol></li><li><a href="chapter.xhtml#d">D</a></li>'), f['OEBPS/nav.xhtml']);
  assert.ok(f['OEBPS/images/p.png']);
});

console.log(`${n} passed, ${failed} failed`);
