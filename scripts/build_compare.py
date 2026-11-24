#!/usr/bin/env python3
"""Build the "How Layerbit compares" page from scripts/parity/*.json.

A tool appears on the page only when every claim in its parity file is backed
by tests that exist and passed (scripts/check_parity.py). Each section lists the
features Layerbit has, each tied to its automated tests, and the parity file's
`gaps`: the places where the competitor is still ahead. A parity file with no
gaps is refused, so the page cannot turn into a one-sided list.

  python3 scripts/build_compare.py --ui-results ui-results.json          # write src/pages/compare.*
  python3 scripts/build_compare.py --ui-results ui-results.json --check  # fail if the committed page differs

Without --ui-results, browser tests are only checked for existence (the
build-check job); the tool-tests job runs --check with real results.
"""
import argparse, glob, html, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
from check_parity import check  # noqa

REPO = "https://github.com/vysakhsuresh/layerbit-site"
E = html.escape


def green_tools(ui_results):
    lines, _ = check(os.path.join(ROOT, "scripts", "parity"), os.path.join(ROOT, "scripts", "test_tools.py"),
                     os.path.join(ROOT, "scripts", "unit"), ui_results)
    status, tool = {}, None
    for ln in lines:
        m = re.match(r"scripts/parity/[^:]+\.json: (.+)$", ln)
        if m:
            tool = m.group(1); status[tool] = True
        elif tool and ln.startswith("  FAIL"):
            status[tool] = False
    return {t for t, ok in status.items() if ok}


