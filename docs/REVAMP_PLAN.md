# Layerbit master revamp plan: every premium feature, free, local, open source

Repo: vysakhsuresh/layerbit-site. This is the single handoff for the Claude Code project "Layerbit Ai [website]".
It contains:
- **Part 1:** the big picture
- **Part 2:** a competitor comparison and verdict for every tool
- **Part 3:** the build order
- **Part 4:** the accepted bug fixes (cross-tool and per-tool)
- **Part 5:** the Diff Checker work
- **Part 6:** what cannot be done locally

How this was produced: every bug in Part 4 was reproduced with real inputs. Competitor features and prices come from the vendors' own pages, or from listing sites where noted, checked in November 2026. A few small categories have no paid leader at all (Base64, UUID, URL, HTML escape); for those the bar is the best free tool. Today all 242 browser tests and 12 engine test suites pass, so every issue listed here is one the current tests miss.

---

## Part 1: The big picture

### Where Layerbit stands today (32 tools plus the Diff Checker)
- **Already at or above the best free and paid tools (11):** JWT Decoder, Password Generator, Unicode Inspector, Number Base Converter, Text Case Converter, URL Encoder, HTML Escape, Base64, UUID Generator, Timestamp Converter, Time Zone Converter.
- **Ahead in some areas, behind in others (5):** Regex Tester, Color Converter, JSON Formatter, Subnet Calculator, Cron Generator.
- **Behind the paid leader (17):** Diff Checker, JSON to Table, CSV ↔ JSON, XML Formatter, YAML ↔ JSON, SQL Formatter, Hash Generator, Markdown Editor, QR & Barcode, Log Analyzer, Date Calculator, Flow, VAT & GST, PINT-AE Checker, LayerLink (sharer and viewer).

### Why they're behind: the same seven gaps repeat across tools
Fixing these as shared platform pieces, not one tool at a time, is what turns 17 "behind" verdicts into "ahead".

1. **Correctness engine.** Three CSV parsers share the same bug. Long numbers are rounded in four tools. Non-UTF-8 files are read wrongly. History saves without asking. (Part 4, section A.)
2. **Scale.** Paid and leading tools handle huge files: klogg says 10+ GB is no problem, CyberChef handles files up to about 2 GB, and BracketView's paid plan handles 50 MB JSON. Layerbit tools load whole files into the page (the Log Analyzer caps at 150 MB; the Hash Generator reads up to 1 GB into memory). Fix: a shared streaming file reader, Web Workers, virtualised views and progress/cancel on every file tool.
3. **Real engines via WebAssembly.** Most "pro" features are engines that already exist as open-source C/C++/Rust and compile to WebAssembly: libxml2 (XSD/DTD/RelaxNG validation), the regex engines of other languages (PCRE2, Python, .NET, Java, Go), BLAKE3/xxHash/SHA-3, jq, pandoc-style DOCX export, and so on. A vendored `js/vendor/wasm/` layer gives every tool desktop-grade power with no server.
4. **Batch and folders.** Paid tools sell bulk work: QR Code Generator Pro's bulk creation, SQL Prompt's bulk formatting and code analysis, QuickHash's recursive folder hashing. Add one shared "many files / whole folder in, zip/CSV report out" component.
5. **Desktop feel.** The site is already a PWA (manifest with `display: standalone`, service worker). Add `file_handlers` to the manifest so an installed Layerbit can be the "Open with…" app for .json, .csv, .xml, .log, .md and .patch files. Pre-cache every tool and its WASM so the whole site works offline. That's the "Notepad++" experience, free.
6. **Open source for real.** There is **no LICENSE file** in the repo. A public repo without a license is legally "all rights reserved", not open source. Add a license (the owner chooses: MIT for maximum adoption, or AGPL-3.0 to keep forks open), plus CONTRIBUTING.md, a public roadmap built from this file, and a "verify it yourself" page showing the network counter and how to run the site from a local copy.
7. **Honest proof of "better".** For each tool, add a test file (`scripts/parity/<tool>.json`) listing every competitor feature claimed on the page, each linked to an automated test. A claim without a passing test fails the build. Comparison pages ("Free alternative to Beyond Compare", etc.) are published only when the parity file is green.

### What can't be done locally (be upfront on each page)
Dynamic QR codes with scan analytics, cron job *monitoring*, log *ingestion and alerting*, network discovery / IPAM scanning, official UAE e-invoice exchange (only accredited providers may do it), remote control and unattended access, and cloud sync/collaboration all need a server or OS-level access. See Part 6 for what to offer instead.

