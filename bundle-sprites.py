#!/usr/bin/env python3
"""Download the 151 Kanto sprites and write them out as base64 data URIs.

The pack opener draws each card face to a 2D canvas that THREE uploads as a
WebGL texture, so every sprite must be CORS-clean or the upload throws
SecurityError. Bundling sidesteps the question entirely: a data: URI never
taints the canvas and needs no network at runtime.

Animated sets (showdown, bw) are GIFs, and a canvas only ever draws the first
frame of a GIF. So their frames are decoded here and packed into a single PNG
sprite sheet; the page steps through it from animate(). Frame delays are
preserved, consecutive duplicate frames are merged, and every frame is cropped
to the union of their non-transparent bounds.

    python3 bundle-sprites.py                       # animated showdown sprites
    python3 bundle-sprites.py --set gen1            # static Red/Blue sprites
    python3 bundle-sprites.py --inline kanto-pack-opener.html

--inline additionally writes a single self-contained HTML file with the sprite
data spliced in, so the result works from file:// with no sibling assets.

Sprites come from https://github.com/PokeAPI/sprites.
"""

import argparse
import base64
import concurrent.futures as futures
import io
import json
import math
import pathlib
import re
import sys
import urllib.error
import urllib.request

COUNT = 151

# Keyed by National Dex number, so no per-name filename mapping is needed for
# Nidoran-f/m, Farfetch'd or Mr. Mime.
SETS = {
    "showdown":  ("sprites/pokemon/other/showdown/{id}.gif", True),
    "bw":        ("sprites/pokemon/versions/generation-v/black-white/animated/{id}.gif", True),
    "gen1":      ("sprites/pokemon/versions/generation-i/red-blue/transparent/{id}.png", False),
    "default":   ("sprites/pokemon/{id}.png", False),
    "home":      ("sprites/pokemon/other/home/{id}.png", False),
}

# jsdelivr first: the page already loads three.js from it, so it is known
# reachable wherever the opener runs.
HOSTS = (
    "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/{path}",
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/{path}",
    "https://cdn.statically.io/gh/PokeAPI/sprites/master/{path}",
)

# Matches the sprites-data.js tag whether or not it is still commented out.
MARKER = re.compile(r'(?:<!--\s*)?<script src="sprites-data\.js"></script>(?:\s*-->)?')


def fetch(dex_id, template, timeout):
    """Return raw bytes for one dex number, trying each host in turn."""
    path = template.format(id=dex_id)
    last = None
    for host in HOSTS:
        url = host.format(path=path)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "bundle-sprites/2.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            if not data[:4] in (b"\x89PNG", b"GIF8"):
                last = f"{url}: not a PNG/GIF ({len(data)} bytes)"
                continue
            return dex_id, data, None
        except (urllib.error.URLError, OSError) as exc:  # includes timeouts
            last = f"{url}: {exc}"
    return dex_id, None, last


