#!/usr/bin/env python3
"""Layerbit static site build.

Composes each page in the repo from src/partials/ (shared head boilerplate,
header, footer) and src/pages/<slug>.* (per-page metadata, unique JSON-LD,
page-specific CSS, and body content with {{HEADER}}/{{FOOTER}} placeholders),
writing the result to the page's normal top-level path (index.html,
tools/*.html, ...) - the exact same paths GitHub Pages already serves.

Usage:
  python3 build.py            build all pages, write them in place
  python3 build.py --check    build in memory and diff against what's
                               committed; exits non-zero if anything differs
                               (used by CI to catch hand-edited output that
                               wasn't regenerated from its source)
"""
import re, glob, os, sys, json

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

CHECK = "--check" in sys.argv

# GA4 measurement ID for the layerbit.co.in web data stream, e.g. "G-ABC1234567".
# An empty string omits the analytics snippet entirely, so every page builds
# byte-for-byte as it does without it - which is why this can sit in the repo
# before the Analytics property exists. Filling it in is the only edit needed
# to instrument all pages at once.
#
# IMPORTANT: privacy.html, terms.html and about.html each describe what this
# site collects, and the policy promises it is updated *before* a collection
# change ships. Changing or clearing this ID therefore means editing those
# pages in the same commit, or the published disclosures become false.
GA_MEASUREMENT_ID = "G-ERX8MNPPP5"

# gtag.js, placed high in <head> per Google's guidance. Built once at import
# rather than per page, since it is identical everywhere.
# Google Consent Mode v2. Runs before gtag.js and adsbygoogle.js so both see
# the consent state from their first request: ads and analytics storage are
# denied by default for visitors in the EEA, the UK and Switzerland (where
# consent must come first) and granted elsewhere; a choice the visitor made
# in the cookie banner (js/shared.js) is re-applied before any tag fires.
CONSENT_REGIONS = ("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE "
                   "IS LI NO GB CH").split()
CONSENT_TAG = (
    "  <script>\n"
    "    window.dataLayer = window.dataLayer || [];\n"
    "    function gtag(){dataLayer.push(arguments);}\n"
    "    gtag('consent', 'default', {ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500, region: %s});\n"
    "    gtag('consent', 'default', {ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted'});\n"
    "    try { var lbc = localStorage.getItem('layerbit-cookie-consent'); if (!lbc && navigator.globalPrivacyControl === true) lbc = 'rejected'; if (lbc === 'accepted' || lbc === 'rejected') { var v = lbc === 'accepted' ? 'granted' : 'denied'; gtag('consent', 'update', {ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v}); } } catch (e) {}\n"
    "  </script>\n"
) % json.dumps(CONSENT_REGIONS)

ANALYTICS_TAG = CONSENT_TAG + ((
    "  <!-- Google tag (gtag.js) -->\n"
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script>\n'
    "  <script>\n"
    "    gtag('js', new Date());\n"
    "    gtag('config', '%s');\n"
    "  </script>\n"
) % (GA_MEASUREMENT_ID, GA_MEASUREMENT_ID) if GA_MEASUREMENT_ID else "")

with open("src/partials/head.html", encoding="utf-8") as f:
    HEAD_TMPL = f.read()
with open("src/partials/header.html", encoding="utf-8") as f:
    HEADER_TMPL = f.read()
with open("src/partials/header-home.html", encoding="utf-8") as f:
    HEADER_HOME_TMPL = f.read()
with open("src/partials/footer.html", encoding="utf-8") as f:
    FOOTER_TMPL = f.read()


def _registry(name):
    """[(slug, title)] from a list in js/kernel.js (TOOLS, GUIDES, SERVICES)."""
    with open("js/kernel.js", encoding="utf-8") as f:
        src = f.read()
    block = re.search(r"var %s = \[(.*?)\n  \];" % name, src, re.S).group(1)
    out = []
    for m in re.finditer(r"""^\s*\['([a-z0-9-]+)', (?:'((?:[^'\\]|\\.)*)'|"([^"]*)")""", block, re.M):
        title = m.group(2) if m.group(2) is not None else m.group(3)
        out.append((m.group(1), title.replace("\\'", "'")))
    return out


def _esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def footer_directory():
    """Footer site directory: every tool, guide and service, so each page links
    to every other indexable page (the strongest internal-linking signal a
    static site can give a crawler). Generated from the kernel registry so a
    new tool or guide appears in every footer without editing any page."""
    tools = [t for t in _registry("TOOLS") if not t[0].startswith("layerlink-viewer")]
    guides = _registry("GUIDES")
    services = _registry("SERVICES")
    col = lambda title, items: (
        '      <div class="site-dir-col">\n        <h2 class="site-dir-title">%s</h2>\n        <ul>\n%s        </ul>\n      </div>\n'
        % (title, "".join('          <li><a href="{{PREFIX}}%s">%s</a></li>\n' % (href, _esc(name)) for href, name in items)))
    return (col("Developer tools", [("tools/%s.html" % s, n) for s, n in tools])
            + col("Guides", [("guides/%s.html" % s, n) for s, n in guides])
            + col("Services", [("tools/%s.html" % s, n) for s, n in services])).rstrip("\n")


