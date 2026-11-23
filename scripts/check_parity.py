#!/usr/bin/env python3
"""Parity check: every competitor feature a page claims must be backed by a
test that exists and passes.

Each scripts/parity/<slug>.json lists the claims for one tool:

  {"tool": "text-diff-checker", "page": "tools/text-diff-checker.html",
   "competitors": [{"name": "...", "source": "...", "checked": "2026-11"}],
   "claims": [{"feature": "...", "competitor": "...",
               "tests": ["ui:<slug>:<case name>", "unit:<file>:<test name>"]}]}

A claim fails when it has no tests, when a referenced test does not exist,
or when it did not pass:
  - unit tests are run here (node scripts/unit/<file>.test.js) and a test
    printed as FAIL fails its claims;
  - browser tests need the results of a run: pass --ui-results PATH, written
    by `scripts/test_tools.py --json PATH`. Without it they are only checked
    for existence, which is what the build-check job (no browser) does.

  python3 scripts/check_parity.py [--ui-results results.json] [--self-test]

Exit code 1 when any claim fails. Comparison pages are published only when
every parity file for the tools they compare is green.
"""
import argparse, glob, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ui_cases(test_tools_path):
    text = open(test_tools_path, encoding="utf-8").read()
    return {(slug, name) for slug, name in re.findall(r'@case\("([^"]+)",\s*"[^"]+",\s*"((?:[^"\\]|\\.)*)"\)', text)}


def unit_names(unit_dir):
    out = {}
    for path in glob.glob(os.path.join(unit_dir, "*.test.js")):
        stem = os.path.basename(path)[:-len(".test.js")]
        text = open(path, encoding="utf-8").read()
        out[stem] = set(re.findall(r"\bt\('((?:[^'\\]|\\.)*)'", text)) | set(re.findall(r'\bt\("((?:[^"\\]|\\.)*)"', text))
    return out


def unit_failures(unit_dir, stems):
    failed = {}
    for stem in stems:
        path = os.path.join(unit_dir, stem + ".test.js")
        r = subprocess.run(["node", path], capture_output=True, text=True, cwd=ROOT)
        names = set(m.strip() for m in re.findall(r"^FAIL (.+?)\s*$", r.stdout + r.stderr, re.M))
        failed[stem] = (names, r.returncode)
    return failed


def check(parity_dir, test_tools_path, unit_dir, ui_results=None):
    """Returns (report lines, number of failing claims)."""
    cases, units = ui_cases(test_tools_path), unit_names(unit_dir)
    files = sorted(glob.glob(os.path.join(parity_dir, "*.json")))
    referenced_units = set()
    docs = []
    for f in files:
        doc = json.load(open(f, encoding="utf-8"))
        docs.append((f, doc))
        for c in doc.get("claims", []):
            for ref in c.get("tests", []):
                if ref.startswith("unit:"):
                    referenced_units.add(ref.split(":", 2)[1])
    ufail = unit_failures(unit_dir, sorted(s for s in referenced_units if s in units))
    ui = None
    if ui_results:
        ui = {(r["slug"], r["name"]): r["ok"] for r in json.load(open(ui_results, encoding="utf-8"))}
    lines, bad = [], 0
    for f, doc in docs:
        lines.append(f"{os.path.relpath(f, ROOT)}: {doc.get('tool')}")
        for c in doc.get("claims", []):
            problems = []
            if not c.get("tests"):
                problems.append("no test backs this claim")
            for ref in c.get("tests", []):
                kind, _, rest = ref.partition(":")
                if kind == "ui":
                    slug, _, name = rest.partition(":")
                    if (slug, name) not in cases:
                        problems.append(f"missing browser test: {ref}")
                    elif ui is not None and ui.get((slug, name)) is not True:
                        problems.append(f"browser test did not pass: {ref}")
                elif kind == "unit":
                    stem, _, name = rest.partition(":")
                    if name not in units.get(stem, set()):
                        problems.append(f"missing unit test: {ref}")
                    elif name in ufail.get(stem, (set(), 0))[0]:
                        problems.append(f"unit test failed: {ref}")
                else:
                    problems.append(f"unknown test reference (use ui: or unit:): {ref}")
            mark = "FAIL" if problems else "ok  "
            lines.append(f"  {mark} {c.get('feature')} (vs {c.get('competitor', '?')})")
            lines.extend("       - " + p for p in problems)
            bad += bool(problems)
    if ui is None:
        lines.append("(browser tests checked for existence only; pass --ui-results to require that they passed)")
    return lines, bad


def self_test():
    """The checker must reject: a claim with no tests, a missing test, a
    failing unit test, and a browser test that did not pass."""
    with tempfile.TemporaryDirectory() as d:
        unit = os.path.join(d, "unit"); par = os.path.join(d, "parity"); os.makedirs(unit); os.makedirs(par)
        open(os.path.join(unit, "demo.test.js"), "w").write(
            "function t(n, f) { try { f(); } catch (e) { console.error('FAIL ' + n); process.exitCode = 1; } }\n"
            "t('works', () => {});\nt('broken', () => { throw new Error('x'); });\n")
        tt = os.path.join(d, "test_tools.py")
        open(tt, "w").write('@case("demo", "typical", "ui works")\ndef _(t): pass\n@case("demo", "edge", "ui broken")\ndef _(t): pass\n')
        json.dump({"tool": "demo", "claims": [
            {"feature": "good", "tests": ["unit:demo:works", "ui:demo:ui works"]},
            {"feature": "untested", "tests": []},
            {"feature": "missing", "tests": ["unit:demo:nope"]},
            {"feature": "failing unit", "tests": ["unit:demo:broken"]},
            {"feature": "failing ui", "tests": ["ui:demo:ui broken"]}]}, open(os.path.join(par, "demo.json"), "w"))
        res = os.path.join(d, "ui.json")
        json.dump([{"slug": "demo", "name": "ui works", "ok": True}, {"slug": "demo", "name": "ui broken", "ok": False}], open(res, "w"))
        lines, bad = check(par, tt, unit, res)
        text = "\n".join(lines)
        ok = bad == 4 and "ok   good" in text and "no test backs" in text and "missing unit test" in text and "unit test failed" in text and "browser test did not pass" in text
        print(text)
        print("self-test:", "passed" if ok else "FAILED")
        return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui-results", help="JSON written by scripts/test_tools.py --json")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    lines, bad = check(os.path.join(ROOT, "scripts", "parity"), os.path.join(ROOT, "scripts", "test_tools.py"), os.path.join(ROOT, "scripts", "unit"), a.ui_results)
    print("\n".join(lines))
    print(f"\nparity: {'all claims backed by passing tests' if not bad else str(bad) + ' claim(s) failing'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
