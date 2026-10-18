#!/usr/bin/env python3
"""Builds js/vendor/lucide.min.js with only the icons the site uses.

The full Lucide bundle is ~424 KB on every page; the site uses a small
fraction of it. This scans every shipped page and script for strings that
are Lucide icon names (a superset: any quoted token or data-lucide value),
then bundles exactly those icons with Lucide's own createIcons runtime via
esbuild, exposing the same global `lucide` API the pages already call.

  python3 scripts/build_lucide_subset.py --lucide-dir PATH_TO_node_modules

Re-run after adding an icon that is not yet in the bundle; the unit check in
scripts/validate.py fails the build if a page names an icon the bundle lacks."""
import argparse, glob, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def pascal(name):
    return ''.join(p[:1].upper() + p[1:] for p in re.split(r'[-_]', name) if p)

def used_names(all_names):
    files = glob.glob(os.path.join(ROOT, 'src/pages/*.html')) + glob.glob(os.path.join(ROOT, 'src/partials/*.html')) \
        + [os.path.join(ROOT, f) for f in ('js/kernel.js', 'js/shared.js', 'main.js')] + glob.glob(os.path.join(ROOT, 'js/engines/*.js'))
    found = set()
    for f in files:
        s = open(f, encoding='utf-8').read()
        for tok in re.findall(r"[\"'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)[\"'`]", s) + re.findall(r'data-lucide="([a-z0-9-]+)"', s):
            if pascal(tok) in all_names:
                found.add(tok)
    return sorted(found)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--lucide-dir', required=True); a = ap.parse_args()
    nm = os.path.abspath(a.lucide_dir)
    names = json.loads(subprocess.check_output(['node', '-e', "const l=require('lucide');console.log(JSON.stringify(Object.keys(l.icons)))"], cwd=os.path.dirname(nm)))
    all_names = set(names)
    used = used_names(all_names)
    imports = ', '.join(sorted({pascal(n) for n in used}))
    version = json.load(open(os.path.join(nm, 'lucide/package.json')))['version']
    entry = os.path.join(os.path.dirname(nm), 'lb-entry.mjs')
    open(entry, 'w').write(
        "import { createIcons, createElement, %s } from 'lucide';\n"
        "const icons = { %s };\n"
        "window.lucide = { icons, createElement, createIcons: (opts) => createIcons(Object.assign({ icons }, opts || {})) };\n" % (imports, imports))
    out = os.path.join(ROOT, 'js/vendor/lucide.min.js')
    subprocess.check_call([os.path.join(nm, '.bin/esbuild'), entry, '--bundle', '--minify', '--format=iife', '--target=es2018',
                           '--legal-comments=none', '--banner:js=/* lucide v%s (ISC) - subset of %d icons used by layerbit.co.in, built by scripts/build_lucide_subset.py */' % (version, len(used)),
                           '--outfile=' + out], cwd=os.path.dirname(nm))
    json.dump(used, open(os.path.join(ROOT, 'js/vendor/lucide-icons.json'), 'w'), indent=0)
    print(f'{len(used)} icons, {os.path.getsize(out):,} bytes -> js/vendor/lucide.min.js')

if __name__ == '__main__':
    main()
