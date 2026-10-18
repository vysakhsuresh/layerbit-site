#!/usr/bin/env python3
"""Renders the favicon and app icons from the brand mark used in the site
header (stacked layers + cyan square), so every icon matches the logo people
see on the page. Outputs: favicon.ico (16/32/48), favicon-48.png,
icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png."""
import os, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
from test_tools import launch, ROOT  # noqa
from playwright.sync_api import sync_playwright

MARK = ('<polygon points="32,20 54,28 32,36 10,28" stroke="#f8fafc" stroke-width="{w}" stroke-linejoin="round" fill="none"/>'
        '<polyline points="10,38 32,46 54,38" stroke="#f8fafc" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
        '<polyline points="10,48 32,56 54,48" stroke="#f8fafc" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
        '<rect x="50" y="10" width="10" height="10" rx="2" fill="#00f2fe"/>')

def svg(size, radius, scale, stroke, full_bleed=False):
    bg = (f'<rect width="64" height="64" fill="url(#g)"/>' if full_bleed else f'<rect width="64" height="64" rx="{radius}" fill="url(#g)"/>')
    # mark spans x 8..62, y 8..58 including stroke; centre it, then scale
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 64 64">'
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1e2d"/><stop offset="1" stop-color="#0a0c10"/></linearGradient></defs>'
            + bg + f'<g transform="translate(32 32) scale({scale}) translate(-35 -33)">' + MARK.format(w=stroke) + '</g></svg>')

def main():
    out = {}
    jobs = {
        'favicon-16': (16, 12, 0.95, 6), 'favicon-32': (32, 12, 0.92, 5), 'favicon-48': (48, 12, 0.88, 4.5),
        'icon-192': (192, 14, 0.82, 4), 'icon-512': (512, 14, 0.82, 4), 'apple-touch-icon': (180, 0, 0.74, 4),
        'icon-maskable-512': (512, 0, 0.62, 4),
    }
    with sync_playwright() as p:
        br = launch(p); pg = br.new_page(device_scale_factor=1)
        for name, (size, radius, scale, stroke) in jobs.items():
            full = name in ('apple-touch-icon', 'icon-maskable-512')
            pg.set_viewport_size({"width": size, "height": size})
            pg.set_content(f'<html><body style="margin:0;background:transparent">{svg(size, radius, scale, stroke, full)}</body></html>')
            out[name] = pg.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
        br.close()
    for name in ('favicon-48', 'icon-192', 'icon-512', 'apple-touch-icon', 'icon-maskable-512'):
        open(os.path.join(ROOT, name + '.png'), 'wb').write(out[name])
    # ICO container with embedded PNG images (supported by every current browser)
    imgs = [(16, out['favicon-16']), (32, out['favicon-32']), (48, out['favicon-48'])]
    header = struct.pack('<HHH', 0, 1, len(imgs)); offset = 6 + 16 * len(imgs); entries = b''; data = b''
    for size, png in imgs:
        entries += struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(png), offset + len(data)); data += png
    open(os.path.join(ROOT, 'favicon.ico'), 'wb').write(header + entries + data)
    print('icons written:', ', '.join(sorted(out)))

if __name__ == '__main__':
    main()
