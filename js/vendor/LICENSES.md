# Vendored runtime libraries

These are unmodified release builds, copied from the npm registry so every
tool works with no third-party CDN in the request path (and therefore works
offline, and sends no visitor IP to a CDN operator).

| File | Package | Version | License |
|---|---|---|---|
| `lucide.min.js` | lucide (subset of the icons the site uses, built by `scripts/build_lucide_subset.py`) | 1.39.0 | ISC |
| `diff.min.js` | diff (jsdiff) | 5.1.0 | BSD-3-Clause |
| `js-yaml.min.js` | js-yaml | 4.1.0 | MIT |
| `sql-formatter.min.js` | sql-formatter | 15.6.2 | MIT |
| `cronstrue.min.js` | cronstrue | 2.47.0 | MIT |
| `JsBarcode.all.min.js` | jsbarcode | 3.11.5 | MIT |
| `qrcode.min.js` | qrcodejs | 1.0.0 | MIT |
| `xlsx.full.min.js` | xlsx (SheetJS CE) | 0.18.5 | Apache-2.0 |
| `marked.umd.js` | marked (`lib/marked.umd.js`) | 18.0.14 | MIT |
| `purify.min.js` | dompurify | 3.4.16 | MPL-2.0 OR Apache-2.0 |
| `eff-wordlist.js` | EFF Large Wordlist (via diceware-wordlist-en-eff 1.0.1), repackaged as one script | 2016 | CC BY 3.0 US |

To upgrade one: download the same `dist/` file from the new version's npm
tarball, replace it here, and update this table.
