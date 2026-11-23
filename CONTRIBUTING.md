# Contributing to Layerbit

Layerbit is a set of developer tools that run entirely in the browser: no
upload, no account, no server doing the work. Contributions are welcome under
the rules below, which exist so that every claim the site makes stays true.

## Licence

The code in this repository is licensed under the **GNU Affero General Public
License v3.0** (see [LICENSE](LICENSE)). By opening a pull request you agree
that your contribution is licensed the same way.

- Third-party files under `js/vendor/` keep their own licences, listed in
  [js/vendor/LICENSES.md](js/vendor/LICENSES.md).
- The fonts in `fonts/` (Space Grotesk, Fira Code) are under the SIL Open Font
  License 1.1.
- The Layerbit name, logo and branding are not licensed for reuse
  (AGPL-3.0 section 7(e)). A copy you host must not present itself as Layerbit.
- Written guides, blog posts and graphics are copyright Layerbit Technologies;
  quoting with attribution and a link is welcome.

## How the site is built

Pages are generated. **Never edit `tools/*.html`, `guides/*.html` or the other
built pages by hand.**

| What | Where |
|---|---|
| Page body, styles, metadata, structured data | `src/pages/<slug>.body.html`, `.style.css`, `.json`, `.jsonld.html` |
| Shared header, footer, head | `src/partials/` |
| Tool logic (runs in the browser and under Node) | `js/engines/*.js` |
| Shared runtime (history, share links, send-to, drop, privacy counter) | `js/kernel.js` |
| Third-party libraries, vendored, no CDN | `js/vendor/` |

```bash
python3 build.py              # write every page from src/
python3 build.py --check      # fail if a committed page differs from src/
```

## Rules for every change

1. **Every bug gets a failing test first**, then the fix. Show the test failing
   before you fix it.
2. **Every feature gets tests with messy, real-world input** (odd encodings,
   stray quotes, huge files, empty files, duplicate keys and the like).
3. **No page URL changes.** Add pages; never move or rename one.
4. **Everything stays client-side.** A feature that needs a server is not added
   silently; see "What can't be local" in [docs/REVAMP_PLAN.md](docs/REVAMP_PLAN.md).
5. **New libraries are vendored** under `js/vendor/` with their licence added
   to `js/vendor/LICENSES.md`. No CDNs.
6. **Every claim on a page must be true.** Update the page's hero, FAQ,
   changelog and JSON-LD (`scripts/gen_tool_jsonld.py`) with the change. Name
   competitors only in honest comparisons: no logos, no keyword stuffing,
   nothing implying an affiliation.
7. **Nothing is stored without asking.** Run history is off by default and is
   saved only when the visitor turns it on and runs a tool explicitly.

## Checks that must pass

```bash
for f in scripts/unit/*.test.js; do node "$f" || exit 1; done   # engine unit tests
python3 build.py --check
python3 scripts/validate.py                                      # structure, JSON-LD, inline JS, SEO, links
LAYERBIT_CHROMIUM=/path/to/chromium python3 scripts/test_tools.py   # every tool in headless Chromium
python3 scripts/audit_controls.py --corpus DIR                   # options that change nothing
python3 scripts/audit_layout.py                                  # overflow and geometry, desktop and phone
```

`--only <slug>` limits `test_tools.py` and `audit_controls.py` to one tool.
`audit_controls.py` needs a folder of real-world files; the names it expects
are listed in the script.

## Workflow

Work on a branch and open a pull request; nothing is pushed to `main`
directly. Commit after each item so a review can follow the change step by
step. The order of work is in [ROADMAP.md](ROADMAP.md).
