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

with open("src/partials/head.html", encoding="utf-8") as f:
    HEAD_TMPL = f.read()
with open("src/partials/header.html", encoding="utf-8") as f:
    HEADER_TMPL = f.read()
with open("src/partials/header-home.html", encoding="utf-8") as f:
    HEADER_HOME_TMPL = f.read()
with open("src/partials/footer.html", encoding="utf-8") as f:
    FOOTER_TMPL = f.read()


def render(tmpl, **vals):
    out = tmpl
    for k, v in vals.items():
        out = out.replace("{{" + k + "}}", v)
    return out


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
    robots_tag = f'  <meta name="robots" content="{data["robots"]}" />\n' if data.get("robots") else ""
    og_url = data["og_url"]
    # indent the JSON-LD block's first line to match the head partial's 2-space
    # style (its own internal lines already carry their own indentation from
    # Phase 2); empty when the page has no JSON-LD, leaving no stray line
    jsonld_block = ("  " + jsonld + "\n\n") if jsonld else ""

    head = render(
        HEAD_TMPL,
        VIEWPORT=data["viewport"],
        DESCRIPTION=data["description"],
        TITLE=data["title"],
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
    footer = render(FOOTER_TMPL, PREFIX=prefix)

    # strip any indentation preceding the marker itself - the partial already
    # carries its own correct leading indentation, so keeping the marker's
    # surrounding indent too would double it up. Use a replacement function
    # (not a raw string) so backslashes in the partial content can't be
    # misread as regex backreferences.
    header_s, footer_s = header.strip("\n"), footer.strip("\n")
    body_filled = re.sub(r'[ \t]*\{\{HEADER\}\}', lambda m: header_s, body)
    body_filled = re.sub(r'[ \t]*\{\{HEADER_HOME\}\}', lambda m: header_s, body_filled)
    body_filled = re.sub(r'[ \t]*\{\{FOOTER\}\}', lambda m: footer_s, body_filled)

    page = head + body_filled.rstrip("\n") + "\n</body>\n</html>\n"
    return page, data["file"]


def main():
    slug_files = sorted(glob.glob("src/pages/*.json"))
    mismatches = []
    written = 0
    for sf in slug_files:
        page, target_path = build_page(sf)

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
        print(f"Build check OK: all {len(slug_files)} pages match their generated output.")
    else:
        print(f"Wrote {written} pages.")


if __name__ == "__main__":
    main()
