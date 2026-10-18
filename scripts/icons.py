"""Layerbit tool icon set: one 48x48 grid, 2.4px rounded strokes in the accent
blue, a soft tinted fill for the main shape, and a single cyan accent (the
logo's square) per icon. scripts/apply_icons.py writes these into the homepage
cards; tool pages reuse them in their hero badge."""

A = "#38bdf8"      # accent stroke
C = "#00f2fe"      # cyan accent (logo square)
F = "rgba(56,189,248,0.14)"  # soft fill
G = "#4ade80"; R = "#f87171"; P = "#c084fc"; K = "#fb7185"
MONO = "font-family=\"'Fira Code','JetBrains Mono',monospace\" font-weight=\"700\""

def s(*parts):
    return "".join(parts)

ICONS = {
  "flow": s(
    f'<rect x="5" y="7" width="14" height="10" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<rect x="29" y="19" width="14" height="10" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<rect x="5" y="31" width="14" height="10" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M19 12h5a5 5 0 0 1 5 5v2M29 29v2a5 5 0 0 1-5 5h-5" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    f'<circle cx="36" cy="24" r="2.6" fill="{C}"/>'),
  "json-validator": s(
    f'<path d="M16 6c-4 0-5 2-5 6v6c0 3-2 5-5 6 3 1 5 3 5 6v6c0 4 1 6 5 6M32 6c4 0 5 2 5 6v6c0 3 2 5 5 6-3 1-5 3-5 6v6c0 4-1 6-5 6" stroke="{A}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<path d="M18.5 24.5l4 4 7.5-8.5" stroke="{C}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  "sql-formatter": s(
    f'<ellipse cx="22" cy="10" rx="14" ry="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M8 10v24c0 2.8 6.3 5 14 5M36 10v9M8 22c0 2.8 6.3 5 14 5" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    f'<path d="M28 27h14M32 33h10M28 39h14" stroke="{C}" stroke-width="2.6" stroke-linecap="round"/>'),
  "jwt-decoder": s(
    f'<rect x="4" y="14" width="40" height="20" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M10 24h6" stroke="{K}" stroke-width="3" stroke-linecap="round"/><path d="M21 24h6" stroke="{P}" stroke-width="3" stroke-linecap="round"/><path d="M32 24h6" stroke="{C}" stroke-width="3" stroke-linecap="round"/>',
    f'<circle cx="18.5" cy="24" r="1.4" fill="{A}"/><circle cx="29.5" cy="24" r="1.4" fill="{A}"/>'),
  "qr-barcode": s(
    f'<rect x="6" y="6" width="14" height="14" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/><rect x="28" y="6" width="14" height="14" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/><rect x="6" y="28" width="14" height="14" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<rect x="11" y="11" width="4" height="4" rx="1" fill="{A}"/><rect x="33" y="11" width="4" height="4" rx="1" fill="{A}"/><rect x="11" y="33" width="4" height="4" rx="1" fill="{A}"/>',
    f'<path d="M28 28h5v5M38 28h4M28 38v4M33 38h4v4M42 33v4" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/><rect x="34" y="33" width="4" height="4" rx="1" fill="{C}"/>'),
  "base64": s(
    f'<rect x="5" y="9" width="38" height="30" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<text x="24" y="30" text-anchor="middle" font-size="15" {MONO} fill="{A}">64</text>',
    f'<path d="M11 15h4M11 34h4M33 15h4M33 34h4" stroke="{C}" stroke-width="2.4" stroke-linecap="round"/>'),
  "json-to-table": s(
    f'<rect x="5" y="8" width="38" height="32" rx="5" fill="none" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M5 13a5 5 0 0 1 5-5h28a5 5 0 0 1 5 5v4H5z" fill="{F}"/>',
    f'<path d="M5 17h38M5 25.5h38M5 33h38M18 17v23M31 17v23" stroke="{A}" stroke-width="2" stroke-linecap="round"/>',
    f'<rect x="21" y="28.3" width="7" height="2.2" rx="1" fill="{C}"/>'),
  "text-diff-checker": s(
    f'<rect x="4" y="7" width="18" height="34" rx="4" fill="{F}" stroke="{A}" stroke-width="2.4"/><rect x="26" y="7" width="18" height="34" rx="4" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M9 15h8M9 27h8M31 15h8M31 33h8" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/>',
    f'<path d="M9 21h8" stroke="{R}" stroke-width="2.6" stroke-linecap="round"/><path d="M31 21h8M35 17v8M31 27h8" stroke="{G}" stroke-width="2.6" stroke-linecap="round"/>'),
  "csv-to-json": s(
    f'<path d="M7 6h14l6 6v26a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="{F}" stroke="{A}" stroke-width="2.4" stroke-linejoin="round"/>',
    f'<path d="M8 20h3M14 20h3M8 27h3M14 27h3M8 34h3M14 34h3" stroke="{A}" stroke-width="2.4" stroke-linecap="round"/>',
    f'<path d="M30 24h8m-3-3.5 3.5 3.5-3.5 3.5" stroke="{C}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<path d="M41 15c2 0 3 1 3 3v3c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3v3c0 2-1 3-3 3" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/>'),
  "yaml-json-converter": s(
    f'<text x="5" y="22" font-size="14" {MONO} fill="{A}">Y:</text>',
    f'<text x="25" y="42" font-size="14" {MONO} fill="{A}">{{}}</text>',
    f'<path d="M30 8h6a6 6 0 0 1 6 6v4m0 0-3.5-3.5M42 18l3.5-3.5M18 40h-6a6 6 0 0 1-6-6v-4m0 0 3.5 3.5M6 30l-3.5 3.5" stroke="{C}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  "cron-generator": s(
    f'<circle cx="22" cy="25" r="16" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M22 15v10l6 4" stroke="{A}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<path d="M38 6v7h-7" stroke="{C}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M38 13a18 18 0 0 0-8-6" stroke="{C}" stroke-width="2.6" stroke-linecap="round" fill="none"/>'),
  "url-encoder": s(
    f'<path d="M18 26l8-8M15 20l-4 4a6 6 0 0 0 8.5 8.5l4-4M29 24l4-4A6 6 0 0 0 24.5 11.5l-4 4" stroke="{A}" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
    f'<circle cx="37" cy="37" r="8" fill="{F}" stroke="{C}" stroke-width="2.2"/>',
    f'<text x="37" y="41" text-anchor="middle" font-size="10.5" {MONO} fill="{C}">%</text>'),
  "log-analyzer": s(
    f'<rect x="4" y="7" width="34" height="28" rx="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M10 15l4 3-4 3M17 21h7M10 28h13" stroke="{A}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<circle cx="35" cy="34" r="6" fill="#0a0c10" stroke="{C}" stroke-width="2.6"/><path d="M39.5 38.5 44 43" stroke="{C}" stroke-width="2.8" stroke-linecap="round"/>'),
  "regex-tester": s(
    f'<path d="M12 8c-4 4-6 10-6 16s2 12 6 16M36 8c4 4 6 10 6 16s-2 12-6 16" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    f'<circle cx="17" cy="32" r="3" fill="{C}"/>',
    f'<path d="M30 14v14M24 17.5l12 7M36 17.5l-12 7" stroke="{A}" stroke-width="2.6" stroke-linecap="round"/>'),
  "html-escape-unescape": s(
    f'<path d="M15 14 5 24l10 10M33 14l10 10-10 10" stroke="{A}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<text x="24" y="31" text-anchor="middle" font-size="17" {MONO} fill="{C}">&amp;</text>'),
  "subnet-calculator": s(
    f'<rect x="17" y="4" width="14" height="10" rx="3" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M24 14v6M10 20h28M10 20v6M38 20v6M24 20v6" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    f'<rect x="4" y="26" width="12" height="9" rx="2.5" fill="{F}" stroke="{A}" stroke-width="2.2"/><rect x="18" y="26" width="12" height="9" rx="2.5" fill="{F}" stroke="{C}" stroke-width="2.2"/><rect x="32" y="26" width="12" height="9" rx="2.5" fill="{F}" stroke="{A}" stroke-width="2.2"/>',
    f'<text x="24" y="45" text-anchor="middle" font-size="7.5" {MONO} fill="{A}">/24</text>'),
  "hash-generator": s(
    f'<path d="M24 4 40 10v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" fill="{F}" stroke="{A}" stroke-width="2.4" stroke-linejoin="round"/>',
    f'<path d="M20 15l-2 16M28 15l-2 16M15 20h16M14 26h16" stroke="{C}" stroke-width="2.4" stroke-linecap="round"/>'),
  "uuid-generator": s(
    f'<rect x="4" y="10" width="40" height="28" rx="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<circle cx="15" cy="21" r="4" fill="none" stroke="{A}" stroke-width="2.2"/><path d="M9 32c1-3.5 3.3-5 6-5s5 1.5 6 5" stroke="{A}" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    f'<path d="M26 19h12M26 25h8M26 31h12" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/><rect x="35" y="23.8" width="4" height="2.4" rx="1" fill="{C}"/>'),
  "timestamp-converter": s(
    f'<rect x="4" y="8" width="30" height="30" rx="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M4 16h30M12 4v7M26 4v7" stroke="{A}" stroke-width="2.4" stroke-linecap="round"/>',
    f'<circle cx="34" cy="34" r="10" fill="#0a0c10" stroke="{C}" stroke-width="2.4"/><path d="M34 29v5.5l3.5 2" stroke="{C}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  "xml-formatter": s(
    f'<path d="M14 9 5 18l9 9M34 9l9 9-9 9M27 6l-6 24" stroke="{A}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<path d="M24 32v4M14 40v-4h20v4" stroke="{A}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<circle cx="14" cy="42" r="2.4" fill="{C}"/><circle cx="34" cy="42" r="2.4" fill="{A}"/>'),
  "unicode-inspector": s(
    f'<rect x="4" y="6" width="40" height="36" rx="7" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<text x="24" y="28" text-anchor="middle" font-size="14" {MONO} fill="{A}">U+</text>',
    f'<path d="M12 35h24" stroke="{C}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 4"/>'),
  "pint-ae-checker": s(
    f'<path d="M9 4h22l8 8v28a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="{F}" stroke="{A}" stroke-width="2.4" stroke-linejoin="round"/>',
    f'<path d="M12 15h12M12 21h18M12 27h10" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/>',
    f'<circle cx="33" cy="34" r="8" fill="#0a0c10" stroke="{C}" stroke-width="2.4"/><path d="m29.5 34 2.5 2.5 4.5-5" stroke="{C}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  # new tools
  "password-generator": s(
    f'<rect x="7" y="20" width="34" height="22" rx="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M14 20v-5a10 10 0 0 1 20 0v5" stroke="{A}" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    f'<path d="M15 31h.01M21 31h.01M27 31h.01" stroke="{A}" stroke-width="4" stroke-linecap="round"/><path d="M32 31h4" stroke="{C}" stroke-width="3" stroke-linecap="round"/>'),
  "color-converter": s(
    f'<circle cx="24" cy="24" r="18" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M24 6a18 18 0 0 1 0 36z" fill="{A}" opacity="0.85"/>',
    f'<text x="15.5" y="28.5" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" font-weight="700" fill="{A}">A</text><text x="32.5" y="28.5" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" font-weight="700" fill="#0a0c10">A</text>',
    f'<circle cx="38" cy="9" r="3.2" fill="{C}"/>'),
  "number-base-converter": s(
    f'<rect x="4" y="8" width="40" height="32" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<text x="24" y="22" text-anchor="middle" font-size="10" {MONO} fill="{A}">0x2A</text>',
    f'<text x="24" y="34" text-anchor="middle" font-size="8.5" {MONO} fill="{C}">101010</text>'),
  "text-case-converter": s(
    f'<text x="4" y="32" font-size="22" font-family="Georgia,serif" font-weight="700" fill="{A}">A</text>',
    f'<text x="21" y="32" font-size="17" font-family="Georgia,serif" font-weight="700" fill="{C}">a</text>',
    f'<path d="M34 12h10M34 19h10M34 26h6M4 40h40" stroke="{A}" stroke-width="2.4" stroke-linecap="round"/>'),
  "markdown-preview": s(
    f'<rect x="3" y="10" width="42" height="28" rx="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M10 31V17l5.5 6.5L21 17v14" stroke="{A}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<path d="M33 17v13m-5-5 5 5 5-5" stroke="{C}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  # services
  "api-automation": s(
    f'<circle cx="10" cy="24" r="5" fill="{F}" stroke="{A}" stroke-width="2.4"/><circle cx="38" cy="10" r="5" fill="{F}" stroke="{A}" stroke-width="2.4"/><circle cx="38" cy="38" r="5" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M15 22l18-10M15 26l18 10" stroke="{A}" stroke-width="2.4" stroke-linecap="round"/>',
    f'<path d="M22 21l3-4h-4l3-4" stroke="{C}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  "custom-scripts": s(
    f'<rect x="4" y="8" width="40" height="32" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M4 15h40" stroke="{A}" stroke-width="2"/><path d="M12 23l5 4-5 4" stroke="{A}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    f'<path d="M21 31h10" stroke="{C}" stroke-width="2.6" stroke-linecap="round"/>'),
  "static-sites": s(
    f'<rect x="4" y="7" width="40" height="34" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M4 15h40" stroke="{A}" stroke-width="2"/><circle cx="9.5" cy="11" r="1.4" fill="{A}"/><circle cx="14" cy="11" r="1.4" fill="{A}"/>',
    f'<path d="M11 23h14M11 29h10M11 35h12" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/><path d="M36 21l-3 7h5l-3 7" stroke="{C}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  "erp-development": s(
    f'<rect x="5" y="5" width="16" height="16" rx="4" fill="{F}" stroke="{A}" stroke-width="2.4"/><rect x="27" y="5" width="16" height="16" rx="4" fill="{F}" stroke="{A}" stroke-width="2.4"/><rect x="5" y="27" width="16" height="16" rx="4" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<rect x="27" y="27" width="16" height="16" rx="4" fill="none" stroke="{C}" stroke-width="2.4" stroke-dasharray="4 3"/><path d="M35 31v8M31 35h8" stroke="{C}" stroke-width="2.4" stroke-linecap="round"/>'),
  "app-development": s(
    f'<rect x="13" y="3" width="22" height="42" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<path d="M21 8h6" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/><rect x="18" y="14" width="5" height="5" rx="1.5" fill="{A}"/><rect x="25" y="14" width="5" height="5" rx="1.5" fill="{A}"/><rect x="18" y="21" width="5" height="5" rx="1.5" fill="{A}"/><rect x="25" y="21" width="5" height="5" rx="1.5" fill="{C}"/>',
    f'<path d="M21 39h6" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/>'),
  "portfolio-design": s(
    f'<rect x="4" y="6" width="40" height="36" rx="6" fill="{F}" stroke="{A}" stroke-width="2.4"/>',
    f'<circle cx="16" cy="18" r="5" fill="none" stroke="{A}" stroke-width="2.2"/><path d="M8 34c1.5-5 4.5-7 8-7s6.5 2 8 7" stroke="{A}" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    f'<path d="M29 15h9M29 22h9M29 29h6" stroke="{A}" stroke-width="2.2" stroke-linecap="round"/><circle cx="37" cy="34" r="2.6" fill="{C}"/>'),
}

def svg(slug, size=40):
    return (f'<svg class="lb-icon" width="{size}" height="{size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            + ICONS[slug] + '</svg>')
