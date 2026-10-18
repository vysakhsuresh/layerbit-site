#!/usr/bin/env python3
"""Control sweep: loads every tool with real-world input, then toggles every
checkbox, cycles every select and clicks every button, and reports controls
whose use changes nothing visible (no text, value, canvas, download,
clipboard or toast change). Those are candidates for "options that never work".

  python3 scripts/audit_controls.py --corpus DIR [--only slug ...]

DIR holds the real-world files named in INPUTS below. Read-only: nothing in the
repo is modified. Exit code is 0; the report is for a human to triage, because
some controls are legitimately no-ops for a given input."""
import argparse, hashlib, json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from test_tools import serve, launch, ROOT  # noqa
from playwright.sync_api import sync_playwright

def head(path, n):
    with open(path, encoding="utf-8", errors="replace") as f:
        return "".join(f.readline() for _ in range(n))

def INPUTS(c):
    j = lambda n: os.path.join(c, n)
    return {
        "json-validator": {"jsonInput": open(j("openapi-petstore.json")).read()},
        "text-diff-checker": {"text1": open(j("k8s-deploy.yaml")).read(),
                               "text2": open(j("k8s-deploy.yaml")).read().replace("replicas: 3", "replicas: 5").replace("nginx:1.14.2", "nginx:1.27.0").replace("  ", "    ", 2) + "\n# scaled for launch\n"},
        "regex-tester": {"regexInput": r'^(\d{1,3}(?:\.\d{1,3}){3}) - - \[([^\]]+)\] "(GET|POST|HEAD) ([^ ]+)', "testInput": head(j("nginx-access.log"), 200)},
        "jwt-decoder": {"jwtInput": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"},
        "flow": {"flowInput": open(j("react-package.json")).read()},
        "sql-formatter": {"sqlInput": open(j("sakila-schema.sql")).read()[:20000]},
        "base64": {"plainText": open(j("react-package.json")).read()},
        "url-encoder": {"plainText": "https://www.google.com/search?q=café & crème brûlée&hl=en-GB&tbm=isch#top"},
        "html-escape-unescape": {"rawInput": head(j("pom.xml"), 40)},
        "hash-generator": {"textInput": open(j("react-package.json")).read()},
        "json-to-table": {"jsonInput": open(j("gh-commits.json")).read()},
        "csv-to-json": {"csvInput": open(j("countries.csv")).read()},
        "yaml-json-converter": {"yamlInput": open(j("openapi-petstore.yaml")).read()},
        "xml-formatter": {"xmlInput": open(j("pom.xml")).read(), "xpathInput": "//dependency/artifactId"},
        "cron-generator": {"cronInput": "*/15 9-17 * * 1-5"},
        "timestamp-converter": {"tsInput": "1700000000"},
        "uuid-generator": {},
        "subnet-calculator": {"cidrInput": "10.20.0.0/22"},
        "unicode-inspector": {"textInput": head(j("unicode-sample.txt"), 120)},
        "log-analyzer": {"logInput": open(j("apache.log")).read()},
        "qr-barcode": {"dataInput": "https://layerbit.co.in/tools/qr-barcode.html?utm_source=print"},
        "pint-ae-checker": {},
    }

SNAP = r"""(ex) => {
  const main = document.querySelector('main') || document.body;
  const skip = el => el.closest('footer, .faq-section, .faq-container, .info-panel, .docs-container, .related, #lbPalette, #lbHistory, #lbShortcuts');
  let txt = '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const vals = [];
  document.querySelectorAll('textarea, input, select').forEach(e => { if (!skip(e) && e.getAttribute('data-audit') !== ex) vals.push(e.id + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)); });
  const canv = [...document.querySelectorAll('canvas')].map(c => { try { return c.width + 'x' + c.height + ':' + c.toDataURL().length; } catch (e) { return 'x'; } });
  const svgs = [...document.querySelectorAll('svg:not(.lucide)')].filter(s => !skip(s)).map(s => s.innerHTML.length);
  const body = [...document.body.children].filter(e => !e.matches('footer, script, style')).map(e => skip(e) ? '' : e.innerText).join('\n');
  return JSON.stringify([body, vals, canv, svgs, (document.getElementById('lbToast') || {}).textContent || '']);
}"""

TABS = r"""() => [...document.querySelectorAll('[role=tab], .tab-btn, .mode-tab, .mode-btn, .view-tab, .rx-tab, .tab, [data-tab], [data-mode]')]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.closest('header, footer, .faq-container, .info-panel, .docs-container, #lbPalette'); })
  .map((e, i) => { e.setAttribute('data-audit-tab', String(i)); return { k: String(i), label: (e.innerText || e.title || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40) }; })"""

LIST = r"""() => {
  const skip = el => el.closest('header, footer, .faq-section, .faq-container, .faq-item, .info-panel, .docs-container, .related, .seo-panel, #lbPalette, #lbHistory, #lbShortcuts, .cookie-consent-banner, .fab, nav');
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const out = [];
  document.querySelectorAll('button, input[type=checkbox], input[type=radio], select, [role=tab], .tab-btn, .mode-btn').forEach((e, i) => {
    if (skip(e) || !vis(e) || e.disabled) return;
    if (e.matches('[role=tab]') && e.tagName !== 'BUTTON') return;
    e.setAttribute('data-audit', String(i));
    const label = (e.getAttribute('aria-label') || e.title || e.innerText || (e.labels && e.labels[0] && e.labels[0].innerText) || e.id || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    out.push({ k: String(i), tag: e.tagName.toLowerCase(), type: e.type || '', id: e.id, label, file: /\.click\(\)/.test(e.getAttribute('onclick') || ''), opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.value) : null });
  });
  return out;
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--width", type=int, default=1280)
    a = ap.parse_args()
    inputs = INPUTS(os.path.abspath(a.corpus))
    os.chdir(ROOT)
    port = random.randint(8800, 8999); serve(port)
    slugs = [s for s in inputs if not a.only or s in a.only]
    report = {}
    with sync_playwright() as p:
        br = launch(p)
        ctx = br.new_context(viewport={"width": a.width, "height": 900}, accept_downloads=True)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        pg = ctx.new_page()
        pg.route("**/*", lambda r: r.abort() if any(h in r.request.url for h in ("googlesyndication", "googletagmanager", "google-analytics", "firebase", "gstatic", "buymeacoffee")) else r.continue_())
        events = {"dl": 0, "clip": 0, "chooser": 0, "errors": []}
        pg.on("download", lambda d: events.__setitem__("dl", events["dl"] + 1))
        pg.on("filechooser", lambda f: events.__setitem__("chooser", events["chooser"] + 1))
        pg.on("pageerror", lambda e: events["errors"].append(str(e)[:160]))
        pg.on("popup", lambda pp: pp.close())
        def prime(slug):
            pg.goto(f"http://127.0.0.1:{port}/tools/{slug}.html", wait_until="load")
            pg.evaluate("""() => { document.querySelectorAll('.cookie-consent-banner').forEach(e => e.remove());
              const w = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
              window.__clip = 0; if (navigator.clipboard) navigator.clipboard.writeText = t => { window.__clip++; return w ? w(t).catch(() => {}) : Promise.resolve(); };
              const ec = document.execCommand.bind(document); document.execCommand = (c, ...r) => { if (c === 'copy') window.__clip++; return ec(c, ...r); };
              window.print = () => { window.__clip++; }; window.open = () => { window.__clip++; return null; }; }""")
            for k, v in inputs[slug].items():
                if pg.locator("#" + k).count():
                    pg.evaluate("([k, v]) => { const e = document.getElementById(k); e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); }", [k, v])
            pg.wait_for_timeout(500)
            prim = pg.locator("[data-lb-primary]")
            if prim.count() and prim.first.is_visible():
                try: prim.first.click(timeout=2000)
                except Exception: pass
                pg.wait_for_timeout(500)
        for slug in slugs:
            events["errors"].clear()
            prime(slug)
            controls = pg.evaluate(LIST)
            inert, done = [], 0
            for c in controls:
                sel = f"[data-audit='{c['k']}']"
                try:
                    snap = lambda: pg.evaluate(SNAP, c['k'])
                    before = snap(); d0, c0, f0 = events["dl"], pg.evaluate("window.__clip"), events["chooser"]
                    changed = False
                    if c["tag"] == "select":
                        cur = pg.eval_on_selector(sel, "e => e.value")
                        for v in [o for o in c["opts"] if o != cur][:4]:
                            pg.select_option(sel, v); pg.wait_for_timeout(350)
                            if snap() != before: changed = True; break
                        pg.select_option(sel, cur); pg.wait_for_timeout(250)
                    elif c["type"] in ("checkbox", "radio"):
                        pg.click(sel, timeout=2000); pg.wait_for_timeout(400)
                        changed = snap() != before
                        if c["type"] == "checkbox": pg.click(sel, timeout=2000); pg.wait_for_timeout(250)
                    else:
                        pg.click(sel, timeout=2000); pg.wait_for_timeout(500)
                        changed = snap() != before or events["dl"] > d0 or pg.evaluate("window.__clip") > c0 or events["chooser"] > f0
                        # a button may have navigated or reset the page: start over for the next control
                        prime(slug); pg.evaluate(LIST)
                    done += 1
                    if not changed: inert.append(c)
                except Exception as e:
                    inert.append(dict(c, err=str(e).split("\n")[0][:120]))
                    try: prime(slug); pg.evaluate(LIST)
                    except Exception: pass
            # second pass: open each tab/mode and sweep the controls it reveals
            seen = {(c['id'], c['label']) for c in controls}
            prime(slug)
            tabs = pg.evaluate(TABS)
            for tab in tabs:
                try:
                    prime(slug); pg.evaluate(TABS)
                    pg.click(f"[data-audit-tab='{tab['k']}']", timeout=2000); pg.wait_for_timeout(400)
                    fresh = [c for c in pg.evaluate(LIST) if (c['id'], c['label']) not in seen]
                except Exception:
                    continue
                for c in fresh:
                    seen.add((c['id'], c['label']))
                    sel = f"[data-audit='{c['k']}']"
                    try:
                        snap = lambda: pg.evaluate(SNAP, c['k'])
                        before = snap(); d0, c0, f0 = events["dl"], pg.evaluate("window.__clip"), events["chooser"]
                        changed = False
                        if c["tag"] == "select":
                            cur = pg.eval_on_selector(sel, "e => e.value")
                            for v in [o for o in c["opts"] if o != cur][:4]:
                                pg.select_option(sel, v); pg.wait_for_timeout(350)
                                if snap() != before: changed = True; break
                        elif c["type"] in ("checkbox", "radio"):
                            pg.click(sel, timeout=2000); pg.wait_for_timeout(400); changed = snap() != before
                        else:
                            pg.click(sel, timeout=2000); pg.wait_for_timeout(500)
                            changed = snap() != before or events["dl"] > d0 or pg.evaluate("window.__clip") > c0 or events["chooser"] > f0
                        controls.append(c)
                        if not changed: inert.append(dict(c, tab=tab['label']))
                    except Exception as e:
                        inert.append(dict(c, tab=tab['label'], err=str(e).split("\n")[0][:120]))
                    # restore the tab for the next control
                    try:
                        prime(slug); pg.evaluate(TABS); pg.click(f"[data-audit-tab='{tab['k']}']", timeout=2000); pg.wait_for_timeout(300); pg.evaluate(LIST)
                    except Exception: pass
            report[slug] = {"controls": len(controls), "inert": inert, "errors": list(dict.fromkeys(events["errors"]))}
            print(f"\n## {slug}: {len(controls)} controls, {len(inert)} with no visible effect, {len(report[slug]['errors'])} page errors", flush=True)
            for c in inert:
                print(f"   - {('['+c['tab']+'] ') if c.get('tab') else ''}{c['tag']}{('['+c['type']+']') if c['type'] and c['tag']=='input' else ''} #{c['id'] or '-'} \"{c['label']}\"{'  ERR ' + c['err'] if c.get('err') else ''}")
            for e in report[slug]["errors"]: print("   ! " + e)
        br.close()
    with open(os.environ.get("AUDIT_OUT", "/dev/null"), "w") as f: json.dump(report, f, indent=1)

if __name__ == "__main__":
    main()
