#!/usr/bin/env python3
"""Validates every generated HTML page (index.html, tools/*.html, guides/*.html):
  1. structural HTML - every opening tag has a matching close
  2. JSON-LD blocks parse as valid JSON
  3. inline <script> blocks (no src=, not type=application/ld+json) are
     syntactically valid JS, checked via `node --check`
  4. the internal link graph: every internal href resolves to a real file,
     every local script/stylesheet resolves, and every indexable page is
     reachable by clicking from index.html (a page only the sitemap knows
     about is invisible to a reader and to a content reviewer)

Run standalone: python3 scripts/validate.py
Exits non-zero (with a summary of every failure) if anything fails.
"""
import re, glob, os, sys, json, subprocess, tempfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}


class BalanceChecker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"unexpected close </{tag}> with empty stack")
            return
        if self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.errors.append(f"unclosed <{self.stack[-1]}> before </{tag}>")
                self.stack.pop()
            if self.stack:
                self.stack.pop()
        else:
            self.errors.append(f"</{tag}> with no matching open tag")


def check_structure(text):
    c = BalanceChecker()
    try:
        c.feed(text)
    except Exception as e:
        return [f"parser exception: {e}"]
    errs = list(c.errors)
    if c.stack:
        errs.append(f"still open at EOF: {c.stack}")
    return errs


def check_jsonld(text):
    errs = []
    for i, block in enumerate(re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', text, re.S)):
        try:
            json.loads(block)
        except Exception as e:
            errs.append(f"JSON-LD block #{i}: {e}")
    return errs


def check_inline_js(text, node_available):
    if not node_available:
        return []
    # strip ld+json blocks first so a literal "<script>" inside a JSON
    # string value can't be mistaken for the start of a real script tag
    stripped = re.sub(r'<script type="application/ld\+json">.*?</script>', '', text, flags=re.S)
    errs = []
    for i, code in enumerate(re.findall(
            r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', stripped, re.S)):
        if not code.strip():
            continue
        with tempfile.NamedTemporaryFile(suffix=".js", mode="w", delete=False, encoding="utf-8") as fh:
            fh.write(code)
            tmp = fh.name
        try:
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            if r.returncode != 0:
                errs.append(f"inline script #{i}: {r.stderr.strip()}")
        finally:
            os.unlink(tmp)
    return errs


def check_link_graph(files):
    """Site-wide: broken internal hrefs/assets and orphaned indexable pages."""
    pages = set(files)
    links = {}
    assets_missing = []
    for f in files:
        text = open(f, encoding="utf-8").read()
        # literal example markup inside <pre>/<code> is not a link
        text = re.sub(r"<(pre|code)\b.*?</\1>", "", text, flags=re.S)
        base = os.path.dirname(f)
        out = set()
        for href in re.findall(r'<a\b[^>]*\bhref="([^"#?]+)', text):
            if href.startswith(("http://", "https://", "mailto:", "tel:", "javascript:")):
                continue
            t = os.path.normpath(os.path.join("/" if href.startswith("/") else base, href.lstrip("/"))).lstrip("/")
            out.add("index.html" if t in ("", ".") else t)
        links[f] = out
        for src in re.findall(r'<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"', text):
            if src.startswith(("http://", "https://", "//", "data:")):
                continue
            t = os.path.normpath(os.path.join(base, src.split("?")[0]))
            if not os.path.exists(t):
                assets_missing.append((f, src))

    errs = []
    for f, out in links.items():
        for t in out:
            if t not in pages and not os.path.exists(t):
                errs.append(f"{f}: broken internal link -> {t}")
    for f, src in assets_missing:
        errs.append(f"{f}: missing local asset -> {src}")

    seen, queue = {"index.html"}, ["index.html"]
    while queue:
        for t in links.get(queue.pop(), ()):
            if t in pages and t not in seen:
                seen.add(t); queue.append(t)
    for f in files:
        if f in seen:
            continue
        text = open(f, encoding="utf-8").read()
        if re.search(r'<meta name="robots" content="[^"]*noindex', text):
            continue  # 404.html and friends are meant to be unreachable
        errs.append(f"{f}: indexable page is not reachable from index.html (orphan)")
    return errs


def main():
    node_available = subprocess.run(["node", "--version"], capture_output=True).returncode == 0
    if not node_available:
        print("warning: node not found on PATH, skipping inline JS syntax checks", file=sys.stderr)

    files = sorted(glob.glob("*.html") + glob.glob("tools/*.html")
                   + glob.glob("guides/*.html"))
    failures = []
    for f in files:
        text = open(f, encoding="utf-8").read()
        errs = check_structure(text) + check_jsonld(text) + check_inline_js(text, node_available)
        if errs:
            failures.append((f, errs))

    graph_errs = check_link_graph(files)
    if graph_errs:
        failures.append(("(site-wide link graph)", graph_errs))

    if failures:
        for f, errs in failures:
            print(f"FAIL {f}")
            for e in errs:
                print(f"   {e}")
        print(f"\n{len(failures)} of {len(files)} page(s) failed validation.")
        sys.exit(1)

    print(f"OK: {len(files)} page(s) passed structural, JSON-LD, inline-JS and link-graph validation.")


if __name__ == "__main__":
    main()
