/* Layerbit virtual list and grid: show millions of rows while only the rows
 * on screen exist in the page. Browser only (window.LBVirtual).
 *
 * LBVirtual.list(host, {count, rowHeight, render(i) -> string | Node, overscan})
 * LBVirtual.grid(host, {columns: [{label, width?}], count, rowHeight, cell(row, col) -> text})
 *   both return {update(count), scrollToIndex(i), refresh(), destroy()}
 *
 * A string from render() or cell() is set as text, never parsed as HTML.
 * Past 8 million pixels the scroll range is scaled (browsers cap element
 * height), so any row count still scrolls from the first row to the last.
 */
(function (root) {
  'use strict';
  var MAX_PX = 8000000;

  function list(host, o) {
    o = Object.assign({ count: 0, rowHeight: 24, overscan: 8, header: null }, o);
    host.classList.add('lb-vlist');
    host.style.position = host.style.position || 'relative';
    host.style.overflow = 'auto';
    host.style.overflowAnchor = 'none';
    host.innerHTML = '';
    var head = null;
    if (o.header) { head = o.header; host.appendChild(head); }
    var spacer = document.createElement('div'); spacer.className = 'lb-vspacer';
    var rows = document.createElement('div'); rows.className = 'lb-vrows';
    rows.style.cssText = 'position:absolute;left:0;right:0;';
    host.appendChild(spacer); host.appendChild(rows);
    var pin = null, raf = 0;

    function headH() { return head ? head.offsetHeight : 0; }
    function geom() {
      var total = o.count * o.rowHeight, px = Math.min(total, MAX_PX), view = Math.max(1, Math.ceil((host.clientHeight - headH()) / o.rowHeight));
      return { px: px, view: view, scaled: total > MAX_PX, maxSt: Math.max(1, px + headH() - host.clientHeight) };
    }
    function topRow(g) {
      var st = host.scrollTop;
      if (pin && pin.st === st) return pin.row;
      pin = null;
      if (!g.scaled) return Math.floor(st / o.rowHeight);
      return Math.round(Math.min(1, st / g.maxSt) * Math.max(0, o.count - g.view));
    }
    function render() {
      var g = geom();
      spacer.style.height = g.px + 'px';
      var first = Math.max(0, Math.min(topRow(g), o.count - 1) - o.overscan), last = Math.min(o.count, topRow(g) + g.view + o.overscan);
      var frag = document.createDocumentFragment();
      for (var i = first; i < last; i++) {
        var v = o.render(i), row;
        if (v && v.nodeType) { row = v; if (!row.classList.contains('lb-vrow')) row.classList.add('lb-vrow'); }
        else { row = document.createElement('div'); row.className = 'lb-vrow'; row.textContent = v == null ? '' : String(v); }
        row.style.height = o.rowHeight + 'px';
        frag.appendChild(row);
      }
      rows.textContent = '';
      rows.appendChild(frag);
      var t = topRow(g);
      rows.style.top = (headH() + (g.scaled ? host.scrollTop - Math.min(t, o.overscan) * o.rowHeight : first * o.rowHeight)) + 'px';
    }
    function onScroll() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
    host.addEventListener('scroll', onScroll);
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    if (ro) ro.observe(host);
    render();
    return {
      update: function (count) { if (count != null) o.count = count; render(); },
      refresh: render,
      scrollToIndex: function (i) {
        var g = geom(); i = Math.max(0, Math.min(i, o.count - 1));
        host.scrollTop = g.scaled ? Math.round(i / Math.max(1, o.count - g.view) * g.maxSt) : i * o.rowHeight;
        pin = { row: g.scaled ? i : Math.floor(host.scrollTop / o.rowHeight), st: host.scrollTop };
        render();
      },
      destroy: function () { host.removeEventListener('scroll', onScroll); if (ro) ro.disconnect(); host.innerHTML = ''; host.classList.remove('lb-vlist'); }
    };
  }

  function grid(host, o) {
    o = Object.assign({ columns: [], count: 0, rowHeight: 28 }, o);
    var tmpl = o.columns.map(function (c) { return c.width ? c.width + 'px' : 'minmax(120px, 1fr)'; }).join(' ');
    var head = document.createElement('div');
    head.className = 'lb-vgrid-head';
    head.style.cssText = 'position:sticky;top:0;z-index:2;display:grid;grid-template-columns:' + tmpl + ';min-width:max-content;';
    o.columns.forEach(function (c) { var d = document.createElement('div'); d.className = 'lb-vcell'; d.textContent = c.label; head.appendChild(d); });
    return list(host, {
      count: o.count, rowHeight: o.rowHeight, overscan: o.overscan || 8, header: head,
      render: function (r) {
        var row = document.createElement('div'); row.className = 'lb-vrow';
        row.style.cssText = 'display:grid;grid-template-columns:' + tmpl + ';min-width:max-content;';
        for (var c = 0; c < o.columns.length; c++) {
          var d = document.createElement('div'); d.className = 'lb-vcell';
          var v = o.cell(r, c); d.textContent = v == null ? '' : String(v);
          row.appendChild(d);
        }
        return row;
      }
    });
  }

  root.LBVirtual = { list: list, grid: grid, MAX_PX: MAX_PX };
})(typeof self !== 'undefined' ? self : this);
