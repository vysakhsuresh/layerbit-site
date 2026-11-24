# Layerbit roadmap

Goal: every feature people pay for in developer tools, free, local and open
source, with each claim backed by an automated test. The full plan, with the
competitor comparison for every tool and every confirmed bug, is
[docs/REVAMP_PLAN.md](docs/REVAMP_PLAN.md).

Each phase ships as one pull request, reviewed in the browser preview before
the next phase starts.

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations: opt-in history, one CSV parser, lossless numbers, safe CSV export, encoding-aware file reading, line-ending options, shared streaming/virtual-list/batch/WASM modules, the parity framework, licence, PWA file handlers and offline cache | Done |
| 1 | Diff Checker: 20 bug fixes; folders, every workbook sheet, table options, hex, images, exports | Done (v4.0.0) |
| 2 | Confirmed bugs in every other tool (Cron, VAT & GST, Regex, YAML, CSV, JSON, Log Analyzer) | Done |
| 3 | Tools that are behind, data tools first: CSV ↔ JSON, JSON Formatter, JSON to Table, XML, YAML, Hash, Log Analyzer, SQL, Markdown, QR, Flow, Date, VAT & GST | Done |
| 4 | Mixed tools: Regex (other engines via WebAssembly, debugger), Color, Cron dialects, Subnet VLSM | Done |
| 5 | Small additions to tools already at par or ahead | Done |
| 6 | LayerLink (browser-possible features) and PINT-AE (readiness check) | Done. LayerLink still needs a check between two real networks through the TURN relay; the PINT-AE rules still need an expert review |
| 7 | Proof: every parity file green, then honest comparison pages | Done: parity is checked in CI with real browser results, and [compare.html](https://layerbit.co.in/compare.html) is generated from the green parity files |

## What will never be local

Some features need a server or OS-level access: dynamic QR codes with scan
analytics, cron job monitoring, log ingestion and alerting, network discovery,
UAE e-invoice exchange (by law, accredited providers only), remote control and
unattended access, and cloud sync. The affected pages say so and offer the
local alternative described in the plan.
