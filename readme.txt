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
* **Tool engines:** `js/engines/*.js` — diff, regex, JSON, JWT and Flow, each a dependency-free module that runs in the browser and under Node for unit tests (`scripts/unit/*.test.js`)
* **Kernel:** `js/kernel.js` — command palette (Ctrl+K), share links that keep input in the URL fragment, send-to between tools, local run history (IndexedDB), drop-anywhere, privacy indicator, service worker for offline use
* **Build & QA:** `build.py` composes pages from `src/`; `scripts/validate.py` checks structure, JSON-LD, inline JS, SEO and the link graph; `scripts/test_tools.py` drives every tool in headless Chromium

## 🛡️ Compliance & Standards
* **AdSense Optimized:** Yes (Fully compliant semantic HTML & routing)
* **Robots Inclusion:** Allowed (Configured for `Googlebot` & `Mediapartners-Google`)
* **SSL Encryption:** Enabled (GoDaddy Managed)
* **Data Privacy:** Zero-tracking for local payload execution and string formatting