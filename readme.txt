# 🚀 Layerbit — Technical Infrastructure

**Platform:** Professional Developer Utilities & Remote Access  
**Author:** Vysakh Suresh  
**Website:** [https://layerbit.co.in](https://layerbit.co.in)  

---

## ⚙️ Core Technologies
* **Frontend:** HTML5, CSS3 (Custom Glassmorphic UI), JavaScript (ES6+)
* **Iconography & Typography:** Lucide Vector Icons, Space Grotesk (Google Fonts)
* **Backend Logic:** 100% Client-side browser processing (Privacy-First Architecture)
* **Cloud Services:** Firebase Realtime Database (LayerLink screen sharing only)
* **Tool engines:** `js/engines/*.js` — diff, regex, JSON, JWT, Flow, color, number base, password and text case, each a dependency-free module that runs in the browser and under Node for unit tests (`scripts/unit/*.test.js`)
* **Kernel:** `js/kernel.js` — command palette (Ctrl+K), share links that keep input in the URL fragment, send-to between tools, local run history (IndexedDB), drop-anywhere, privacy indicator, service worker for offline use
* **Build & QA:** `build.py` composes pages from `src/`; `scripts/validate.py` checks structure, JSON-LD, inline JS, SEO and the link graph; `scripts/test_tools.py` drives every tool in headless Chromium; `scripts/audit_controls.py --corpus DIR` loads each tool with real-world files and flags any option or button that changes nothing; `scripts/audit_layout.py` checks overflow and control geometry at desktop and phone widths; `scripts/icons.py` + `scripts/apply_icons.py` hold the homepage icon set; `scripts/gen_og_images.py` renders the per-page 1200x630 share cards in `images/og/`; `scripts/gen_icons.py` renders the favicon and app icons; `scripts/build_lucide_subset.py` rebuilds `js/vendor/lucide.min.js` with only the icons in use; `scripts/gen_sitemap.py` writes `sitemap.xml` (per-page lastmod, image entries) and the `feed.xml` Atom feed; `scripts/indexnow.py` (run by `.github/workflows/indexnow.yml` after each Pages deploy) notifies Bing and other IndexNow engines of changed URLs

## 🛡️ Compliance & Standards
* **AdSense Optimized:** Yes (Fully compliant semantic HTML & routing)
* **Robots Inclusion:** Allowed (Configured for `Googlebot` & `Mediapartners-Google`)
* **SSL Encryption:** Enabled (GoDaddy Managed)
* **Data Privacy:** Zero-tracking for local payload execution and string formatting