FOOTER_DIRECTORY = footer_directory()


def render(tmpl, **vals):
    out = tmpl
    for k, v in vals.items():
        out = out.replace("{{" + k + "}}", v)
    return out


def og_image_name(file):
    """images/og/<name>.png for a page path: index.html -> home, tools/x.html -> tools-x."""
    if file == "index.html":
        return "home"
    return file[:-len(".html")].replace("/", "-")


def breadcrumb_html(jsonld, prefix):
    m = re.search(r'"@type": "BreadcrumbList".*?"itemListElement": \[(.*?)\]\s*\}', jsonld, re.S)
    if not m:
        return ""
    items = re.findall(r'"name": "((?:[^"\\]|\\.)*)",\s*"item": "([^"]+)"', m.group(1))
    if len(items) < 2:
        return ""
    dec = lambda t: json.loads('"%s"' % t)
    parts = []
    for i, (name, url) in enumerate(items):
        name = _esc(dec(name))
        if i == len(items) - 1:
            parts.append('<span aria-current="page">%s</span>' % name)
        else:
            href = url.replace("https://layerbit.co.in/", prefix) or prefix or "./"
            if href == prefix and prefix == "":
                href = "./"
            parts.append('<a href="%s">%s</a>' % (href, name))
    return '  <nav class="crumbs tool-crumbs" aria-label="Breadcrumb">\n    ' + '\n    <span class="sep">/</span>\n    '.join(parts) + '\n  </nav>'


def build_page(slug_file):
    with open(slug_file, encoding="utf-8") as f:
        data = json.load(f)

    base = slug_file[:-len(".json")]
    with open(base + ".jsonld.html", encoding="utf-8") as f:
        jsonld = f.read().strip()
    with open(base + ".style.css", encoding="utf-8") as f:
        style = f.read()
    with open(base + ".body.html", encoding="utf-8") as f:
        body = f.read()

    prefix = data["prefix"]

    canonical_tag = f'  <link rel="canonical" href="{data["canonical"]}" />\n' if data["canonical"] else ""
    # Every page gets the rich-result preview directives; a page that sets its
    # own "robots" (404.html uses noindex) has that merged in front of them, so
    # there is exactly one robots meta tag per page rather than two conflicting
    # ones.
    SERP_DIRECTIVES = "max-image-preview:large, max-snippet:-1, max-video-preview:-1"
    robots_value = (f'{data["robots"]}, {SERP_DIRECTIVES}'
                    if data.get("robots") else SERP_DIRECTIVES)
    robots_tag = f'  <meta name="robots" content="{robots_value}" />\n'
    og_url = data["og_url"]
    # indent the JSON-LD block's first line to match the head partial's 2-space
    # style (its own internal lines already carry their own indentation from
    # Phase 2); empty when the page has no JSON-LD, leaving no stray line
    jsonld_block = ("  " + jsonld + "\n\n") if jsonld else ""

    # Per-page social preview: a branded 1200x630 card rendered by
    # scripts/gen_og_images.py, falling back to the site-wide image.
    og_name = og_image_name(data["file"])
    has_og = os.path.exists(f"images/og/{og_name}.jpg")
    og_image = f"https://layerbit.co.in/images/og/{og_name}.jpg" if has_og else "https://layerbit.co.in/og-image.png"
    og_alt = re.sub(r"\s*[|\u2013-]\s*Layerbit\s*$", "", data["title"]).strip() or "Layerbit"
    is_article = data["file"].startswith("guides/")
    og_article = ""
    if is_article:
        pub = re.search(r'"datePublished":\s*"([^"]+)"', jsonld)
        mod = re.search(r'"dateModified":\s*"([^"]+)"', jsonld)
        if pub: og_article += f'  <meta property="article:published_time" content="{pub.group(1)}" />\n'
        if mod: og_article += f'  <meta property="article:modified_time" content="{mod.group(1)}" />\n'
        og_article += '  <meta property="article:author" content="https://layerbit.co.in/about.html" />\n'

    head = render(
        HEAD_TMPL,
        OG_IMAGE=og_image,
        OG_IMAGE_TYPE="image/jpeg" if has_og else "image/png",
        OG_ALT=og_alt.replace('"', '&quot;'),
        OG_TYPE="article" if is_article else "website",
        OG_ARTICLE=og_article,
        VIEWPORT=data["viewport"],
        DESCRIPTION=data["description"],
        TITLE=data["title"],
        ANALYTICS_TAG=ANALYTICS_TAG,
        CANONICAL_TAG=canonical_tag,
        ROBOTS_TAG=robots_tag,
        OG_URL=og_url,
        JSONLD=jsonld_block,
        FONTS_FAMILY=data["fonts_family"],
        PREFIX=prefix,
        PAGE_STYLE=style,
        EXTRA_HEAD_LIBS=data.get("extra_head_libs", ""),
        EXTRA_HEAD_AFTER_RESOURCES=data.get("extra_head_after_resources", ""),
    )
    if data["file"] == "index.html":
        header = HEADER_HOME_TMPL
    else:
        header = render(HEADER_TMPL, HOME_HREF=data["home_href"])
    footer = render(FOOTER_TMPL, FOOTER_DIRECTORY=FOOTER_DIRECTORY, PREFIX=prefix)

    # strip any indentation preceding the marker itself - the partial already
    # carries its own correct leading indentation, so keeping the marker's
    # surrounding indent too would double it up. Use a replacement function
    # (not a raw string) so backslashes in the partial content can't be
    # misread as regex backreferences.
    header_s, footer_s = header.strip("\n"), footer.strip("\n")
    # Tool and service pages get a visible breadcrumb drawn from the page's
    # own BreadcrumbList, so what readers see and what search engines read
    # can never disagree. (Guides carry their own in the article markup.)
    if data["file"].startswith("tools/"):
        crumbs = breadcrumb_html(jsonld, prefix)
        if crumbs:
            header_s += "\n\n" + crumbs
    body_filled = re.sub(r'[ \t]*\{\{HEADER\}\}', lambda m: header_s, body)
    body_filled = re.sub(r'[ \t]*\{\{HEADER_HOME\}\}', lambda m: header_s, body_filled)
    # The kernel (palette, share links, history) loads right after the footer:
    # it is needed by the page scripts that follow, but nothing above the fold
    # depends on it, so keeping it out of <head> stops it blocking first paint.
    kernel_tag = '\n  <script src="{{PREFIX}}js/kernel.js"></script>'
    body_filled = re.sub(r'[ \t]*\{\{FOOTER\}\}', lambda m: footer_s + kernel_tag, body_filled)

    page = head + body_filled.rstrip("\n") + "\n</body>\n</html>\n"
    # Final pass: per-page fields such as extra_head_libs are spliced into the
    # head *after* its own PREFIX substitution, so a {{PREFIX}} inside them
    # would otherwise survive into the output. Resolving it last lets those
    # fields use root-relative asset paths that work from any directory depth.
    page = page.replace("{{PREFIX}}", prefix)
    return page, data["file"]


