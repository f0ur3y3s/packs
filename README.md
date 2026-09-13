# Kanto Pack Opener

A single-file HTML/three.js trading-card pack opener. Tear the pack open, flip
through ten cards rendered as WebGL-textured 3D meshes with a custom holo shader.

## Running it

No build step and no dependencies.

**Opening it straight off the disk:** use `kanto-pack-opener-bundled.html`. The
engine and all 151 animated sprites are inline, so it needs no sibling files and
no network — double-click it and it runs.

**Working on it:** serve the directory, so `kanto-pack-opener.html` can pick up
`three.min.js` and `sprites-data.js` next to it.

```sh
python3 -m http.server
# then open http://localhost:8000/kanto-pack-opener.html
```

`kanto-pack-opener.html` opened over `file://` works too, but only with those
two files beside it — on its own it has no engine to start, and says so. Some
browsers are also stricter than Chrome about loading sibling scripts over
`file://`. The bundled copy sidesteps both problems, which is why it exists.

## Files

| File | Purpose |
| --- | --- |
| `kanto-pack-opener.html` | The app. `bootPackOpener()` is in the first `<script>`; a shim at the end loads three.js and calls it. Needs the two files below beside it. |
| `kanto-pack-opener-bundled.html` | Generated, but committed: the same app with the engine and art inline. The copy to open locally or upload to a static host. |
| `sprites-data.js` | The 151 animated sprite sheets as base64 data URIs, with frame timings. Generated — do not edit. |
| `three.min.js` | Vendored three.js r128. Tried before any CDN, so the app works offline. |
| `bundle-sprites.py` | Regenerates `sprites-data.js`. |

## Loading

Two things are deliberately *not* blocking `<script src>` tags in the head:

- **`sprites-data.js` is fetched in the background**, after the pack is already
  on screen. It is ~4 MB, and loading it up front froze the boot screen at
  "Getting the 3D engine ready… 0%" for the whole download — nothing below a
  blocking script parses, so the engine loader had not even started and no
  error could be reported. The pack now renders immediately with the built-in
  `drawCreature` art and is rebuilt once the real art lands (only if it hasn't
  been torn open yet).
- **three.js is loaded by the shim**, which tries the vendored `three.min.js`
  first and falls back to three CDNs, each with an 8s timeout, then shows a
  retry screen if all fail.

`bundle-sprites.py --inline` splices both into the `<!--THREE_SLOT-->` and
`<!--SPRITE_DATA_SLOT-->` placeholders to produce a genuinely self-contained
file — one that needs no network, not just one with the art baked in.

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

### Card theming

Flat type colours across 151 cards made every pack look alike, so two more
PokeAPI sources feed the card design. Both live in `window.SPRITE_META`
alongside the sprite sheets, and the card falls back to its old look if the
metadata is absent.

- **`pokeapi.co/api/v2/pokemon-species/{id}`** gives each Pokémon's canonical
  `color` (ten of them, against six types), its `habitat`, and its real
  `genus`. Colour drives the card border and the panel tint, habitat picks the
  art-window gradient, and the genus replaces the fixed "Kanto Series" line.
  Type still owns the energy pips, glyphs and ink, so nothing semantic is lost.
- **`other/official-artwork/{id}.png`** is downscaled to 192px, lightly blurred
  and flattened to JPEG, then drawn under the sprite as a wash of that
  Pokémon's own art. ~5 KB each. It is baked into the animation plate, so it
  costs nothing per frame.

`--no-extras` skips both. `--backdrop-size` and `--backdrop-blur` control how
sharp the wash is; they are independent, so resolution can go up without the
blur following it.

There is no general-purpose "background API" worth wiring up here. The obvious
candidate for real card art, pokemontcg.io, was returning 500s and connection
failures when this was written, and it serves whole card images rather than
backgrounds.

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
are ~128 KB. Since the bundle loads in the background, its size costs you how
long the fallback art is on screen, not how long the page takes to start.

## Deploying

Published with GitHub Pages, which works whichever source the repository is set
to — worth knowing, because the two modes behave differently:

- **Source: a branch.** GitHub serves the repository root. `.nojekyll` stops it
  publishing `README.md` as the site, and the root `index.html` redirects to the
  app. `three.min.js` and `sprites-data.js` sit alongside, so they resolve.
- **Source: GitHub Actions.** `.github/workflows/pages.yml` lays the same files
  into `_site`, publishing the app as `index.html` directly (no redirect) and
  the self-contained copy as `standalone.html`.

Both can be active at once: the built-in branch builder still runs while the
workflow does, and whichever finishes last wins. That is why the root has to
serve the app on its own rather than relying on the workflow.

Serving over https also sidesteps the `file://` restrictions that stop Safari
loading sibling scripts locally.

## Binder

Every card is recorded the moment it is turned over, not when the pack is
finished, so closing the tab halfway through keeps what you already saw. The
store is `localStorage` under `kanto.binder.v1`:

```
{ v:1, packs, pulls, cards: { "<dex>": { n, best, first } } }
```

`best` is the best finish ever pulled for that slot (`none` < `reverse` <
`rare`), so pulling a plain copy later cannot downgrade a holo you own. Writes
are batched to one per tick because pulls arrive in bursts as a pack is flipped
through.

Every read and write is wrapped: `localStorage` throws outright in Safari's
private mode. The binder then runs in memory for the session and says so in its
header rather than failing.

The grid is all 151 slots in dex order — caught ones in colour, the rest as
silhouettes. Thumbnails are CSS backgrounds over the sprite sheet sized to show
frame 0, so 151 of them cost no canvases. Opening a slot rebuilds the full card
through the same `buildCardFace` the pack uses; `statsFor` is seeded from the
Pokémon's name, so the card is identical to the one pulled and nothing about it
needs storing.

## Notes

- three.js r128: no `THREE.CapsuleGeometry`, no bundled `OrbitControls`.
- The pack renders immediately using fallback art and is rebuilt once sprites
  land — but only if it hasn't been torn open yet (`state === "idle" &&
  tearProgress === 0`).
- The holo shader is driven by the reflection vector, so the foil moves when
  the card does rather than animating on its own; `uTime` only adds a crawl.
  Highlights are additive over the art instead of mixing it toward flat
  rainbow, and a specular lobe gates both the sheen and the sparkle so a card
  held flat-on isn't covered in speckles.
- Sprites are drawn at a whole-pixel scale. At a fractional one, nearest-
  neighbour gave some source rows 3 screen pixels and others 4, which read as
  ragged edges.
- The card's side faces take their colour from its own border. They were an
  unlit near-white, which rendered brighter than the shaded front and ringed
  every card in white.
- Sprite animation is driven from the same `cards.forEach` loop in `animate()`.
