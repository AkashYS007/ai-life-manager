#!/usr/bin/env python3
"""Apply the app's real logo (already shipped and byte-verified in
apps/web/public/icons/, per Update 41) to the freshly-scaffolded Android
project's launcher icons. Run *after* `npx cap add android` (which is what
creates the android/ directory and its default placeholder icons in the
first place) and *before* `npx cap sync android`.

Deliberately reads the source PNG straight out of the already-checked-out
repo rather than fetching it from anywhere — apps/web/public/icons/icon-512.png
is the same file already confirmed live on production, so this can never
drift from what the web app itself shows.

Legacy `ic_launcher*.png` and the adaptive-icon `ic_launcher_foreground.png`
are both just resizes of the same full (opaque, full-bleed) source image —
not a true separated foreground/background adaptive icon with its own
transparency and parallax. That's a deliberate scope cut for this first
pass: it displays correctly on the overwhelming majority of Android
launchers (including the Pixel 10's stock launcher), just without the
foreground/background parallax effect a fully-separated adaptive icon gets.
A future pass could re-cut the mark onto a transparent layer with proper
safe-zone padding if that polish is ever wanted.
"""
import os
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.normpath(os.path.join(SCRIPT_DIR, '..', '..', 'web', 'public', 'icons', 'icon-512.png'))
RES_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'android', 'app', 'src', 'main', 'res'))

# (density, legacy ic_launcher size, adaptive foreground size)
DENSITIES = [
    ('mdpi', 48, 108),
    ('hdpi', 72, 162),
    ('xhdpi', 96, 216),
    ('xxhdpi', 144, 324),
    ('xxxhdpi', 192, 432),
]


def main():
    if not os.path.isfile(SOURCE):
        raise SystemExit(f'Source icon not found at {SOURCE}')
    if not os.path.isdir(RES_DIR):
        raise SystemExit(f'Android res/ directory not found at {RES_DIR} — run `npx cap add android` first')

    source = Image.open(SOURCE).convert('RGBA')

    for density, legacy_size, fg_size in DENSITIES:
        mipmap_dir = os.path.join(RES_DIR, f'mipmap-{density}')
        if not os.path.isdir(mipmap_dir):
            print(f'skip (no dir): {mipmap_dir}')
            continue

        legacy = source.resize((legacy_size, legacy_size), Image.LANCZOS)
        legacy.save(os.path.join(mipmap_dir, 'ic_launcher.png'))
        legacy.save(os.path.join(mipmap_dir, 'ic_launcher_round.png'))

        foreground = source.resize((fg_size, fg_size), Image.LANCZOS)
        foreground.save(os.path.join(mipmap_dir, 'ic_launcher_foreground.png'))

        print(f'{density}: legacy {legacy_size}x{legacy_size}, foreground {fg_size}x{fg_size}')

    # Brand color as the adaptive-icon background fallback (only visible at
    # the sliver where a mask exceeds the opaque foreground, which given the
    # foreground here is a full-bleed opaque image is essentially never —
    # set for correctness anyway, not left as Capacitor's generic default).
    colors_path = os.path.join(RES_DIR, 'values', 'ic_launcher_background.xml')
    with open(colors_path, 'w') as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<resources>\n'
            '    <color name="ic_launcher_background">#4C4CFF</color>\n'
            '</resources>\n'
        )
    print(f'updated {colors_path}')


if __name__ == '__main__':
    main()
