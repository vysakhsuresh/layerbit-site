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
| `qrcode-generator.min.js` | qrcode-generator (Kazuhiko Arase; `dist/qrcode.js` minified with esbuild) | 2.0.4 | MIT |
| `jsQR.min.js` | jsQR (`dist/jsQR.js` minified with esbuild; used for the scan check) | 1.4.0 | Apache-2.0 |
| `bwip-js.min.js` | bwip-js (`dist/bwip-js-min.js`, Barcode Writer in Pure PostScript; loaded for Data Matrix, PDF417, Aztec and GS1-128) | 4.11.4 | MIT |
| `date-holidays.min.js` | date-holidays (bundled as `window.LBHolidays` with esbuild; loaded when a country is picked) | 3.39.2 | ISC (code), CC BY-SA 4.0 (holiday data) |
| `gst/hsn-sac.json` | HSN and SAC codes and descriptions from hsn-code-package (CBIC / WCO nomenclature), rebuilt by `scripts/update_gst_codes.py`; its GST rates are not included | 3.0.0 | ISC |
| `pcre2.min.js` | pcre2-wasm (PCRE2 10.49 in WebAssembly, inline; bundled as `window.LBPcre2` with esbuild) | 10.49.3 | MIT (wrapper), BSD-3-Clause WITH PCRE2-exception (PCRE2) |
| `wasm/regex-rust.wasm` | Rust `regex` crate 1.13.2 with regex-syntax, regex-automata, aho-corasick and memchr, built by Layerbit from `wasm/src/regex-rust.rs` (rustc 1.97, wasm32-unknown-unknown) | 1.13.2 | MIT OR Apache-2.0 (memchr: MIT OR Unlicense) |
| `wasm/regex-go.wasm`, `go-wasm-exec.js` | Go 1.24.7 standard library `regexp`, built by Layerbit from `wasm/src/regex-go.go` (GOOS=js GOARCH=wasm); `wasm_exec.js` from the Go distribution | 1.24.7 | BSD-3-Clause |
| `onig/onig.js`, `onig/onig.wasm` | vscode-oniguruma (Oniguruma in WebAssembly) | 2.0.1 | MIT (wrapper), BSD-2-Clause (Oniguruma) |
| `pyodide/*` | Pyodide (CPython in WebAssembly; only the core files and standard library are copied) | 314.0.8 | MPL-2.0 (Pyodide), PSF License 2.0 (CPython) |
| `xlsx.full.min.js` | xlsx (SheetJS CE) | 0.18.5 | Apache-2.0 |
| `marked.umd.js` | marked (`lib/marked.umd.js`) | 18.0.14 | MIT |
| `purify.min.js` | dompurify | 3.4.16 | MPL-2.0 OR Apache-2.0 |
| `eff-wordlist.js` | EFF Large Wordlist (via diceware-wordlist-en-eff 1.0.1), repackaged as one script | 2016 | CC BY 3.0 US |
| `jmespath.min.js` | jmespath (`jmespath.js`, minified with esbuild) | 0.16.0 | Apache-2.0 |
| `jsonquery.min.js` | @jsonquerylang/jsonquery (`lib/jsonquery.js` bundled as `window.JSONQuery` with esbuild) | 5.1.1 | ISC |
| `smol-toml.min.js` | smol-toml (`dist/index.js` bundled as `window.TOML` with esbuild) | 1.9.1 | BSD-3-Clause |
| `wasm/jq.js`, `wasm/jq.wasm` | jq-web (jq 1.7 compiled to WebAssembly; jq itself is MIT) | 0.6.2 | ISC (jq-web), MIT (jq) |
| `fontoxpath.min.js` | fontoxpath (XPath 3.1 / XQuery 3.1; bundled as `window.fontoxpath` with esbuild, with its dependencies) | 3.34.0 | MIT |
| `xmllint/` (`index-browser.mjs`, `xmllint-browser.mjs`, `xmllint.wasm`, `COPYING`) | xmllint-wasm (libxml2 2.13.8 compiled to WebAssembly), files copied unchanged | 5.3.0 | MIT |
| `yaml.min.js` | yaml (eemeli/yaml; bundled as `window.YAML` with esbuild) | 2.9.1 | ISC |
| `ajv.min.js` | ajv + ajv-formats (bundled as `window.LBAjv` with esbuild) | 8.20.0 / 3.0.1 | MIT |
| `schemas/k8s-*.json` | yannh/kubernetes-json-schema v1.30.0-standalone-strict, annotations stripped (see `schemas/README.md`) | Kubernetes 1.30.0 | Apache-2.0 |
| `schemas/compose-spec.json` | compose-spec/compose-spec, annotations stripped | 2026-11 | Apache-2.0 |
| `schemas/github-workflow.json` | SchemaStore github-workflow, annotations stripped | 2026-11 | Apache-2.0 |
| `hash-wasm.min.js` | hash-wasm (`dist/index.umd.min.js`, WebAssembly embedded; `window.hashwasm`) | 4.12.0 | MIT |
| `xslt-polyfill.min.js` | xslt-polyfill (libxslt/libxml2 compiled to WebAssembly; replaces `window.XSLTProcessor`, file copied unchanged) | 1.0.37 | BSD-3-Clause (libxslt, libxml2: MIT) |
| `node-sql-parser.min.js` | node-sql-parser (`umd/index.umd.js`, all 14 database grammars; sets `window.Parser`; loaded on first syntax check; source-map comment removed) | 5.4.0 | Apache-2.0 |
| `mermaid.min.js` | mermaid (`dist/mermaid.min.js`, file copied unchanged; loaded when a document has a diagram) | 11.12.0 | MIT |
| `katex/katex.min.js`, `katex/katex.min.css`, `katex/fonts/*.woff2` | KaTeX (the CSS keeps only the woff2 font sources) | 0.16.25 | MIT |
| `highlight.min.js` | highlight.js (`lib/common`, its 36 common languages, bundled as `window.hljs` with esbuild) | 11.11.1 | BSD-3-Clause |
| `marked-footnote.umd.js` | marked-footnote (`dist/index.umd.js`, source-map comment removed) | 1.4.0 | MIT |
| `wasm/selftest.wasm` | Layerbit's own 41-byte test module for the WebAssembly loader | n/a | AGPL-3.0 |

To upgrade one: download the same `dist/` file from the new version's npm
tarball, replace it here, and update this table. Packages published only as
ES modules are bundled into one browser script with
`npx esbuild entry.js --bundle --minify --format=iife --global-name=NAME`,
where `entry.js` re-exports the functions the page uses.

## Reference implementations

- **CyberChef** (GCHQ, Apache-2.0, https://github.com/gchq/CyberChef): the Flow tool's operation names, arguments and expected outputs follow CyberChef's where the two have the same operation, so recipes read the same. No CyberChef code is bundled; `js/engines/flowops.js` is written for Layerbit.