# Pages that were removed: each old address becomes an instant redirect to
# the closest live page, so links and search results that still point at it
# land somewhere useful instead of a 404. GitHub Pages cannot send HTTP 301s;
# a zero-delay meta refresh plus a canonical link is the equivalent Google
# documents for static hosts. Validators and the smoke test skip these files.
REDIRECTS = {
    "tools/breachalert.html": ("tools/password-generator.html", "Strong Password Generator"),
    "tools/malicious-url-checker-dns-only.html": ("tools/url-encoder.html", "URL Encoder & Decoder"),
    "tools/insight.html": ("", "Layerbit developer tools"),
    "tools/SAMPLE.html": ("", "Layerbit developer tools"),
}


def redirect_page(src, dest, label):
    depth = src.count("/")
    rel = "../" * depth + dest if dest else ("../" * depth or "./")
    url = "https://layerbit.co.in/" + dest
    lbl = _esc(label)
    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        "  <meta charset=\"utf-8\" />\n"
        "  <title>Moved to %s | Layerbit</title>\n"
        "  <link rel=\"canonical\" href=\"%s\" />\n"
        "  <meta http-equiv=\"refresh\" content=\"0; url=%s\" />\n"
        "  <script>location.replace(%s + location.search + location.hash);</script>\n"
        "</head>\n<body>\n  <p>This page has moved to <a href=\"%s\">%s</a>.</p>\n</body>\n</html>\n"
    ) % (lbl, url, rel, json.dumps(rel), rel, lbl)


def main():
    slug_files = sorted(glob.glob("src/pages/*.json"))
    mismatches = []
    written = 0
    jobs = [build_page(sf) for sf in slug_files]
    jobs += [(redirect_page(src, dest, label), src) for src, (dest, label) in REDIRECTS.items()]
    for page, target_path in jobs:

        # preserve the target file's existing line-ending convention (this repo
        # has 3 files committed with CRLF; everything else is LF)
        newline = "\n"
        if os.path.exists(target_path):
            with open(target_path, "rb") as f:
                raw = f.read()
            if b"\r\n" in raw:
                newline = "\r\n"
        out_bytes = page.replace("\n", newline).encode("utf-8")

        if CHECK:
            if os.path.exists(target_path):
                with open(target_path, "rb") as f:
                    current = f.read()
            else:
                current = b""
            if current != out_bytes:
                mismatches.append(target_path)
        else:
            with open(target_path, "wb") as f:
                f.write(out_bytes)
            written += 1

    if CHECK:
        if mismatches:
            print(f"BUILD CHECK FAILED: {len(mismatches)} file(s) differ from their generated output:")
            for m in mismatches:
                print(f"  {m}")
            print("\nRun `python3 build.py` and commit the result.")
            sys.exit(1)
        print(f"Build check OK: all {len(slug_files)} pages and {len(REDIRECTS)} redirects match their generated output.")
    else:
        print(f"Wrote {written} pages.")


if __name__ == "__main__":
    main()
