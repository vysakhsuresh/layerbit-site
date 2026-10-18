#!/usr/bin/env python3
"""Layout audit: loads every built page at desktop and phone widths and reports
horizontal overflow, floating-control geometry, header/content alignment and
same-group buttons whose heights disagree. Read-only; prints a report."""
import glob, json, os, sys, threading
sys.path.insert(0, os.path.dirname(__file__))
from test_tools import serve, launch, ROOT  # noqa
from playwright.sync_api import sync_playwright

import random
PORT = random.randint(8800, 8999)
JS = r"""
() => {
  const vw = document.documentElement.clientWidth;
  const r = el => { const b = el.getBoundingClientRect(); return {x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(vw - b.right), b: Math.round(window.innerHeight - b.bottom)}; };
  const scrolls = el => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth) return true; } return false; };
  const out = { overflow: document.documentElement.scrollWidth - vw, floats: {}, over: [], groups: [] };
  for (const sel of ['.fab', '.chat-fab-premium', '.search-pill', '.premium-bmc-btn']) {
    const el = document.querySelector(sel); if (!el) continue;
    const cs = getComputedStyle(el); const g = el.querySelector('svg, i, img');
    out.floats[sel] = Object.assign(r(el), {pos: cs.position, radius: cs.borderRadius, glyph: g ? Math.round(g.getBoundingClientRect().width) : null});
  }
  const header = document.querySelector('header'); const main = document.querySelector('main:not(.page-main), .container, .hero');
  if (header && main) out.align = { headerX: Math.round(header.getBoundingClientRect().left), mainX: Math.round(main.getBoundingClientRect().left), headerW: Math.round(header.getBoundingClientRect().width), mainW: Math.round(main.getBoundingClientRect().width) };
  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect(); if (b.width === 0) continue;
    if (b.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !scrolls(el)) { out.over.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '')) + ' +' + Math.round(b.right - vw)); if (out.over.length > 6) break; }
  }
  for (const grp of document.querySelectorAll('.btn-group, .actions, .pane-actions, .toolbar, .controls, .action-row')) {
    const hs = [...grp.querySelectorAll(':scope > button, :scope > a, :scope > .btn')].map(b => Math.round(b.getBoundingClientRect().height)).filter(h => h > 0);
    if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 2) out.groups.push({grp: grp.className, hs});
    if (out.groups.length > 5) break;
  }
  return out;
}
"""

def main():
    os.chdir(ROOT)
    only = sys.argv[1:] 
    pages = sorted(glob.glob("*.html") + glob.glob("tools/*.html") + glob.glob("guides/*.html"))
    pages = [p for p in pages if p not in ("offline.html", "google*.html") and not p.startswith("google")]
    if only: pages = [p for p in pages if any(o in p for o in only)]
    serve(PORT)
    with sync_playwright() as p:
        br = launch(p)
        for width, label in ((1280, "D"), (390, "M")):
            ctx = br.new_context(viewport={"width": width, "height": 800 if width > 600 else 844}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.route("**/*", lambda route: route.abort() if any(h in route.request.url for h in ("google", "firebase", "gstatic", "buymeacoffee")) else route.continue_())
            for f in pages:
                pg.goto(f"http://127.0.0.1:{PORT}/{f}", wait_until="load")
                pg.wait_for_timeout(250)
                d = pg.evaluate(JS)
                fl = " ".join(f"{k.lstrip('.')[:9]}={v['w']}x{v['h']}@{v['x']},{v['y']}/r{v['r']}/b{v['b']} g{v['glyph']}" for k, v in d["floats"].items())
                flags = []
                if d["overflow"] > 0: flags.append(f"OVERFLOW+{d['overflow']}")
                if d.get("align") and abs(d["align"]["headerX"] - d["align"]["mainX"]) > 1: flags.append(f"ALIGN h{d['align']['headerX']}+{d['align']['headerW']}/m{d['align']['mainX']}+{d['align']['mainW']}")
                if d["over"]: flags.append("OVER " + ",".join(d["over"][:4]))
                if d["groups"]: flags.append("BTN " + json.dumps(d["groups"][:3]))
                print(f"{label} {f:48s} {fl}  {' | '.join(flags)}")
            ctx.close()
        br.close()

if __name__ == "__main__":
    main()
