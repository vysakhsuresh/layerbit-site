#!/usr/bin/env python3
"""Regenerates sitemap.xml from the pages build.py actually produces.

The page list comes from src/pages/*.json, so a new page cannot be forgotten
in the sitemap - which is how tools/*.html drifted out of it previously.
Pages carrying a noindex robots directive (404.html) are excluded.

lastmod is the date of the last commit that changed the page's text (body
copy, tool code, title or description; markup-only edits do not count), or
today when the working tree has such a change, so it
tells crawlers which pages actually changed instead of stamping every URL
with the same date (which search engines learn to ignore). Each URL also
lists its social card under the image sitemap extension. The same run writes
feed.xml, an Atom feed of the guides that Search Console also accepts as a
sitemap. Not part of build.py because the dates depend on git state:

  python3 scripts/gen_sitemap.py
"""
import glob, html, json, os, re, subprocess, sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

BASE = "https://layerbit.co.in/"

# priority / changefreq by area. Tools and guides are the pages worth crawling
# often; legal and contact pages effectively never change.
RULES = [
    ("index.html",   "1.0", "weekly"),
    ("blog.html",    "0.9", "weekly"),
    ("guides/",      "0.8", "monthly"),
    ("tools/",       "0.8", "monthly"),
    ("about.html",   "0.6", "monthly"),
    ("contact.html", "0.6", "yearly"),
    ("privacy.html", "0.4", "yearly"),
    ("terms.html",   "0.4", "yearly"),
]


def classify(rel):
    for prefix, prio, freq in RULES:
        if rel == prefix or (prefix.endswith("/") and rel.startswith(prefix)):
            return prio, freq
    return "0.5", "monthly"


def _git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()


def _text(blob):
    """What a reader gets from a source file: tags removed, whitespace folded,
    so markup-only edits (wrappers, classes, icon names) do not count as
    content changes. Script text stays in, so a tool's behaviour changes do."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", blob)).strip()


def lastmod(slug):
    """Date of the last commit that changed what a reader sees: the body text
    or the title/description. Today if the working tree has such a change."""
    files = [f"src/pages/{slug}.body.html", f"src/pages/{slug}.json"]

    def text_at(rev):
        out = []
        for f in files:
            if rev is None:
                out.append(_text(open(f, encoding="utf-8").read()) if os.path.exists(f) else "")
            else:
                r = subprocess.run(["git", "show", f"{rev}:{f}"], capture_output=True, text=True)
                out.append(_text(r.stdout) if r.returncode == 0 else "")
        return out

    if text_at(None) != text_at("HEAD"):
        return date.today().isoformat()
    log = _git("log", "--format=%H %cs", "--", *files).splitlines()
    for line in log:
        sha, day = line.split()
        if text_at(sha) != text_at(sha + "^"):
            return day
    return log[-1].split()[1] if log else date.today().isoformat()


def og_name(rel):
    return "home" if rel == "index.html" else rel[:-5].replace("/", "-")


def write_feed(guides):
    """Atom feed of guides, newest first."""
    items = []
    for slug, data in guides:
        ld = open(f"src/pages/{slug}.jsonld.html", encoding="utf-8").read()
        pub = (re.search(r'"datePublished":\s*"([^"]+)"', ld) or [None, date.today().isoformat()])[1]
        mod = (re.search(r'"dateModified":\s*"([^"]+)"', ld) or [None, pub])[1]
        body = open(f"src/pages/{slug}.body.html", encoding="utf-8").read()
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
        title = html.unescape(re.sub(r"<[^>]+>", "", h1.group(1))).strip() if h1 else data["title"]
        items.append((pub, mod, title, BASE + data["file"], data["description"]))
    items.sort(key=lambda i: (i[0], i[1]), reverse=True)
    esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    updated = max(i[1] for i in items)
    out = ['<?xml version="1.0" encoding="utf-8"?>', '<feed xmlns="http://www.w3.org/2005/Atom">',
           '  <title>Layerbit developer guides</title>',
           '  <subtitle>Practical, tested explanations of the formats and protocols behind everyday developer tools.</subtitle>',
           f'  <link href="{BASE}feed.xml" rel="self" type="application/atom+xml" />',
           f'  <link href="{BASE}blog.html" rel="alternate" type="text/html" />',
           f'  <id>{BASE}feed.xml</id>', f'  <updated>{updated}T00:00:00Z</updated>',
           '  <author><name>Layerbit Engineering</name><uri>https://layerbit.co.in/about.html</uri></author>',
           f'  <icon>{BASE}favicon-48.png</icon>', f'  <logo>{BASE}icon-512.png</logo>']
    for pub, mod, title, url, desc in items:
        out += ['  <entry>', f'    <title>{esc(title)}</title>', f'    <link href="{url}" rel="alternate" type="text/html" />',
                f'    <id>{url}</id>', f'    <published>{pub}T00:00:00Z</published>', f'    <updated>{mod}T00:00:00Z</updated>',
                f'    <summary>{esc(desc)}</summary>', '  </entry>']
    out += ['</feed>', '']
    open("feed.xml", "w", encoding="utf-8").write("\n".join(out))
    return len(items)


def main():
    entries = []
    for meta_file in sorted(glob.glob("src/pages/*.json")):
        with open(meta_file, encoding="utf-8") as f:
            data = json.load(f)

        robots = (data.get("robots") or "")
        if "noindex" in robots.lower():
            continue

        rel = data["file"]
        loc = BASE if rel == "index.html" else BASE + rel
        prio, freq = classify(rel)
        slug = os.path.basename(meta_file)[:-5]
        entries.append((loc, prio, freq, rel, slug, data))

    # homepage first, then guides, tools, then the rest - purely cosmetic
    order = {"index.html": 0}
    entries.sort(key=lambda e: (
        order.get(e[3], 1),
        0 if e[3] == "blog.html" else 1 if e[3].startswith("guides/") else
        2 if e[3].startswith("tools/") else 3,
        e[3],
    ))

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
           '']
    for loc, prio, freq, rel, slug, data in entries:
        out += ["  <url>",
                f"    <loc>{loc}</loc>",
                f"    <lastmod>{lastmod(slug)}</lastmod>",
                f"    <changefreq>{freq}</changefreq>",
                f"    <priority>{prio}</priority>"]
        if os.path.exists(f"images/og/{og_name(rel)}.jpg"):
            out += ["    <image:image>", f"      <image:loc>{BASE}images/og/{og_name(rel)}.jpg</image:loc>", "    </image:image>"]
        out += ["  </url>"]
    out += ['', '</urlset>', '']

    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    n_feed = write_feed([(e[4], e[5]) for e in entries if e[3].startswith("guides/")])
    today = "per-page dates"
    print(f"feed.xml: {n_feed} guides")
    print(f"sitemap.xml: {len(entries)} URLs, lastmod {today}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