---

## Part 2: Every tool against its competitors

For each tool: the competitors, what they charge for, what Layerbit has and lacks, the verdict, and what to build. Prices are what the vendors list, as found in November 2026.

### 2.1 Diff Checker: BEHIND (see Part 5)
- **Competitors:** Beyond Compare (Standard $35, Pro $70 per user), WinMerge (free, Windows only), Meld (free).
- **Layerbit lacks:** real folder compare, every Excel sheet, multiple key columns, hex and image compare, exporting differences. It also has 20 confirmed bugs.
- **Build:** Part 5.

### 2.2 JSON Formatter & Validator: MIXED
- **Competitors:**
  - JSON Crack Premium ($5/mo billed yearly): large data (~4 MB), compact graph view, editing directly on the graph, tabs, comparing data, AI filter.
  - JSON Editor Online (free, paid ad-free/cloud tiers): text, tree and table modes; JSON Query, JSONPath, JMESPath and JavaScript/Lodash transforms; compare; repair; schema validation; CSV conversion.
  - BracketView Pro: a Performance Mode for JSON up to 50 MB.
  - Altova XMLSpy (Professional from $679): JSON5, JSON Lines, JSON with comments, a graphical JSON Schema editor, sample instances generated from a schema, XML ↔ JSON, XSD ↔ JSON Schema.
