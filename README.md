# Kanto Pack Opener

A single-file HTML/three.js trading-card pack opener. Tear the pack open, flip
through ten cards rendered as WebGL-textured 3D meshes with a custom holo shader.

## Running it

No build step and no dependencies. Either:

```sh
python3 -m http.server
# then open http://localhost:8000/kanto-pack-opener.html
```

…or open `kanto-pack-opener.html` directly. Keep `sprites-data.js` next to it.

For a single file with nothing alongside it, see `--inline` below.

## Files

| File | Purpose |
| --- | --- |
| `kanto-pack-opener.html` | The app. `bootPackOpener()` is in the first `<script>`; a shim in the second loads three.js r128 from a CDN list and calls it. |
| `sprites-data.js` | The 151 animated sprite sheets as base64 data URIs, with frame timings. Generated — do not edit. |
| `bundle-sprites.py` | Regenerates `sprites-data.js`. |

## Sprites

Card art comes from the [PokeAPI sprite collection](https://github.com/PokeAPI/sprites)
— the animated Showdown set — keyed by National Dex number rather than by name,
which avoids a filename mapping for Nidoran♀/♂, Farfetch'd and Mr. Mime.

They are bundled rather than fetched at runtime, for two reasons:

- **CORS is not optional.** Each card face is drawn to a 2D canvas that THREE
  uploads as a WebGL texture, and a canvas tainted by a non-CORS image makes
  that upload throw `SecurityError`. A `data:` URI never taints the canvas.
- It removes 151 network round-trips from startup.

### How the animation works

A canvas only ever draws the *first* frame of an animated GIF, so the GIFs are
decoded ahead of time. `bundle-sprites.py` unpacks each one, crops every frame
to the union of their non-transparent bounds, merges consecutive duplicates,
samples down to a frame budget (30 by default, holding loop duration steady),
and packs the result into a single palette PNG sprite sheet. Per-sprite
geometry and frame delays ride along in `sprites-data.js`.

At runtime `stepCardArt` picks the current frame from the elapsed time and
repaints **only the art window** — it blits a pre-rendered "plate" of the empty
window, draws one sheet cell over it, and flags the texture. Two consequences
worth knowing if you touch this code:

- Only the focused card is stepped. The rest of the stack sits behind it
  face-down, so animating them would re-upload ten 512×716 textures a frame for
  art nobody can see.
- The art window's inner border is stroked *before* the sprite, not after, so
  that the plate captures it. The sprite is inset by `pad` and never reached
  that border anyway.

Repaints land at the GIF's own rate (~12–15/sec), not once per rendered frame.

### Fallback

`loadSpriteImage` checks `window.SPRITE_DATA` first. If `sprites-data.js` is
missing it falls back to a CDN chain (jsdelivr → raw.githubusercontent →
statically → a weserv proxy) and pulls the raw GIFs — **those render as a
static first frame**, since nothing has decoded them. If every host fails the
card degrades to the built-in `drawCreature` art. That degradation is silent by
design, so watch the console: the loader logs `[art] N/151 sprites …` every run.

### Regenerating

```sh
python3 bundle-sprites.py                              # animated showdown (default)
python3 bundle-sprites.py --inline kanto-pack-opener.html   # + self-contained copy
python3 bundle-sprites.py --set gen1                   # static Red/Blue stills
```

`--set` also takes `bw` (animated Gen 5 pixel art), `default`, and `home` (3D
renders — stills, so nothing animates). `--max-frames` trades bundle size
against motion fidelity; the animated sets need Pillow.

Rough sizes: showdown at 30 frames is ~4.1 MB across 151 sheets; `gen1` stills
are ~128 KB.

## Notes

- three.js r128: no `THREE.CapsuleGeometry`, no bundled `OrbitControls`.
- The pack renders immediately using fallback art and is rebuilt once sprites
  land — but only if it hasn't been torn open yet (`state === "idle" &&
  tearProgress === 0`).
- The holo effect is a custom shader driven by `uTime` / `uTilt` from `animate()`.
- Sprite animation is driven from the same `cards.forEach` loop in `animate()`.
