#!/usr/bin/env python3
"""Submits recently changed URLs from sitemap.xml to IndexNow (Bing, Yandex,
Seznam, Naver; Bing also feeds DuckDuckGo, Yahoo and ChatGPT search).

The key file <key>.txt sits at the site root, which is how IndexNow verifies
ownership. Run after a deploy; by default only URLs whose <lastmod> is within
the last N days are sent (IndexNow asks for changed URLs, not the whole site).

  python3 scripts/indexnow.py [--days 3] [--all] [--dry-run]"""
import argparse, glob, json, os, re, sys, urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = "layerbit.co.in"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3); ap.add_argument("--all", action="store_true"); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    keys = [os.path.basename(f)[:-4] for f in glob.glob(os.path.join(ROOT, "*.txt")) if re.fullmatch(r"[0-9a-f]{32}", os.path.basename(f)[:-4])]
    if not keys:
        sys.exit("no IndexNow key file at the site root")
    key = keys[0]
    xml = open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8").read()
    since = (date.today() - timedelta(days=a.days)).isoformat()
    urls = [loc for loc, mod in re.findall(r"<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", xml) if a.all or mod >= since]
    urls += ["https://%s/sitemap.xml" % HOST, "https://%s/feed.xml" % HOST] if urls else []
    print(f"{len(urls)} URL(s) to submit")
    if not urls or a.dry_run:
        print("\n".join(urls)); return
    body = json.dumps({"host": HOST, "key": key, "keyLocation": f"https://{HOST}/{key}.txt", "urlList": urls}).encode()
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("IndexNow:", r.status, r.reason)
    except urllib.error.HTTPError as e:
        # 202 = accepted pending key check; 403 = key not yet reachable; 422 = URLs not on host
        print("IndexNow:", e.code, e.reason, e.read()[:200])
        if e.code not in (202,):
            sys.exit(1)

if __name__ == "__main__":
    main()