- **Layerbit has:** formatting, validation, tree view, minify, repair with a list of changes, full JSONPath, schema validation and inference, types generated for 7 languages (beyond most free tools), SQL/CSV export, NDJSON.
- **Layerbit lacks:**
  - Graph view with editing on the graph
  - Table mode with editing
  - Data-level compare (link to the Diff Checker's structure mode)
  - JMESPath, jq and JSON Query transforms
  - Explicit JSON5 / JSONC / JSON Lines modes
  - 50 MB+ files in a Worker with a virtualised tree
  - XML/YAML/TOML conversion
  - Sample JSON generated from a schema
  - A visual schema editor
  - Lossless numbers (bug A3)
- **Build all of the above.**

### 2.3 JSON to Table: BEHIND
- **Competitors:** JSON Editor Online table mode; JSON Crack; Datasette (open source).
- **Layerbit has:** flattening, sort, live filter, CSV export.
- **Layerbit lacks:** cell editing with JSON re-export, a virtualised grid for 100k+ rows, hiding/reordering/resizing columns, group-by and aggregates, per-column filters, .xlsx export, safe CSV export (A4).
- **Build all of the above.**

### 2.4 CSV ↔ JSON: BEHIND
- **Competitors:** Modern CSV (free version; Premium licences listed at $39 Personal / $59 Business), ConvertCSV, Tablecruncher.
- **Layerbit has:** both directions, delimiter detection, quoting.
- **Layerbit lacks:**
  - A correct parser (A2) and type inference that doesn't destroy data (A3)
  - Every Excel sheet in and .xlsx out
  - JSON Lines
  - Nested JSON from dotted headers and back
  - Choosing, renaming and reordering columns
  - 100 MB+ streaming
  - An editable grid preview
- **Build all of the above.**

### 2.5 XML Formatter: BEHIND (widest gap)
- **Competitors:** Oxygen XML Editor and Altova XMLSpy (Professional from $679, Enterprise higher): validation against XSD/DTD/RelaxNG/Schematron, XSLT and XQuery transformation and debugging, schema editors, XML ↔ JSON.
- **Layerbit has:** formatting, minify, well-formedness errors with line and column, XPath 1.0 with namespace help, XML → JSON.
- **Layerbit lacks, and how to build it locally:**
  - XSD, DTD and RelaxNG validation through libxml2 compiled to WebAssembly
  - Schematron (ISO) through XSLT
  - XSLT 1.0 using the browser's built-in XSLTProcessor; XSLT 3.0 and XQuery through a JS/WASM engine whose licence allows bundling
  - JSON → XML
  - XML compare (Diff Checker structure mode)
  - Large files in a Worker
- **Also:** the page's FAQ says browsers can't validate against a schema. Change that once validation ships.

### 2.6 YAML ↔ JSON: BEHIND (bugs)
- **Competitors:** none paid; the bar is yamllint plus Kubernetes/IDE schema validation.
- **Layerbit lacks:**
  - Multi-document files (B4)
  - Dates kept as written (B4) and lossless numbers (A3)
  - A YAML 1.1/1.2 switch with "Norway problem" warnings
  - Comment-preserving formatting
  - Lint (duplicate keys, tabs)
  - Kubernetes / Compose / GitHub Actions schema validation using vendored schemas
- **Build all of the above.**

### 2.7 SQL Formatter: BEHIND
- **Competitor:** Redgate SQL Prompt, which starts at $198 per year (some listings say $210). It offers one-click customisable formatting, code analysis with auto-fixes, refactoring, query history, and bulk formatting and analysis.
- **Layerbit has:** 16+ dialects, keyword case, indent styles, minify.
- **Layerbit lacks:**
  - Rich style rules saved as named profiles (import/export JSON)
  - Code analysis with one-click fixes (`SELECT *`, `UPDATE`/`DELETE` without `WHERE`, `NOT IN` with a nullable subquery, implicit joins, unused variables, leading-wildcard `LIKE`)
  - Formatting many files at once, and selection-only formatting
  - Syntax errors per dialect
  - Autocomplete from pasted DDL (tables and columns), which needs no database connection
- **Build all of the above.**

### 2.8 Regex Tester: MIXED
- **Competitors:**
  - RegexBuddy ($39.95 single user, Windows): deep multi-flavour emulation.
  - RegexMagic ($39.95): generates patterns from examples.
  - regex101 (free core): debugger, code generator, unit tests, many flavours.
- **Layerbit is ahead on:** ReDoS (catastrophic backtracking) analysis with a growth measurement, a railroad diagram, pattern synthesis from examples (what RegexMagic charges for), unit tests in share links, code for 10 languages, whole-file batch testing.
- **Layerbit lacks:** real engines for other languages (PCRE2, Python `re`, .NET, Java, Go RE2, Rust) via WASM so matches are exact per language (today matching uses JavaScript only), a step-by-step backtracking debugger, a substitution preview, and the false-positive fix (B3).
- **Build all of the above.**

### 2.9 Cron Generator: MIXED
- **Competitors:**
  - crontab.guru (free).
  - Cronitor (monitoring; free for 5 jobs, then about $2 per monitor). Monitoring needs a server: see Part 6.
- **Layerbit has:** a builder, plain-English explanation, validation, next runs in any time zone.
- **Layerbit lacks:**
  - The next-runs bug fix (B1) and `@daily`-style macros
  - Dialects: Quartz/Spring, AWS EventBridge, GitHub Actions, Kubernetes, Azure, Jenkins `H`
  - A 30-day calendar/heatmap view
  - Conversion between dialects
  - English text to an expression
- **Build all of the above.**

### 2.10 Hash Generator: BEHIND
- **Competitors:**
  - QuickHash GUI (free, open source): MD5, SHA-1, SHA-3 (256-bit), SHA-256, SHA-512, xxHash, BLAKE2B, BLAKE3 and CRC32; recursive folder hashing with CSV/HTML results; comparing two files or two folders.
  - OpenHashTab (free): also SHA-3 224–512, RIPEMD-160 and xxHash3, plus checking against checksum files.
- **Layerbit has:** MD5, SHA-1/256/384/512, HMAC, a constant-time verifier.
- **Layerbit lacks:**
  - SHA-3, BLAKE2/3, xxHash/XXH3, CRC32/CRC32C, RIPEMD-160
  - Streaming hashing for files of any size
  - Many files and whole folders, with CSV/HTML reports
  - Compare two files or two folders
  - Checking against `.sha256` / `.md5` / `SHA256SUMS` files
  - Exact-byte text mode (A6)
- **Build all of the above.**

### 2.11 Markdown Editor: BEHIND
- **Competitors:**
  - Typora ($14.99 one-time, 3 devices): built-in Mermaid, LaTeX math, export to PDF, HTML, Word, ePub and LaTeX, themes, focus mode.
  - Dillinger (free, web): PDF export, math.
- **Layerbit has:** GFM, toolbar, sanitised preview, table of contents, HTML export, scroll sync.
- **Layerbit lacks:**
  - Mermaid (renders locally; the FAQ wrongly says it needs GitHub's servers)
  - KaTeX math, footnotes, syntax highlighting
  - PDF, DOCX and ePub export
  - Themes, focus/typewriter modes
  - Pasted images
  - Several documents with opt-in local autosave (OPFS)
- **Build all of the above.**

### 2.12 QR & Barcode: BEHIND on design and bulk
- **Competitors:**
  - QR Code Generator Pro: its Professional plan includes 250 dynamic codes, unlimited static codes, full customisation, scan statistics with CSV export, and bulk creation of up to 500 codes per upload.
  - QRStuff: paid plans from $10 to $250 a month.
- **Layerbit has:** URL, UPI, Wi-Fi, WhatsApp and vCard codes, linear barcodes, error-correction levels, PNG/SVG, URL checks.
- **Layerbit lacks:**
  - A logo in the centre, colours with a contrast check, dot and eye shapes, frames with call-to-action text
  - PDF/EPS export
  - Bulk generation from CSV (unlimited, unlike paid caps)
  - More content types: event, SEPA/EPC, geo, email, SMS
  - Data Matrix, PDF417, Aztec, GS1-128
- **Can't be local:** dynamic codes and analytics need a server. Say so on the page, and present "static, never tracked, never expires" as a strength.

### 2.13 Log Analyzer: BEHIND
- **Competitors:**
  - klogg (free, open source): reads from disk without loading into memory; files of 10+ GB; encoding detection (UTF-8, UTF-16, cp1251 and more); multithreaded.
  - Datadog: log ingest from $0.10 per GB, 200+ out-of-the-box parsers.
- **Layerbit has:** severity counts, filter/grep with regex, and a "most repeated messages" collapse similar to Datadog's pattern view.
- **Layerbit lacks:**
  - Multi-GB streaming (150 MB cap today)
  - Encoding detection
  - Multi-line event grouping (B7)
  - Parsers (JSON, key=value, Apache/Nginx, syslog, Windows events)
  - Timeline histogram with zoom
  - Merging several files by time
  - Saved searches and highlight rules
- **Can't be local:** ingestion and alerting need a server (Part 6).

### 2.14 Color Converter: MIXED
- **Competitor:** Coolors. Free palettes, and colour extraction from images. Pro ($3/mo billed yearly) adds unlimited palettes, projects and collections, advanced export formats and the AI colour bot.
- **Layerbit is ahead on:** CSS Color 4 parsing including OKLCH, WCAG 2.2 and APCA contrast with automatic fixes, Tailwind/SCSS/Android/SwiftUI export, colour-vision simulation.
- **Layerbit lacks:**
  - The palette-generator workflow (spacebar generate, lock, shuffle)
  - Extraction from an image, plus an eyedropper
  - A gradient builder
  - Saved palettes (local, opt-in)
  - .ase / Procreate / PDF swatch export
- **Build all of the above.**

### 2.15 Date Calculator: BEHIND
- **Competitor:** timeanddate.com, whose business-day calculator excludes holidays per country. Its paid API has sold this per country: archived pricing shows $250 a year for one country, and the service covers 180+ countries.
- **Layerbit has:** working days with five weekend patterns and a holiday list you type in.
- **Layerbit lacks:** built-in public holiday calendars for at least the GCC, India and the top 30 countries (vendored data, e.g. the open-source date-holidays dataset, with the data version shown), Hijri (Umm al-Qura) conversion, durations with times, countdowns, batch maths on a column.

### 2.16 Time Zone Converter: AT PAR
- **Competitor:** World Time Buddy (freemium).
- **Layerbit has:** DST-aware conversion, plain-English input, skipped/repeated time warnings, a meeting planner.
- **Add:** .ics invite export, a shareable meeting-slot link, upcoming DST changes, an ambiguity prompt for CST/IST-style abbreviations.

### 2.17 Timestamp Converter: AT PAR
- **Competitor:** epochconverter.com (free).
- **Add:** .NET ticks, Windows FILETIME, Excel serial dates, LDAP/AD, Apple/Cocoa, GPS time, batch conversion of a column.

### 2.18 Subnet Calculator: MIXED
- **Competitor:** SolarWinds IPAM (paid; subnet allocation wizard, discovery and monitoring) and its free Advanced Subnet Calculator.
- **Layerbit has:** IPv4/IPv6 with exact arithmetic, splitting, membership checks, supernets, CSV export.
- **Add:** a VLSM allocation wizard (from a list of host counts), range → minimal CIDR list, overlap/conflict check, IPv6 planning.
- **Can't be local:** discovery and scanning need network access (Part 6).

### 2.19 JWT Decoder: AHEAD
- **Competitors:** jwt.io (free, Auth0), Authgear's JWT/JWE debugger (free).
- **Layerbit has:** HS/RS/PS/ES/EdDSA verification with PEM/JWK/JWKS, signing with 13 algorithms and key generation, JWE encrypt and decrypt, lint, timeline.
- **Must fix:** it auto-saves pasted tokens (A1).
- **Optional:** fetch a JWKS from a URL, off by default and shown in the privacy counter.

### 2.20 Password Generator: AHEAD
- **Competitors:** the free 1Password and Bitwarden generators.
- **Optional:** a breach check using HIBP k-anonymity (only 5 characters of a hash are sent), off by default and clearly labelled.

### 2.21 Flow: BEHIND on breadth
- **Competitor:** CyberChef (free, Apache 2.0): over 300 operations, files up to about 2 GB, Fork and Magic.
- **Layerbit has:** 74 operations, magic detection, recipes in share links.
- **Close the gap:** port the CyberChef operation set (its Apache 2.0 licence allows reuse with attribution in `LICENSES.md`), add breakpoints and fork, raise file size via streaming, use the shared CSV parser (A2).
- **Then beat it:** a cleaner UI and "send to" between Layerbit tools.

### 2.22 to 2.28: AT PAR or AHEAD (small additions only)
- **Unicode Inspector:** none needed.
- **URL Encoder:** an option to show `+` as a space in query values.
- **HTML Escape:** none needed.
- **Base64:** MIME 76-character wrapping, file type detected from magic bytes, hex view, 100 MB+ streaming, encoding choice (A5).
- **UUID Generator:** v1/v6 generation, NanoID, KSUID, CUID2, Snowflake, Sqids, list validation.
- **Number Base Converter:** float16 and bfloat16.
- **Text Case Converter:** none needed.

### 2.29 VAT & GST Calculator: BEHIND (bug)
- **Competitor:** Zoho Invoice (free), which updates GST rates by HSN/SAC code.
- **Must fix:** the CGST/SGST split (B2).
- **Add:** an HSN/SAC rate lookup from a vendored, dated rate table, showing the table's date and the source notification, plus reverse charge.
- **Watch out:** the rate data needs periodic refreshing. Automate it with a scheduled GitHub Action that opens a PR rather than editing by hand.

### 2.30 PINT-AE Checker: CANNOT REPLACE THE PAID PROVIDERS, BY LAW
- Under UAE rules, only Accredited Service Providers may validate and exchange e-invoices and report tax data to the FTA.
- **So position the tool as a free readiness check before an ASP:**
  - Validate against the official PINT-AE rules and code lists, with the version shown
  - Explain every failure in plain English
  - Generate valid PINT-AE XML from a spreadsheet
- It needs an expert review against the official specification before any wider claims.

### 2.31 LayerLink (sharer and viewer): BEHIND
- **Competitor:** AnyDesk. Even its free personal plan includes remote access, screen sharing, a whiteboard, file transfer and chat; paid plans add unattended access, remote restart, printing and Wake-on-LAN.
- **A browser can add:** audio sharing, chat, file transfer over the WebRTC data channel, a whiteboard/annotation layer, local recording, a room password and viewer approval, several viewers, and a TURN fallback.
- **A browser cannot do:** remote control, unattended access, restart, printing or Wake-on-LAN. Say so on the page (Part 6).
- **Not tested here:** it needs live peers.

---

## Part 3: Build order

Work on branches and open one PR per phase so each can be checked in the browser preview before merging. Never push to main.

**Rules for every phase**
- Every bug gets a failing test first.
- Every new feature gets tests with messy real-world input.
- `python3 build.py --check`, all `scripts/unit/*.test.js`, `python3 scripts/test_tools.py`, `scripts/validate.py`, `scripts/audit_controls.py` and `scripts/audit_layout.py` must pass.
- No page URL changes.
- New libraries are vendored under `js/vendor/` with their licence added to `js/vendor/LICENSES.md`. No CDNs.
- Update each changed page's hero, FAQ, changelog and JSON-LD so every claim is true. Name competitors only in honest comparisons: no logos, no keyword stuffing, nothing implying affiliation.

**Phase 0: Foundations (shared by everything after it)**
- Part 4 section A: history opt-in, the shared CSV parser, lossless numbers, safe CSV export, encodings, line endings.
- New shared modules:
  - `js/engines/csv.js`
  - `js/engines/lossless-json.js`
  - `js/kernel` byte reader with encoding detection
  - a streaming file reader (`Blob.slice` + Worker)
  - a virtualised list/grid component
  - a "batch: many files / folder in, zip + CSV/HTML report out" component
  - a `js/vendor/wasm/` loader with lazy loading and offline caching
- `scripts/parity/` framework (Part 1, point 7) and a LICENSE / CONTRIBUTING.md (owner picks the licence).
- PWA: `file_handlers` in `manifest.json` for .json .csv .tsv .xml .yaml .yml .log .md .patch .diff .txt; pre-cache every tool and its WASM in `sw.js`.

**Phase 1: Diff Checker (Part 5).** It's the flagship challenger.

**Phase 2: Bug fixes for every other tool (Part 4 section B).** These are quick, and they stop wrong answers.

**Phase 3: Tools that are behind, data tools first.** Order: CSV ↔ JSON, JSON Formatter, JSON to Table, XML, YAML, Hash, Log Analyzer, SQL, Markdown, QR, Flow, Date, VAT/GST. Build everything listed for each in Part 2.

**Phase 4: Mixed tools.** Regex (multi-engine WASM, debugger), Color, Cron (dialects), Subnet (VLSM).

**Phase 5: Tools at par or ahead.** The small additions in Part 2 (2.16–2.28).

**Phase 6: LayerLink and PINT-AE.**
- LayerLink: browser-possible features, tested with real peers and a TURN fallback.
- PINT-AE: an expert check against the official rules; reposition it as a readiness check.

**Phase 7: Proof.** Turn every parity file green, then publish honest comparison pages and request indexing for the changed pages.

---

## Part 4: Accepted bug fixes for all the other tools (confirmed, test-first)

### Section A: Cross-tool fixes (these affect several tools at once)

A1. **Run history saves user data without asking.** The jwt-decoder, json-validator, regex-tester, flow and text-diff-checker pages call `Layerbit.history.push` on live runs. Pasting a JWT (a live login token) into the JWT Decoder stored it in IndexedDB with no button pressed (confirmed). The Diff Checker stored 6 copies of a typed `password=` line. A comment in `js/kernel.js` says "nothing is recorded silently", and `privacy.html` says history is kept only when "a tool offers it".
   Fix: history is OFF by default. Add a visible "Save to history on this device" switch in the shared kernel UI, remembered per tool. When it's on, save only on an explicit run, never on typing. On first save, show a toast with an Undo option. Update `privacy.html`, `about.html` and every FAQ that mentions history.

A2. **One shared, correct CSV parser.** The same bug exists in three parsers: `js/engines/diff.js` `parseCsv`, `js/engines/flow.js` `util.parseCsv`, and the page parser in `csv-to-json`. A stray quote inside a field (`1,5" screen,1.50`) makes everything after it one cell. In CSV to JSON this turned a 2-row file into 1 row, with the rest of the file inside one "desc" cell (confirmed).
   Fix: create `js/engines/csv.js` used by all tools. A quote opens quoting only at the start of a field; elsewhere it's a literal character (as Excel does). Handle CRLF and bare CR, BOM, delimiter detection that ignores delimiters inside quotes, duplicate header names (rename to `amount (2)`), and single-column files with empty values (don't drop rows). Report any rows with the wrong column count.

A3. **Lossless numbers everywhere.** Long numbers are silently rounded:
   - JSON Formatter: `12345678901234567890` becomes `12345678901234567000`, and `1e400` becomes `null`. There is a warning, but the formatted output is still changed.
   - YAML to JSON: the same rounding.
   - CSV to JSON: `00123` becomes `123`, and the long number is rounded too. This happens because "Infer types" is ON by default, even though the page's own FAQ warns about leading zeros.
   Fix: add a shared lossless JSON parse/stringify (keep the raw number text; output it untouched when formatting) and use it in json-validator, json-to-table, yaml-json-converter, csv-to-json and flow. In CSV to JSON, type inference must never convert a value with a leading zero, more than 15 significant digits, or a `+` sign. Show a per-column type preview the user can override.

A4. **Spreadsheet formula injection on CSV export.** `js/engines/json.js` `toCsv` writes `=1+1` and `@SUM(A1)` as-is (confirmed). Paid tools offer a "safe for Excel" option. Add it everywhere CSV is exported (json-validator, json-to-table, csv-to-json, subnet split, diff tables): it prefixes values starting with `= + - @ TAB CR` with `'`. Default it ON, and explain it in the FAQ.

A5. **Text encodings when files are opened.** `Layerbit.readFile` uses `readAsText` (UTF-8 only). Windows-1252 files collapse different accented letters into the same U+FFFD replacement character (confirmed in the Diff Checker).
   Fix: replace it in the kernel with byte reading: detect BOM / UTF-16, try UTF-8 with `fatal:true`, then fall back to windows-1252. Show the detected encoding with an override. Expose the raw bytes too, so tools like the Hash Generator can work on the exact file bytes.

A6. **Line endings in textareas.** Browsers turn pasted CRLF into LF. So hashing pasted text with Windows line endings gives the LF hash: "a\r\nb" gave 7e18f737… where the CRLF hash is 18745f36… (confirmed). Add an explicit "Line endings: as pasted (LF) / CRLF" option to the Hash Generator, Base64 and URL encode text modes, and point users to file mode for exact bytes.

---

### Section B: Confirmed bugs by tool (each reproduced)

B1. **Cron Generator**: the next-runs list disappears for valid expressions. `0 9 * JAN *`, `0 9 * * MON-FRI`, `0 0 ? * MON` and `0 9 * * 7` are accepted and explained correctly ("At 09:00 AM, only in January"), but the next-run list is hidden (confirmed). Only numeric forms like `0 9 * * 1-5` show runs. `updateNextRuns` doesn't map month and day names, `7` as Sunday, or `?`. Fix all of these, and also support `@yearly @annually @monthly @weekly @daily @midnight @hourly` (and `@reboot`, shown as "at boot, no schedule"). Show a clear message for anything unsupported, never a blank area.

B2. **VAT & GST Calculator**: the GST split is unequal. 18% intra-state on 100.05 gives CGST 9.01 and SGST 9.00 (confirmed). On a GST invoice the two halves are each calculated on the taxable value and must be equal. Fix: calculate CGST and SGST (or UTGST) separately as round(value × rate/2) and show the total as their sum. Show a note when this differs by a paisa from rate × value, and add an option for invoice-total rounding.

B3. **Regex Tester**: false "high" ReDoS warning. `^([a-zA-Z0-9]+\.)*[a-z]+$`, a normal domain pattern, is flagged "high: nested", but it runs in 0 ms on 5,000 characters (confirmed). Fix: don't flag a nested quantifier when every iteration of the outer group must consume a fixed delimiter the inner part can't match (like `\.` here). Keep the true positives: `^(\d+)*$` took 6.5 s on 29 characters.

B4. **YAML ↔ JSON**:
   - Multi-document YAML (`---` separators, which every Kubernetes manifest uses) is rejected with "expected a single document" (confirmed). Use `loadAll` and output a JSON array, with a "documents" switch.
   - Dates are changed: `when: 2026-01-01` becomes `"2026-01-01T00:00:00.000Z"` (confirmed). Keep dates as the original string by default (JSON_SCHEMA or a custom date type), with an option to convert.
   - Large integers: see A3.

B5. **CSV ↔ JSON**: stray quote (A2), leading zeros and long numbers (A3). Also make "Infer types" default to the safe behaviour described in A3.

B6. **JSON Formatter**: lossless output (A3). Also show `1e400` and `-0` as they were written, not as `null` and `0`.

B7. **Log Analyzer**: stack traces aren't attached to their log line. In a 6-line log with one ERROR and a 3-line Java stack trace, the summary shows ALL 6 and ERRORS 1, and the `java.lang.NullPointerException` and `at …` lines are separate, unlabelled rows (confirmed). So filtering to errors loses the stack trace. Fix: group continuation lines (lines without a timestamp, starting with whitespace / `at ` / `Caused by:` / `...`) into the preceding event. Count, filter and export events, not lines.

---

## Part 5: Diff Checker (the Beyond Compare challenger)

This is the same work as the separate Diff Checker prompt. If that's already running or merged, skip this part.

**Bugs, all confirmed with real inputs**
1. History saves every run while typing → covered by A1.
2. Non-UTF-8 files show "No differences" (Windows-1252 café vs cafè) → A5. Never call files "identical" when their bytes differ.
3. Zip compare always strips the first folder, so `src/app.js` and `lib/app.js` collide and one file disappears. Strip a top folder only when every entry shares it.
4. A stray quote mid-field swallows the CSV → A2.
5. The key column is picked by position, so reordered columns break matching. Match by header name in each file.
6. Duplicate keys are hidden (CSV, JSON arrays keyed by id, and "as sets" mode). Report them; compare as multisets.
7. Duplicate header names hide changes in the first column → A2 (unique headers).
8. JSON numbers above 2^53 compare as equal → A3.
9. Two unrelated 20k-line files froze the tab for 188 s. Run the diff in a Worker with progress/Cancel, use jsdiff's timeout or maxEditLength, and show a "too different" summary.
10. Pasting in the CSV tab doesn't refresh the key dropdown. Refresh on input.
11. "Accept all changes" doesn't equal the modified text when an ignore option is on. Unchanged rows should take the modified side.
12. Multi-file patches apply only the first file, and fuzz applies over mismatching context with just a toast. Apply per file; show mismatches and require confirmation.
13. Side-by-side view misaligns after a long wrapped line. Render each row as one element with two cells.
14. A missing final newline shows as identical, and CRLF becomes LF in merged downloads. Report both, keep the raw file text, and keep the original line endings.
15. "Ignore blank lines" still reports added blank lines. Leave blanks out of the comparison keys.
16. "Show whitespace" doesn't reveal ZWSP/NBSP/BOM/bidi marks. Render them as labelled markers.
17. Row-order CSV mode: one inserted row marks every row as changed. Align rows with an LCS first.
18. Clear doesn't reset the file inputs. Reset `input.value`.
19. A missing `</div>` in "Related guides and tools".
20. Clicking one fold expands everything, and 100k lines build 1.1M DOM nodes. Expand one fold; virtualise.

Already sound, don't rewrite: the three-way merge (20,000 random cases, no lost or wrongly restored lines; Git additionally flags edits on neighbouring lines as conflicts) and output escaping.

**Features to beat Beyond Compare ($35 Standard / $70 Pro per user)**
21. Real folders: pick or drag-and-drop folders (`webkitdirectory`, `showDirectoryPicker`, `webkitGetAsEntry`).
    - Tree view with per-folder counts, "hide identical", status filters
    - Ignore filters (.git, node_modules, bin, obj, *.log …)
    - Compare by content (SHA-256), size or date
    - Click a file to open the right comparison; "Back to folder"
    - CSV/HTML report; smooth with 20,000+ files
22. Every Excel/ODS sheet, paired by name, with per-sheet change counts. Choose displayed or raw values, and keep leading zeros and long numbers as text.
23. Tables:
    - Composite keys by name, ignore columns, trim/case/empty=null
    - Numeric tolerance (absolute or %), and date-format-insensitive comparison
    - Filter and sort results; per-column change counts
24. Hex/binary compare: side-by-side hex + ASCII, next/previous difference, jump to offset. Read by slices for files of hundreds of MB.
25. Image compare: side by side, slider, onion-skin, and pixel difference with tolerance and % changed.
26. Export for every mode: patch, HTML report, differences as CSV and .xlsx with highlighted cells, a JSON path-change list, a folder report, and hex difference ranges. Each report states the options used and the date.

---

## Part 6: What can't be local, and what to offer instead

Put this honestly on each affected page.
- **Dynamic QR codes and scan analytics:** they need a redirect server. Offer static codes that never expire and are never tracked, unlimited bulk generation, and every design option.
- **Cron monitoring (Cronitor-style):** it needs a server to receive check-ins. Offer exact schedules, dialect conversion and a printable run calendar. Optionally link to free open-source self-hosted monitors.
- **Log ingestion, alerting and retention (Datadog-style):** these need servers. Offer klogg-class local analysis of files of any size.
- **IPAM discovery and network scanning:** a web page can't scan networks. Offer planning, VLSM and overlap checks.
- **UAE e-invoice exchange:** by law, only Accredited Service Providers. Offer a free readiness check and PINT-AE XML generation.
- **LayerLink remote control and unattended access:** a web page can't control another computer. Offer screen and audio sharing, chat, file transfer, annotation and recording.
- **Cloud sync and team collaboration:** keep the "no server" promise. Offer share links where the data lives in the `#fragment` (already built), files you can export and import, and optional peer-to-peer sync over WebRTC later.
