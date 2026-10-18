#!/usr/bin/env python3
"""Writes the Layerbit icon set (scripts/icons.py) into the homepage cards.
Tool and service cards get their own icon; guide cards get the icon of the
tool they explain. Idempotent: re-running replaces the previous icon."""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import icons

GUIDE_TOOL = {
    "jwt-signing-algorithms-compared": "jwt-decoder", "jwt-decode-vs-verify": "jwt-decoder",
    "three-way-merge-explained": "text-diff-checker", "subnetting-explained": "subnet-calculator",
    "uuid-v4-vs-v7-database-keys": "uuid-generator", "invisible-unicode-characters": "unicode-inspector",
    "cron-expressions-explained": "cron-generator", "yaml-gotchas": "yaml-json-converter",
    "regex-catastrophic-backtracking": "regex-tester", "csv-edge-cases": "csv-to-json",
    "uae-einvoicing-pint-ae": "pint-ae-checker", "json-syntax-errors-explained": "json-validator",
    "json-schema-validation-explained": "json-validator", "jsonpath-cheat-sheet": "json-validator",
    "base64-explained": "base64", "percent-encoding-explained": "url-encoder",
    "html-escaping-and-xss-contexts": "html-escape-unescape", "hashing-vs-encryption-vs-encoding": "hash-generator",
    "sql-formatting-and-dialects": "sql-formatter", "unix-time-and-time-zones": "timestamp-converter",
    "xpath-cheat-sheet": "xml-formatter",
    "how-to-create-a-strong-password": "password-generator",
    "wcag-color-contrast-explained": "color-converter",
    "twos-complement-explained": "number-base-converter",
    "naming-conventions-camelcase-snake-case": "text-case-converter",
    "markdown-cheat-sheet": "markdown-preview",
}

def main(path):
    s = open(path, encoding="utf-8").read()
    card = re.compile(r'(<a class="tool-card" href="(tools|guides)/([a-z0-9-]+)\.html">\s*(?:<div class="tool-badge[^"]*">.*?</div>\s*)?)<div class="icon-wrapper">(.*?)</div>(\s*<h3>)', re.S)
    n = 0
    def rep(m):
        nonlocal n
        kind, slug = m.group(2), m.group(3)
        key = GUIDE_TOOL.get(slug) if kind == "guides" else slug
        if key not in icons.ICONS:
            return m.group(0)
        n += 1
        return m.group(1) + '<div class="icon-wrapper">' + icons.svg(key) + '</div>' + m.group(5)
    s = card.sub(rep, s)
    open(path, "w", encoding="utf-8").write(s)
    print(f"{n} cards updated")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "src", "pages", "index.body.html"))
