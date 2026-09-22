#!/usr/bin/env python3
"""Regenerates sitemap.xml from the pages build.py actually produces.

The page list comes from src/pages/*.json, so a new page cannot be forgotten
in the sitemap - which is how tools/*.html drifted out of it previously.
Pages carrying a noindex robots directive (404.html) are excluded.

Not part of build.py: lastmod uses today's date, which would make
`build.py --check` non-deterministic across days. Run it when pages change:

  python3 scripts/gen_sitemap.py
"""
import glob, json, os, sys
from datetime import date

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
        entries.append((loc, prio, freq, rel))

    # homepage first, then guides, tools, then the rest - purely cosmetic
    order = {"index.html": 0}
    entries.sort(key=lambda e: (
        order.get(e[3], 1),
        0 if e[3] == "blog.html" else 1 if e[3].startswith("guides/") else
        2 if e[3].startswith("tools/") else 3,
        e[3],
    ))

    today = date.today().isoformat()
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
           '']
    for loc, prio, freq, _ in entries:
        out += ["  <url>",
                f"    <loc>{loc}</loc>",
                f"    <lastmod>{today}</lastmod>",
                f"    <changefreq>{freq}</changefreq>",
                f"    <priority>{prio}</priority>",
                "  </url>"]
    out += ['', '</urlset>', '']

    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write("\n".join(out))

    print(f"sitemap.xml: {len(entries)} URLs, lastmod {today}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
