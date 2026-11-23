/* Layerbit document export: Word (.docx) and ePub 3 packages written from a
 * plain tree of the rendered Markdown, so they need no server and no library.
 * Pure functions, no DOM. Browser (window.LBMdExport) and Node.
 *
 * A tree node is a string (text) or {tag, attrs, children}. The page builds it
 * from the sanitised preview; math nodes carry attrs['data-math'] (the TeX).
 *
 * docx(tree, {title, images})  -> [{name, data}] for LBZip.zipStore
 *   images: {src: {data: Uint8Array, type: 'image/png', width, height}}
 * epub({title, lang, id, modified, xhtml, toc, css, images, svg, mathml}) -> [{name, data}]
 *   xhtml: the body as well-formed XHTML; toc: [{id, text, level}]
 * xml(s) -> s escaped for XML text and attributes
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBMdExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function xml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''); }
  var kids = function (n) { return n && n.children ? n.children : []; };
  var attr = function (n, k) { return n && n.attrs && n.attrs[k] != null ? String(n.attrs[k]) : ''; };
  function textOf(n) { return typeof n === 'string' ? n : kids(n).map(textOf).join(''); }
  var BLOCK = /^(h[1-6]|p|ul|ol|li|blockquote|pre|table|hr|div|section|figure|details|summary|dl|dt|dd)$/;

  // ---------------- DOCX ----------------
  var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'png', 'image/bmp': 'bmp' };

  function docx(tree, opts) {
    opts = opts || {};
    var images = opts.images || {}, rels = [], media = [], nums = [], body = [], picId = 0;
    function rel(type, target, external) { var id = 'rId' + (rels.length + 10); rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + xml(target) + '"' + (external ? ' TargetMode="External"' : '') + '/>'); return id; }
    function run(text, f) {
      var pr = (f.b ? '<w:b/>' : '') + (f.i ? '<w:i/>' : '') + (f.s ? '<w:strike/>' : '') + (f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '') + (f.math ? '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/>' : '') + (f.link ? '<w:rStyle w:val="Hyperlink"/>' : '') + (f.sup ? '<w:vertAlign w:val="superscript"/>' : '') + (f.sub ? '<w:vertAlign w:val="subscript"/>' : '');
      return String(text).split('\n').map(function (part, i) { return (i ? '<w:r><w:br/></w:r>' : '') + (part ? '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xml(part) + '</w:t></w:r>' : ''); }).join('');
    }
    function image(n) {
      var src = attr(n, 'src'), im = images[src];
      if (!im || !EXT[im.type]) return run('[' + (attr(n, 'alt') || 'image') + ']', { i: true });
      var name = 'image' + (media.length + 1) + '.' + EXT[im.type]; media.push({ name: 'word/media/' + name, data: im.data });
      var id = rel('image', 'media/' + name), w = im.width || 400, h = im.height || 300, max = 576;
      if (w > max) { h = Math.round(h * max / w); w = max; }
      var cx = w * 9525, cy = h * 9525; picId++;
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + picId + '" name="Picture ' + picId + '" descr="' + xml(attr(n, 'alt')) + '"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + picId + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }
    function inline(n, f) {
      if (typeof n === 'string') return run(n, f);
      var t = n.tag, g = Object.assign({}, f);
      if (attr(n, 'data-math')) return run(attr(n, 'data-math'), Object.assign(g, { math: true }));
      if (t === 'br') return '<w:r><w:br/></w:r>';
      if (t === 'img') return image(n);
      if (t === 'input') return run(attr(n, 'checked') !== '' || (n.attrs && 'checked' in n.attrs) ? '☑ ' : '☐ ', f);
      if (t === 'strong' || t === 'b') g.b = true;
      if (t === 'em' || t === 'i') g.i = true;
      if (t === 'del' || t === 's') g.s = true;
      if (t === 'code' || t === 'kbd') g.code = true;
      if (t === 'sup') g.sup = true;
      if (t === 'sub') g.sub = true;
      if (t === 'a') {
        var href = attr(n, 'href'), inner = kids(n).map(function (c) { return inline(c, Object.assign({}, g, { link: true })); }).join('');
        if (/^(https?:|mailto:)/i.test(href)) return '<w:hyperlink r:id="' + rel('hyperlink', href, true) + '" w:history="1">' + inner + '</w:hyperlink>';
        if (href.charAt(0) === '#') return '<w:hyperlink w:anchor="' + xml(href.slice(1).replace(/[^\w-]/g, '_').slice(0, 40)) + '" w:history="1">' + inner + '</w:hyperlink>';
        return inner;
      }
      return kids(n).map(function (c) { return inline(c, g); }).join('');
    }
    function para(content, style, extra) { return '<w:p>' + (style || extra ? '<w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (extra || '') + '</w:pPr>' : '') + content + '</w:p>'; }
    function newNum(abs, start) { nums.push({ abs: abs, start: start || 1 }); return nums.length; }
    function block(n, ctx) {
      if (typeof n === 'string') { if (n.trim()) body.push(para(run(n.replace(/^\s+|\s+$/g, ''), {}), ctx.style)); return; }
      var t = n.tag;
      if (attr(n, 'data-math')) { body.push(para(run(attr(n, 'data-math'), { math: true }), null, '<w:jc w:val="center"/>')); return; }
      if (/^h[1-6]$/.test(t)) {
        var id = attr(n, 'id'), bm = id ? id.replace(/[^\w-]/g, '_').slice(0, 40) : '';
        body.push(para((bm ? '<w:bookmarkStart w:id="' + body.length + '" w:name="' + xml(bm) + '"/>' : '') + inline(n, {}) + (bm ? '<w:bookmarkEnd w:id="' + body.length + '"/>' : ''), 'Heading' + t[1])); return;
      }
      if (t === 'p') {
        if (kids(n).some(function (c) { return c && c.tag && BLOCK.test(c.tag); })) { kids(n).forEach(function (c) { block(c, ctx); }); return; }
        body.push(para(inline(n, {}), ctx.style, ctx.num ? '<w:numPr><w:ilvl w:val="' + ctx.lvl + '"/><w:numId w:val="' + ctx.num + '"/></w:numPr>' : '')); ctx.num = 0; return;
      }
      if (t === 'pre') { textOf(n).replace(/\n$/, '').split('\n').forEach(function (line) { body.push(para(run(line || ' ', { code: true }), 'Code')); }); return; }
      if (t === 'blockquote') { kids(n).forEach(function (c) { block(c, { style: 'Quote' }); }); return; }
      if (t === 'hr') { body.push(para('', null, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>')); return; }
      if (t === 'ul' || t === 'ol') {
        var lvl = ctx.lvl == null ? 0 : ctx.lvl + 1, num = newNum(t === 'ol' ? 2 : 1, +attr(n, 'start') || 1);
        kids(n).forEach(function (li) {
          if (!li || li.tag !== 'li') return;
          var first = true, inl = [];
          var flush = function () { if (!inl.length) return; body.push(para(inl.join(''), 'ListParagraph', first ? '<w:numPr><w:ilvl w:val="' + lvl + '"/><w:numId w:val="' + num + '"/></w:numPr>' : '<w:ind w:left="' + (720 * (lvl + 1)) + '"/>')); first = false; inl = []; };
          kids(li).forEach(function (c) {
            if (c && c.tag && (c.tag === 'ul' || c.tag === 'ol')) { flush(); block(c, { lvl: lvl }); }
            else if (c && c.tag && BLOCK.test(c.tag)) { if (c.tag === 'p') { inl.push(inline(c, {})); flush(); } else { flush(); block(c, { lvl: lvl }); } }
            else inl.push(inline(c, {}));
          });
          flush();
        });
        return;
      }
      if (t === 'table') {
        var rows = [];
        (function collect(x) { kids(x).forEach(function (c) { if (c && c.tag === 'tr') rows.push(c); else if (c && c.tag) collect(c); }); })(n);
        var cols = rows.reduce(function (m, r) { return Math.max(m, kids(r).filter(function (c) { return c && c.tag; }).length); }, 0) || 1, w = Math.floor(9000 / cols);
        var out = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) { return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'; }).join('') + '</w:tblBorders></w:tblPr><w:tblGrid>' + new Array(cols + 1).join('<w:gridCol w:w="' + w + '"/>') + '</w:tblGrid>';
        rows.forEach(function (r) {
          out += '<w:tr>';
          var cells = kids(r).filter(function (c) { return c && c.tag; });
          for (var i = 0; i < cols; i++) {
            var c = cells[i], th = c && c.tag === 'th', al = c ? (attr(c, 'align') || (/text-align:\s*(\w+)/.exec(attr(c, 'style')) || [])[1] || '') : '';
            out += '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (th ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '') + '</w:tcPr>' + para(c ? inline(c, { b: th }) : '', null, al === 'center' || al === 'right' ? '<w:jc w:val="' + al + '"/>' : '') + '</w:tc>';
          }
          out += '</w:tr>';
        });
        body.push(out + '</w:tbl>'); body.push(para('')); return;
      }
      if (t === 'img') { body.push(para(image(n))); return; }
      if (t === 'input' || t === 'br') return;
      if (BLOCK.test(t) || kids(n).some(function (c) { return c && c.tag && BLOCK.test(c.tag); })) { kids(n).forEach(function (c) { block(c, ctx); }); return; }
      body.push(para(inline(n, {}), ctx.style));
    }
    kids(tree).forEach(function (c) { block(c, {}); });
    if (!body.length) body.push(para(''));

    var lvls = function (fmt) { var s = ''; for (var i = 0; i < 9; i++) s += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + (fmt === 'bullet' ? 'bullet' : ['decimal', 'lowerLetter', 'lowerRoman'][i % 3]) + '"/><w:lvlText w:val="' + (fmt === 'bullet' ? ['•', '◦', '▪'][i % 3] : '%' + (i + 1) + '.') + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>'; return s; };
    var numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ' + W + '><w:abstractNum w:abstractNumId="1">' + lvls('bullet') + '</w:abstractNum><w:abstractNum w:abstractNumId="2">' + lvls('decimal') + '</w:abstractNum>' +
      nums.map(function (x, i) { return '<w:num w:numId="' + (i + 1) + '"><w:abstractNumId w:val="' + x.abs + '"/>' + (x.abs === 2 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + x.start + '"/></w:lvlOverride>' : '') + '</w:num>'; }).join('') + '</w:numbering>';
    var hs = [32, 26, 22, 18, 16, 14];
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ' + W + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      hs.map(function (sz, i) { return '<w:style w:type="paragraph" w:styleId="Heading' + (i + 1) + '"><w:name w:val="heading ' + (i + 1) + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + (i < 2 ? 360 : 240) + '" w:after="120"/><w:outlineLvl w:val="' + i + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + sz * 2 + '"/></w:rPr></w:style>'; }).join('') +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
    var document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + W + '><w:body>' + body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' + rels.join('') + '</Relationships>';
    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xml(opts.title || 'Document') + '</dc:title><dc:creator>Layerbit Markdown Editor</dc:creator></cp:coreProperties>';
    var pkgRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    return [{ name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: pkgRels }, { name: 'docProps/core.xml', data: core }, { name: 'word/document.xml', data: document }, { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering }, { name: 'word/_rels/document.xml.rels', data: docRels }].concat(media);
  }

  // ---------------- EPUB 3 ----------------
  function epub(o) {
    var title = o.title || 'Document', lang = o.lang || 'en', id = o.id || 'urn:uuid:00000000-0000-4000-8000-000000000000';
    var modified = (o.modified || new Date().toISOString()).replace(/\.\d+Z$/, 'Z');
    var imgs = o.images || [], props = [o.svg ? 'svg' : '', o.mathml ? 'mathml' : ''].filter(Boolean).join(' ');
    var head = function (t) { return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' + xml(lang) + '" lang="' + xml(lang) + '">\n<head><meta charset="utf-8"/><title>' + xml(t) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'; };
    var toc = (o.toc || []).filter(function (h) { return h.level <= 3; });
    var navList = function () {
      if (!toc.length) return '<ol><li><a href="chapter.xhtml">' + xml(title) + '</a></li></ol>';
      var base = Math.min.apply(null, toc.map(function (h) { return h.level; })), out = '<ol>', cur = 1;
      toc.forEach(function (h, i) {
        var lv = Math.min(h.level - base + 1, cur + 1);
        if (i && lv > cur) { out += '<ol>'; cur = lv; }
        else if (i) { while (cur > lv) { out += '</li></ol>'; cur--; } out += '</li>'; }
        out += '<li><a href="chapter.xhtml#' + xml(h.id) + '">' + xml(h.text) + '</a>';
      });
      out += '</li>'; while (cur > 1) { out += '</ol></li>'; cur--; }
      return out + '</ol>';
    };
    var nav = head(title) + '<body><nav epub:type="toc" id="toc"><h1>Contents</h1>' + navList() + '</nav></body>\n</html>\n';
    var chapter = head(title) + '<body>\n' + o.xhtml + '\n</body>\n</html>\n';
    var opf = '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + xml(lang) + '">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">' + xml(id) + '</dc:identifier><dc:title>' + xml(title) + '</dc:title><dc:language>' + xml(lang) + '</dc:language><meta property="dcterms:modified">' + modified + '</meta></metadata>\n<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"' + (props ? ' properties="' + props + '"' : '') + '/><item id="css" href="style.css" media-type="text/css"/>' +
      imgs.map(function (im, i) { return '<item id="img' + i + '" href="' + xml(im.name) + '" media-type="' + xml(im.type) + '"/>'; }).join('') + '</manifest>\n<spine><itemref idref="chapter"/></spine>\n</package>\n';
    var container = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n';
    return [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: container }, { name: 'OEBPS/content.opf', data: opf }, { name: 'OEBPS/nav.xhtml', data: nav }, { name: 'OEBPS/chapter.xhtml', data: chapter }, { name: 'OEBPS/style.css', data: o.css || '' }]
      .concat(imgs.map(function (im) { return { name: 'OEBPS/' + im.name, data: im.data }; }));
  }

  return { docx: docx, epub: epub, xml: xml, textOf: textOf };
});
