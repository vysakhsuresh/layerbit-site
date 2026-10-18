#!/usr/bin/env python3
"""Renders a 1200x630 Open Graph / Twitter card for every indexable page into
images/og/<name>.jpg (see og_image_name in build.py): the page's H1, a short
summary, and the tool's icon from scripts/icons.py, in the site's own style.
Re-run after adding a page or changing a title; build.py picks the files up.

  python3 scripts/gen_og_images.py [slug ...]"""
import glob, html, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import icons
from test_tools import launch, ROOT  # noqa
from playwright.sync_api import sync_playwright
from apply_icons import GUIDE_TOOL

def og_name(file):
    return "home" if file == "index.html" else file[:-5].replace("/", "-")

def strip(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s))).strip()

TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Space Grotesk'; font-weight: 300 700; src: url('../../fonts/space-grotesk-latin.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 300 700; src: url('../../fonts/space-grotesk-latin-ext.woff2') format('woff2'); unicode-range: U+0100-024F, U+1E00-1EFF, U+20A0-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: 'Space Grotesk', sans-serif; color: #f8fafc;
  background: radial-gradient(circle at 78% 30%, rgba(56,189,248,0.18) 0%, rgba(56,189,248,0) 45%), radial-gradient(circle at 50% 0%, #1a1e2d 0%, #0a0c10 72%); position: relative; }
body::before { content: ''; position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,0.07) 1.2px, transparent 1.2px); background-size: 34px 34px; }
.wrap { position: absolute; inset: 64px 72px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 34px; font-weight: 700; letter-spacing: -0.5px; }
.kind { margin-left: auto; font-size: 20px; font-weight: 600; color: #38bdf8; border: 1.5px solid rgba(56,189,248,0.45); background: rgba(56,189,248,0.1); padding: 8px 18px; border-radius: 999px; }
.main { display: flex; align-items: center; gap: 56px; flex: 1; }
.text { flex: 1; min-width: 0; }
h1 { font-size: TITLE_SIZEpx; line-height: 1.06; font-weight: 700; letter-spacing: -1.5px; margin-bottom: 22px; }
p { font-size: 27px; line-height: 1.38; color: #94a3b8; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.icon { flex: 0 0 250px; height: 250px; border-radius: 56px; background: rgba(56,189,248,0.1); border: 2px solid rgba(56,189,248,0.3); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 80px rgba(56,189,248,0.18); }
.icon svg { width: 160px; height: 160px; }
.foot { display: flex; align-items: center; gap: 26px; font-size: 22px; color: #94a3b8; font-weight: 500; }
.foot b { color: #4ade80; font-weight: 600; }
.foot .url { margin-left: auto; color: #f8fafc; font-weight: 600; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #475569; }
</style></head><body><div class="wrap">
<div class="brand">LOGO Layerbit <span class="kind">KIND</span></div>
<div class="main"><div class="text"><h1>TITLE</h1><p>DESC</p></div>ICON</div>
<div class="foot">FOOT<span class="url">layerbit.co.in</span></div>
</div></body></html>"""

LOGO = ('<svg width="46" height="46" viewBox="0 0 64 64" fill="none"><polygon points="32,20 54,28 32,36 10,28" stroke="#f8fafc" stroke-width="4" stroke-linejoin="round"/>'
        '<polyline points="10,38 32,46 54,38" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
        '<polyline points="10,48 32,56 54,48" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="50" y="10" width="10" height="10" rx="2" fill="#00f2fe"/></svg>')

def page_info(meta_file):
    slug = os.path.basename(meta_file)[:-5]
    data = json.load(open(meta_file, encoding="utf-8"))
    if data.get("robots") and "noindex" in data["robots"]:
        return None
    body = open(meta_file[:-5] + ".body.html", encoding="utf-8").read()
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
    title = strip(h1.group(1)) if h1 else re.sub(r"\s*\|\s*Layerbit$", "", data["title"])
    file = data["file"]
    if file.startswith("guides/"):
        kind, key = "Guide", GUIDE_TOOL.get(slug[len("guides-"):])
    elif file.startswith("tools/"):
        kind, key = ("Service" if slug in ("api-automation", "app-development", "custom-scripts", "erp-development", "portfolio-design", "static-sites") else "Free tool"), slug
    else:
        kind, key = "Layerbit", None
    if file == "index.html":
        title, kind = "Free Developer Tools That Run in Your Browser", "28 tools"
    return dict(name=og_name(file), title=title, desc=data["description"], kind=kind, icon=icons.ICONS.get(key))

def render(pg, info):
    icon = ('<div class="icon"><svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">%s</svg></div>' % info["icon"]) if info["icon"] else \
           ('<div class="icon"><svg viewBox="0 0 64 64" fill="none">%s</svg></div>' % LOGO[LOGO.index('>') + 1:-6])
    n = len(info["title"])
    size = 72 if n <= 28 else 62 if n <= 42 else 54 if n <= 56 else 46
    doc = (TEMPLATE.replace("TITLE_SIZE", str(size)).replace("LOGO", LOGO).replace("KIND", html.escape(info["kind"]))
           .replace("TITLE", html.escape(info["title"])).replace("DESC", html.escape(info["desc"])).replace("ICON", icon))
    foot = {"Guide": ["<b>Free guide</b>", "Worked examples", "Updated regularly"], "Service": ["<b>Layerbit Technologies</b>", "Custom software", "Built to your process"]}.get(
        info["kind"], ["<b>Free</b>", "Runs in your browser", "No sign-up"])
    doc = doc.replace("FOOT", '<span class="dot"></span>'.join("<span>%s</span>" % f if not f.startswith("<b>") else f for f in foot))
    tmp = os.path.join(ROOT, "images/og/.render.html")
    open(tmp, "w", encoding="utf-8").write(doc)
    pg.goto("file://" + tmp, wait_until="load")
    pg.evaluate("document.fonts.ready.then(() => document.fonts.check('72px \\'Space Grotesk\\''))")
    out = os.path.join(ROOT, "images/og", info["name"] + ".jpg")
    pg.screenshot(path=out, type="jpeg", quality=86, clip={"x": 0, "y": 0, "width": 1200, "height": 630})
    return out

def main():
    only = set(sys.argv[1:])
    os.makedirs(os.path.join(ROOT, "images/og"), exist_ok=True)
    infos = [i for i in (page_info(f) for f in sorted(glob.glob(os.path.join(ROOT, "src/pages/*.json")))) if i]
    if only:
        infos = [i for i in infos if i["name"] in only or i["name"].split("-", 1)[-1] in only]
    with sync_playwright() as p:
        br = launch(p); pg = br.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        total = 0
        for info in infos:
            total += os.path.getsize(render(pg, info))
            if info["name"] == "home":
                # the site-wide fallback card (og-image.png) is the homepage card
                pg.screenshot(path=os.path.join(ROOT, "og-image.png"), clip={"x": 0, "y": 0, "width": 1200, "height": 630})
        br.close()
    tmp = os.path.join(ROOT, "images/og/.render.html")
    if os.path.exists(tmp):
        os.remove(tmp)
    print(f"{len(infos)} images, {total // 1024} KB total")

if __name__ == "__main__":
    main()
