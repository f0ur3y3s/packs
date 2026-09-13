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
| `sprites-data.js` | The 151 Gen 1 sprites as base64 data URIs. Generated — do not edit. |
| `bundle-sprites.py` | Regenerates `sprites-data.js`. |

## Sprites

Card art comes from the [PokeAPI sprite collection](https://github.com/PokeAPI/sprites)
(Red/Blue sprites), keyed by National Dex number rather than by name — which
avoids a filename mapping for Nidoran♀/♂, Farfetch'd and Mr. Mime.

They are bundled as data URIs rather than fetched at runtime, for two reasons:

- **CORS is not optional.** Each card face is drawn to a 2D canvas that THREE
  uploads as a WebGL texture, and a canvas tainted by a non-CORS image makes
  that upload throw `SecurityError`. A `data:` URI never taints the canvas.
- It removes 151 network round-trips from startup.

`loadSpriteImage` checks `window.SPRITE_DATA` first. If `sprites-data.js` is
missing it falls back to a CDN chain (jsdelivr → raw.githubusercontent →
statically → a weserv proxy), and if every host fails the card degrades to the
built-in `drawCreature` art. That degradation is silent by design, so watch the
console: the loader logs `[art] N/151 sprites …` on every run.

### Regenerating

```sh
python3 bundle-sprites.py --gen1                            # sprites-data.js
python3 bundle-sprites.py --gen1 --inline kanto-pack-opener.html  # + self-contained copy
```

Drop `--gen1` for the modern artwork instead of the Red/Blue sprites.
`--inline` additionally writes `kanto-pack-opener-bundled.html`, a single file
with the sprite data spliced in and no sibling assets.

## Notes

- three.js r128: no `THREE.CapsuleGeometry`, no bundled `OrbitControls`.
- The pack renders immediately using fallback art and is rebuilt once sprites
  land — but only if it hasn't been torn open yet (`state === "idle" &&
  tearProgress === 0`).
- The holo effect is a custom shader driven by `uTime` / `uTilt` from `animate()`.
