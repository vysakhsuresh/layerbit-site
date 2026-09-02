#!/usr/bin/env python3
"""One-time migration tool: extracts src/pages/*.json + *.jsonld.html +
*.style.css + *.body.html from the hand-authored top-level HTML files
(index.html, tools/*.html, ...), for build.py to recompose them from
src/partials/.

This is NOT part of the regular build - src/pages/ is the source of truth
going forward and should be hand-edited directly, then rebuilt with
`python3 build.py`. Re-run this script only to re-import content that was
edited directly in a generated top-level HTML file instead of its
src/pages/ source (and only against a git-clean top-level file, since it
reads the file as authored, not as build.py would regenerate it).
"""
import re, glob, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
files = sorted(glob.glob("*.html") + glob.glob("tools/*.html"))

os.makedirs("src/pages", exist_ok=True)

report = []
for f in files:
    text = open(f, encoding="utf-8").read()
    is_tool = f.startswith("tools/")
    prefix = "../" if is_tool else ""
    slug = f[len("tools/"):-5] if is_tool else f[:-5]  # e.g. "csv-to-json" or "about"

    def find(pattern, required=True):
        m = re.search(pattern, text, re.S)
        if not m and required:
            raise ValueError(f"{f}: pattern not found: {pattern}")
        return m

    viewport_m = find(r'<meta name="viewport" content="([^"]*)" />')
    desc_m = find(r'<meta name="description" content="((?:[^"\\]|\\.)*)" />')
    title_m = find(r'<title>([^<]*)</title>')
    canonical_m = find(r'<link rel="canonical" href="([^"]*)" />', required=not f.endswith("404.html"))
    robots_m = re.search(r'<meta name="robots" content="([^"]*)" />', text)
    og_url_m = find(r'<meta property="og:url" content="([^"]*)" />')
    fonts_m = find(r'<link href="https://fonts\.googleapis\.com/css2\?family=([^"]*)" rel="stylesheet" />')

    # extra per-page CDN library scripts, at their two observed insertion
    # points: right after the lucide script (before the fonts link), and
    # right after the base.css link (before <style>). Blank-only lines in
    # the captured span are dropped; real content lines are kept verbatim
    # (including any preceding HTML comment, e.g. text-diff-checker.html).
    libs_m = find(
        r'<script src="https://unpkg\.com/lucide@1\.39\.0" async></script>\n(.*?)'
        r'<link href="https://fonts\.googleapis\.com/css2\?family='
    )
    lib_lines = [l for l in libs_m.group(1).split("\n") if l.strip() != ""]
    extra_head_libs = ("\n".join(lib_lines) + "\n") if lib_lines else ""

    after_res_m = find(
        r'<link rel="stylesheet" href="[^"]*css/base\.css" />\n(.*?)<style>'
    )
    # ld+json blocks are handled separately (via jsonld_blocks, below) and
    # always rendered from the fixed {{JSONLD}} slot near the top of <head>;
    # strip them out here so a page whose schema happens to sit physically
    # between base.css and <style> (e.g. pint-ae-checker.html) doesn't get
    # it duplicated into extra_head_after_resources too.
    after_res_segment = re.sub(r'<script type="application/ld\+json">.*?</script>', '', after_res_m.group(1), flags=re.S)
    after_res_lines = [l for l in after_res_segment.split("\n") if l.strip() != ""]
    extra_head_after_resources = ("\n".join(after_res_lines) + "\n") if after_res_lines else ""

    # home-link target for the header brand: tool pages link back up with
    # "../", every other page links to site root "/" - except index.html,
    # which renders a non-linked <div class="brand"> (handled by a separate
    # header-home.html partial, not this field).
    home_href = "../" if is_tool else "/"

    # JSON-LD blocks: keep raw, verbatim
    jsonld_blocks = re.findall(r'(<script type="application/ld\+json">.*?</script>)', text, re.S)

    # page-specific <style> block (already deduplicated in Phase 1 - this is what's left)
    style_m = find(r'<style>(.*?)</style>')

    # body content: between <body> and </body> (case-insensitive close tag - some
    # files use </BODY>). Header/footer are replaced with position-preserving
    # {{HEADER}}/{{FOOTER}} markers (not stripped-and-reappended) so build.py can
    # reinsert them at their exact original spot - footer is NOT always the last
    # thing before </body> (fab/scripts often follow it).
    body_m = find(r'<body>\s*\n?(.*?)\s*</body>', required=False)
    if not body_m:
        body_m = find(r'<body>\s*\n?(.*?)\s*</BODY>')
    body = body_m.group(1)

    had_header = bool(re.search(r'<header>.*?</header>', body, re.S))
    had_footer = bool(re.search(r'<footer>.*?</footer>', body, re.S))

    # index.html's header is genuinely unique (non-linked <div class="brand">
    # instead of <a href>, plus an extra inline drop-shadow style on the svg)
    # rather than just a different {{PREFIX}}/{{HOME_HREF}} value, so it gets
    # its own marker resolved from a separate static partial (header-home.html)
    header_marker = '{{HEADER_HOME}}' if f == "index.html" else '{{HEADER}}'

    body_marked, n_header = re.subn(r'<header>.*?</header>', header_marker, body, count=1, flags=re.S)
    body_marked, n_footer = re.subn(r'<footer>.*?</footer>', '{{FOOTER}}', body_marked, count=1, flags=re.S)

    # layerlink-viewer.html deliberately has no standard <header> - it uses a
    # bespoke .top-bar (with its own brand link) as minimal chrome for
    # external recipients viewing a shared broadcast. Injecting the full
    # site header there would duplicate the logo, not fill a gap, so it's
    # excluded from the "missing header" synthetic-injection fallback below.
    if not had_header and f != "tools/layerlink-viewer.html":
        # inject a header marker right at the top of the body (1 file lacks one)
        body_marked = '{{HEADER}}\n\n' + body_marked
    if not had_footer:
        # inject a footer marker right before the first fab <a>, or at the end
        fab_m = re.search(r'<a[^>]*class="fab', body_marked)
        if fab_m:
            insert_at = body_marked.rfind('\n', 0, fab_m.start()) + 1
            body_marked = body_marked[:insert_at] + '{{FOOTER}}\n\n' + body_marked[insert_at:]
        else:
            body_marked = body_marked.rstrip('\n') + '\n\n{{FOOTER}}\n'

    body_no_header_footer = body_marked

    data = {
        "file": f,
        "prefix": prefix,
        "viewport": viewport_m.group(1),
        "description": desc_m.group(1),
        "title": title_m.group(1),
        "canonical": canonical_m.group(1) if canonical_m else None,
        "robots": robots_m.group(1) if robots_m else None,
        "og_url": og_url_m.group(1),
        "fonts_family": fonts_m.group(1),
        "extra_head_libs": extra_head_libs,
        "extra_head_after_resources": extra_head_after_resources,
        "home_href": home_href,
    }
    with open(f"src/pages/{slug.replace('/', '_')}.json", "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)

    with open(f"src/pages/{slug.replace('/', '_')}.jsonld.html", "w", encoding="utf-8") as fh:
        fh.write("\n".join(jsonld_blocks))

    with open(f"src/pages/{slug.replace('/', '_')}.style.css", "w", encoding="utf-8") as fh:
        fh.write(style_m.group(1))

    with open(f"src/pages/{slug.replace('/', '_')}.body.html", "w", encoding="utf-8") as fh:
        fh.write(body_no_header_footer.strip("\n") + "\n")

    report.append((f, slug, len(jsonld_blocks)))

print(f"Extracted {len(report)} pages into src/pages/")
for f, slug, n_ld in report:
    print(f"  {f:<45} -> {slug:<30} ({n_ld} JSON-LD block(s))")