def to_sheet(data, max_frames):
    """Decode an animated GIF into a PNG sprite sheet plus its frame timing."""
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(data))
    frames, delays = [], []
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)                      # sequential seek lets Pillow apply disposal
        frames.append(im.convert("RGBA"))
        delays.append(int(im.info.get("duration") or 100))

    # Crop every frame to the union of their non-transparent bounds. Showdown
    # GIFs carry a lot of empty margin, and the sheet is mostly that margin.
    box = None
    for f in frames:
        b = f.getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]),
                                         max(box[2], b[2]), max(box[3], b[3]))
    if box:
        frames = [f.crop(box) for f in frames]

    # Merge consecutive identical frames into one longer-held frame.
    kept, kept_delays = [], []
    for f, d in zip(frames, delays):
        if kept and f.tobytes() == kept[-1].tobytes():
            kept_delays[-1] += d
        else:
            kept.append(f)
            kept_delays.append(d)

    # Sample evenly if still over budget, holding total loop duration steady.
    if len(kept) > max_frames:
        total = sum(kept_delays)
        idx = [round(k * len(kept) / max_frames) for k in range(max_frames)]
        kept = [kept[min(i, len(kept) - 1)] for i in idx]
        kept_delays = [round(total / max_frames)] * max_frames

    fw, fh = kept[0].size
    n = len(kept)
    cols = max(1, min(n, max(1, 2048 // max(fw, 1))))
    rows = math.ceil(n / cols)
    sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for k, f in enumerate(kept):
        sheet.paste(f, ((k % cols) * fw, (k // cols) * fh))

    # GIF transparency is 1-bit, so a palette PNG round-trips it exactly and
    # costs roughly half what RGBA does. Quantize to 255 colours and reserve
    # the last palette slot for "transparent".
    #
    # Note: no optimize=True here. It re-packs the palette down to the colours
    # actually drawn, which renumbers the reserved slot and silently rewrites
    # tRNS to a fully-opaque table -- every sprite ends up on a black box.
    alpha = sheet.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    pal = sheet.convert("RGB").quantize(colors=255)
    table = list(pal.getpalette() or [])
    table = (table + [0] * (255 * 3 - len(table)))[:255 * 3] + [0, 0, 0]
    pal.putpalette(table)
    pal.paste(255, mask=ImageOps.invert(alpha))
    buf = io.BytesIO()
    pal.save(buf, "PNG", transparency=255)
    return buf.getvalue(), {"fw": fw, "fh": fh, "n": n, "cols": cols, "d": kept_delays}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--set", dest="art", default="showdown", choices=sorted(SETS),
                    help="which sprite set to bundle (default: showdown, animated)")
    ap.add_argument("--gen1", action="store_const", const="gen1", dest="art",
                    help="alias for --set gen1")
    ap.add_argument("--max-frames", type=int, default=30,
                    help="frame budget per animation (default: 30)")
    ap.add_argument("--out", default="sprites-data.js", help="output JS file")
    ap.add_argument("--inline", metavar="HTML",
                    help="also write a self-contained copy of this HTML file")
    ap.add_argument("--workers", type=int, default=12, help="parallel downloads")
    ap.add_argument("--timeout", type=float, default=30.0, help="per-request timeout")
    args = ap.parse_args()

    template, animated = SETS[args.art]
    if animated:
        try:
            import PIL  # noqa: F401
        except ImportError:
            print("error: the animated sets need Pillow (pip install Pillow)", file=sys.stderr)
            return 1

    print(f"Fetching {COUNT} sprites from {args.art} ...", file=sys.stderr)
    sprites, failures = {}, []
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = [pool.submit(fetch, i, template, args.timeout) for i in range(1, COUNT + 1)]
        for done, job in enumerate(futures.as_completed(jobs), 1):
            dex_id, data, err = job.result()
            if data is None:
                failures.append(f"#{dex_id} {err}")
            else:
                try:
                    if animated:
                        png, meta = to_sheet(data, args.max_frames)
                        meta["src"] = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
                        sprites[dex_id] = meta
                    else:
                        sprites[dex_id] = ("data:image/png;base64,"
                                           + base64.b64encode(data).decode("ascii"))
                except Exception as exc:                      # a single bad GIF
                    failures.append(f"#{dex_id} decode failed: {exc}")
            if done % 25 == 0 or done == COUNT:
                print(f"  {done}/{COUNT}", file=sys.stderr)

    if failures:
        print(f"\n{len(failures)} sprite(s) failed:", file=sys.stderr)
        for line in failures:
            print("  " + line, file=sys.stderr)
        if not sprites:
            return 1

    payload = json.dumps({str(k): sprites[k] for k in sorted(sprites)},
                         separators=(",", ":"))
    kind = "animated sprite sheets" if animated else "stills"
    js = ("// Generated by bundle-sprites.py -- do not edit.\n"
          f"// {len(sprites)}/{COUNT} Kanto sprites from the '{args.art}' set as {kind}.\n"
          "// Art from https://github.com/PokeAPI/sprites\n"
          f"window.SPRITE_DATA = {payload};\n")

    out = pathlib.Path(args.out)
    out.write_text(js, encoding="utf-8")
    if animated:
        frames = sum(s["n"] for s in sprites.values())
        print(f"\nWrote {out} ({len(sprites)} sheets, {frames} frames, "
              f"{len(js)/1e6:.1f} MB)", file=sys.stderr)
    else:
        print(f"\nWrote {out} ({len(sprites)} sprites, {len(js)/1024:.0f} KB)", file=sys.stderr)

    if args.inline:
        src = pathlib.Path(args.inline)
        html = src.read_text(encoding="utf-8")
        if not MARKER.search(html):
            print(f'error: no <script src="sprites-data.js"> tag found in {src}',
                  file=sys.stderr)
            return 1
        # An inline <script> cannot contain the literal "</script>"; the data
        # is pure base64 so this is belt-and-braces.
        tag = "<script>\n" + js.replace("</", "<\\/") + "</script>"
        dest = src.with_name(src.stem + "-bundled" + src.suffix)
        dest.write_text(MARKER.sub(lambda _: tag, html, count=1), encoding="utf-8")
        print(f"Wrote {dest} ({dest.stat().st_size/1e6:.1f} MB, self-contained)",
              file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
