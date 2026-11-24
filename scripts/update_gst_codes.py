#!/usr/bin/env python3
"""Rebuild js/vendor/gst/hsn-sac.json, the HSN and SAC code list the VAT & GST
calculator searches, from the npm package hsn-code-package (ISC).

Only codes and descriptions are taken. The package's GST rates are chapter-wide
and still list the 12% and 28% slabs that ended on 22 September 2025, so they
are not shipped. Codes that lost their leading zero (chapters 01-09) get it back.

Usage: python3 scripts/update_gst_codes.py [--version X.Y.Z]   (needs npm)
The scheduled workflow .github/workflows/gst-data.yml runs this monthly and
opens a pull request when the list changes.
"""
import json, os, re, subprocess, sys, tarfile, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "js", "vendor", "gst", "hsn-sac.json")
PKG = "hsn-code-package"


def main():
    ver = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else \
        subprocess.check_output(["npm", "view", PKG, "version"], text=True).strip()
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.check_call(["npm", "pack", f"{PKG}@{ver}", "--silent"], cwd=tmp, stdout=subprocess.DEVNULL)
        tgz = [f for f in os.listdir(tmp) if f.endswith(".tgz")][0]
        with tarfile.open(os.path.join(tmp, tgz)) as t:
            def read(name):
                return json.load(t.extractfile(f"package/data/{name}"))
            meta, hsn, sac = read("metadata.json"), read("hsn_codes.json"), read("sac_codes.json")
    clean = lambda s: re.sub(r"\s+", " ", str(s)).strip()
    fix = lambda c: c.zfill(8) if len(c) == 7 and c.isdigit() else c
    data = {
        "source": f"{PKG} {ver} (ISC), from the CBIC / WCO Harmonized System Nomenclature",
        "package": PKG, "version": ver, "listUpdated": meta.get("lastUpdated", ""),
        "note": "Codes and descriptions only. GST rates are not included: check the rate schedules (Notification No. 9/2025-Central Tax (Rate) for goods, from 22 September 2025).",
        "hsn": sorted([[fix(x["code"]), clean(x["description"])] for x in hsn]),
        "sac": sorted([[x["code"], clean(x["description"])] for x in sac]),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    new = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    if new != old:
        open(OUT, "w", encoding="utf-8").write(new)
        print(f"updated {OUT}: {len(data['hsn'])} HSN and {len(data['sac'])} SAC codes from {PKG} {ver}")
    else:
        print("no change")


if __name__ == "__main__":
    main()