def tool_name(doc):
    body = os.path.join(ROOT, "src", "pages", doc["tool"] + ".body.html")
    m = re.search(r"<h1[^>]*>(.*?)</h1>", io.open(body, encoding="utf-8").read(), re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()


def section(doc):
    name = tool_name(doc)
    href = doc["page"]
    comps = doc["competitors"]
    who = ", ".join(c["name"] for c in comps)
    checked = sorted({c.get("checked", "") for c in comps if c.get("checked")})
    out = [f'    <section class="cmp" id="{E(doc["tool"])}">',
           f'      <h2><a href="{E(href)}">{E(name)}</a> <span class="cmp-vs">compared with {E(who)}</span></h2>',
           '      <ul class="cmp-who">']
    for c in comps:
        out.append(f'        <li><strong>{E(c["name"])}</strong>: {E(c.get("price", "price not listed"))}</li>')
    out.append("      </ul>")
    if checked:
        out.append(f'      <p class="cmp-meta">Competitor features and prices as listed by the vendors, checked {E(", ".join(checked))}.</p>')
    out.append('      <h3>What Layerbit does, each line checked by automated tests</h3>')
    out.append('      <ul class="cmp-have">')
    for c in doc["claims"]:
        n = len(c["tests"])
        out.append(f'        <li>{E(c["feature"])} <span class="cmp-tests">{n} test{"s" if n != 1 else ""}</span></li>')
    out.append("      </ul>")
    out.append(f'      <h3>Where {E(comps[0]["name"] if len(comps) == 1 else "they")} {"is" if len(comps) == 1 else "are"} still ahead</h3>')
    out.append('      <ul class="cmp-gaps">')
    for g in doc["gaps"]:
        out.append(f"        <li>{E(g)}</li>")
    out.append("      </ul>")
    out.append(f'      <p class="cmp-src"><a href="{REPO}/blob/main/scripts/parity/{E(doc["tool"])}.json" rel="noopener">The claims and the tests behind them</a></p>')
    out.append("    </section>")
    return "\n".join(out)


def render(ui_results):
    docs = []
    for f in sorted(glob.glob(os.path.join(ROOT, "scripts", "parity", "*.json"))):
        d = json.load(io.open(f, encoding="utf-8"))
        if not d.get("gaps"):
            sys.exit(f"{os.path.relpath(f, ROOT)} has no gaps: every comparison must say where the competitor is still ahead")
        docs.append(d)
    green = green_tools(ui_results)
    shown = [d for d in docs if d["tool"] in green]
    shown.sort(key=tool_name)
    held = sorted(tool_name(d) for d in docs if d["tool"] not in green)
    toc = "\n".join(f'        <li><a href="#{E(d["tool"])}">{E(tool_name(d))}</a></li>' for d in shown)
    held_html = ""
    if held:
        held_html = ('\n    <p class="cmp-meta">Not shown until their tests pass again: ' + E(", ".join(held)) + ".</p>")
    body = f"""{{{{HEADER}}}}

  <main id="main" class="page-main">
  <div class="hero">
    <h1>How Layerbit Compares</h1>
    <p>Each Layerbit tool set against the paid or best-known tool in its field: what we match, proved by tests, and where they are still ahead.</p>
  </div>

  <div class="content-panel">
    <h2>How this page is made</h2>
    <p>For every tool there is a file in the <a href="{REPO}/tree/main/scripts/parity" rel="noopener">source code</a> that lists each feature this site claims to share with a competitor, and the automated tests that prove it. The build fails if a claim has no test, names a test that does not exist, or names one that did not pass in a real browser. This page is generated from those files, so a tool only appears here while all of its claims are passing.</p>
    <p>Every section also says where the other tool is still ahead. Some of those gaps are things a web page cannot do at all, such as controlling another computer or scanning a network; others are work we have not done yet. Prices and features are what the vendors list, on the date shown. Product names belong to their owners, and nothing here implies any connection with them.</p>
    <p>Two limits apply to every Layerbit tool: everything runs in your browser tab, so the largest file you can open depends on your device, and nothing you enter is sent anywhere (LayerLink screen sharing, and the optional breach check and key fetch that say so, are the exceptions).</p>{held_html}
    <nav aria-label="Tools on this page">
      <ul class="cmp-toc">
{toc}
      </ul>
    </nav>
  </div>

  <div class="cmp-list">
{chr(10).join(section(d) for d in shown)}
  </div>

  </main>

  {{{{FOOTER}}}}

  <script src="js/shared.js"></script>

  <script src="main.js"></script>
"""
    meta = {
        "file": "compare.html", "prefix": "", "viewport": "width=device-width, initial-scale=1",
        "description": "Layerbit's free browser tools compared with paid and popular alternatives: features matched, each backed by automated tests, and where others are ahead.",
        "title": "How Layerbit Compares: Tested Features and Honest Gaps",
        "canonical": "https://layerbit.co.in/compare.html", "robots": None, "og_url": "https://layerbit.co.in/compare.html",
        "fonts_family": "Space+Grotesk:wght@400;500;600;700&display=swap", "extra_head_libs": "", "extra_head_after_resources": "", "home_href": "/",
    }
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": "https://layerbit.co.in/compare.html#page", "url": "https://layerbit.co.in/compare.html",
         "name": "How Layerbit Compares", "description": meta["description"], "isPartOf": {"@id": "https://layerbit.co.in/#website"},
         "about": [{"@type": "SoftwareApplication", "name": tool_name(d), "url": "https://layerbit.co.in/" + d["page"]} for d in shown]},
        {"@type": "BreadcrumbList", "@id": "https://layerbit.co.in/compare.html#breadcrumb", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://layerbit.co.in/"},
            {"@type": "ListItem", "position": 2, "name": "How Layerbit Compares", "item": "https://layerbit.co.in/compare.html"}]}]}
    payload = json.dumps(ld, indent=2, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    jsonld = '<script type="application/ld+json">\n' + payload + "\n  </script>"
    return {"compare.body.html": body, "compare.json": json.dumps(meta, indent=2, ensure_ascii=False) + "\n", "compare.jsonld.html": jsonld}, shown, held


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui-results")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    files, shown, held = render(a.ui_results)
    pages = os.path.join(ROOT, "src", "pages")
    if a.check:
        diff = [n for n, txt in files.items() if not os.path.exists(os.path.join(pages, n)) or io.open(os.path.join(pages, n), encoding="utf-8").read() != txt]
        if diff:
            print("compare page is out of date with the parity results: " + ", ".join(diff) + "\nrun: python3 scripts/build_compare.py --ui-results ui-results.json && python3 build.py")
            return 1
        print(f"compare page OK: {len(shown)} tools shown, {len(held)} held back")
        return 0
    for n, txt in files.items():
        io.open(os.path.join(pages, n), "w", encoding="utf-8").write(txt)
    print(f"wrote src/pages/compare.*: {len(shown)} tools shown" + (f", held back: {', '.join(held)}" if held else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
