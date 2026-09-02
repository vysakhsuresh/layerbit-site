#!/usr/bin/env python3
"""Validates every top-level HTML page (index.html, tools/*.html, ...):
  1. structural HTML - every opening tag has a matching close
  2. JSON-LD blocks parse as valid JSON
  3. inline <script> blocks (no src=, not type=application/ld+json) are
     syntactically valid JS, checked via `node --check`

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


def main():
    node_available = subprocess.run(["node", "--version"], capture_output=True).returncode == 0
    if not node_available:
        print("warning: node not found on PATH, skipping inline JS syntax checks", file=sys.stderr)

    files = sorted(glob.glob("*.html") + glob.glob("tools/*.html"))
    failures = []
    for f in files:
        text = open(f, encoding="utf-8").read()
        errs = check_structure(text) + check_jsonld(text) + check_inline_js(text, node_available)
        if errs:
            failures.append((f, errs))

    if failures:
        for f, errs in failures:
            print(f"FAIL {f}")
            for e in errs:
                print(f"   {e}")
        print(f"\n{len(failures)} of {len(files)} page(s) failed validation.")
        sys.exit(1)

    print(f"OK: {len(files)} page(s) passed structural, JSON-LD, and inline-JS validation.")


if __name__ == "__main__":
    main()
