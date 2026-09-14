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
- **`other/official-artwork/{id}.png`** can be bundled as a blurred wash behind
  the sprite, but is **off by default**: habitat scenes replaced it, and it cost
  0.6 MB plus 151 image decodes at boot for something the card no longer drew.
  `--backdrops` brings it back.

`--no-extras` skips the species metadata. `--backdrops` re-enables the artwork
wash, with `--backdrop-size` and `--backdrop-blur` controlling how sharp it is.

There is no general-purpose "background API" worth wiring up here. The obvious
candidate for real card art, pokemontcg.io, was returning 500s and connection
failures when this was written, and it serves whole card images rather than
backgrounds.

### Regenerating

```sh
python3 bundle-sprites.py                              # animated showdown (default)
python3 bundle-sprites.py --inline kanto-pack-opener.html   # + self-contained copy
python3 bundle-sprites.py --set gen1                   # static Red/Blue stills
python3 bundle-sprites.py --reuse-data --inline kanto-pack-opener.html  # re-splice only
```

Most commits change only the HTML, and the bundled copy has to be regenerated
for every one of them. `--reuse-data` does that splice from the `sprites-data.js`
already on disk, so it needs no network and produces byte-identical art.

`--set` also takes `bw` (animated Gen 5 pixel art), `default`, and `home` (3D
renders — stills, so nothing animates). `--max-frames` trades bundle size
against motion fidelity; the animated sets need Pillow.

Rough sizes: showdown at 30 frames is ~4.1 MB across 151 sheets; `gen1` stills
are ~128 KB. Since the bundle loads in the background, its size costs you how
long the fallback art is on screen, not how long the page takes to start.

## Odds

A pack is ten cards: five commons, three uncommons, one reverse holo and one
rare, with a holo in the rare slot about one pack in three.

The reverse holo slot draws from the whole reverse-eligible sheet in proportion
to how many of each tier is on it — 56 commons, 49 uncommons, 46 rares — so it
comes out common 37% of the time, uncommon 32% and rare 30%, which puts a
reverse holo rare at about one pack in 3.3. It used to be 60% common / 40%
uncommon with rares excluded outright, which made a reverse holo Charizard
impossible and the slot strictly cheaper than a real one.

Two caveats on "real". The Pokémon Company has never published pull rates, so
the one-in-three figure is community aggregation rather than an official
number. And the eras are mixed: the pack and the card faces are styled after
Base Set, which was eleven cards with no reverse holos at all — they arrived
with Legendary Collection in 2002. The ten-card layout with a single reverse is
the modern structure.

## Misprints

About one pack in twelve carries a card that came off the press wrong. Each
fault is something that happens to real cards, and at most one card per pack
has one.

| Fault | Share of misprints | What it looks like |
| --- | --- | --- |
| Off-centre cut | 33% | The print sits 10–22px off inside the cut, with a sliver of the next card on the sheet along one or two edges. |
| Ink registration | 15% | The three plates are laid down 3–7px apart, so every edge on the card carries a colour fringe. |
| Double strike | 13% | The whole card printed twice, a few pixels apart. |
| Factory crimp | 11% | A toothed band pressed across the card by the wrapping machine. |
| Foil error | 10% | The foil layer went on the wrong card: a HOLO RARE with no foil on it, or a plain common that shimmers. |
| Text error | 10% | A doubled, dropped or transposed letter in the name, or an HP an order of magnitude out. |
| Miscut | 6% | Cut 44–86px wrong, clean into the neighbouring card. |

Everything except the text error is applied to the finished card face rather
than woven into the layout, because a press fault happens to the whole card at
once, after everything is on it. Anything that moves the print moves the sprite
quad and the foil mask with it — the foil goes onto the sheet before the
guillotine does.

Every parameter comes from `mulberry32(hashStr(name + "·misprint·" + kind))`,
so the binder rebuilds the exact card you pulled from nothing but the species
and the kind of fault. A misprint is announced on reveal, tagged in the pack
summary, and has its own filter in the binder.

## Tests

`tests/` drives a real Chromium against the page: boot with no network, the
pack's entrance and tear, the audio state machine (including a stubbed context
that refuses to open), the binder's storage and filters, an audit of all 151
sprite scales, and the pack odds over 40,000 packs. See
[tests/README.md](tests/README.md).

```sh
cd tests && npm install && node run.js
```

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

Filter chips carry live counts: All, Collected, Duplicates and Holos. The grid
is all 151 slots in dex order — caught ones in colour, the rest as
silhouettes. Thumbnails are CSS backgrounds over the sprite sheet sized to show
frame 0, so 151 of them cost no canvases. Opening a slot builds a **real card** — the same mesh the pack uses, in its own
small renderer, which drifts on its own and can be dragged. It has to be the
mesh and not a picture of one: the holo is a shader on the card's material, so a
flat canvas render of a holo pull looked exactly like a normal card and there
was no way to see what you had actually pulled. The view is torn down on close
(geometry, front and mask textures, sprite texture, its own renderer), leaving
the back material, its texture and the room map alone since the pack shares
those.

`statsFor` is seeded from the Pokémon's name, so the card is identical to the
one pulled and nothing about it needs storing. Each slot also tallies the finish
of every copy, not just the best one, so three Charizards can read "1 holo ·
2 normal" rather than just "×3". Records written before that tally existed are
backfilled on read by attributing every copy to the best finish, which is the
only reading the old data supports.

## Planned work

Habitat scenes are built and are the only background the card draws. See
`BACKGROUNDS.md` for the reasoning and what is left — richer time-of-day, and
splitting scene and sprite onto separate quads so they parallax apart.

## Card back

Drawn in `buildCardBack`, built against the Japanese *Pocket Monsters Card
Game* back: navy field marbled with arcs that circle the centre, five broad
cream rays (two up, two down, one straight down — nothing points straight up,
which is what leaves the field clear behind the wordmark), a red keyline inside
the cream stock, and a gold wordmark arced over the ball.

The ball is tilted 18 degrees, measured off the reference by finding the
centroids of its red and gold halves and taking the angle between them. Drawn
level it reads as a badge rather than a sphere. Its shading and specular stay
in screen space while the band and button rotate, because the light does not
tilt with the ball.

The wordmark reads KANTO SERIES rather than the original's, and the footer says
the set is fan-made and unaffiliated — this is a fan project's own back in that
design, not a reproduction of a Nintendo product. Both strings are one line each
in `buildCardBack` if you want them to say something else.

The small print at the bottom is dark on purpose: the straight-down ray puts
cream underneath it, which is why the original's copyright line down there is
dark red rather than white.

One canvas, one texture and one material shared by all ten cards. Its material
is tinted below white: the scene runs ambient 0.72 plus two directionals, so at
full white the back blows out. The card face does not show this because its
shader samples the texture directly instead of being lit.

## Lighting and shape

Two things stop the card reading as a flat printed rectangle:

**A room to reflect.** `roomEnvTexture` builds a small equirectangular canvas —
dark floor, warm horizon, cool ceiling, one soft overhead light — used as an
`envMap` on the rim and back and sampled directly by the card's shader. It is
weighted by fresnel, so it is barely present face-on and builds as the card
turns. Without it the card was lit but reflected nothing, which reads as lit
*nowhere*.

**A bow.** `buildCardGeometry` bows the slab after computing UVs and the
front/back/rim grouping (both classify against the flat normals), then rebuilds
normals. It is done to the geometry rather than in the card's vertex shader
because the rim and back are lit by standard materials and would not have
followed a shader-only bend.

The bow is what makes the reflection do anything: across a flat card the normal
barely varies, so a highlight flashes on and off over the whole face at once.
Curved, it sweeps. Measured across a tilt sweep, the left-minus-right
brightness of the card face moves from −4 to +17 as it turns.

## The sprite is its own surface

The sprite is not painted into the card face. It has its own canvas, textured
onto a quad sitting just in front of the card, and that quad is bowed to the
same curve so the gap between them stays even instead of opening at the
corners. Being physically nearer the camera, it parallaxes against the frame on
its own — measured over a tilt sweep, it travels about 95px relative to the card
outline.

Two consequences worth knowing:

- The card face is now completely static. Nothing on it is re-uploaded; only
  the sprite's own texture changes. Texture traffic over six seconds of viewing
  went 32.3 MB to 14.7 MB.
- `buildCardFace` takes `{flatSprite:true}` for renders that need the sprite
  baked in — the binder, which rebuilds a card as a single image. Without it
  the binder's cards would come out empty, since the scene path expects the
  sprite to arrive on the quad.

The shader's old UV parallax is gone. It faked exactly this effect, and running
both doubled the movement.

## Page chrome

The palette is taken from the set's own artefacts rather than picked in the
abstract: the navy is the card back's field, the paper its stock, the gold its
ribbon and wordmark, the red its ball. Teal survives but now means only one
thing — foil. The background carries a very faint echo of the card back's
sunburst, kept low-contrast so the pack stays the brightest thing on screen.

Gold is the action colour, so the primary button, the active filter chip, the
tilt toggle and the current pip all read as the same affordance. The wordmark
carries a small CSS ball, the same mark as the pack and the card back.

## The art window as a screen

The sprites are 31x29 to 217x181 and get upscaled 1.5x to 8x into the art
window, so they are unavoidably chunky. Rather than fight that, the window is
treated as a small CRT.

- **Dithering.** `drawHabitatScene` finishes by banding the scene to six levels
  with a 4x4 Bayer threshold. Smooth vector gradients behind hard pixel art were
  most of why the sprites read as the wrong resolution rather than as a style;
  quantising the scene puts both on the same footing, and it is what the
  hardware these sprites come from actually did. Applied last, so every layer is
  quantised together rather than each one separately.
- **Scanlines and grille.** A 3x6 tiling texture on a third quad, in front of
  the sprite — a scanline that stops at the Pokémon is not a scanline, it is a
  background. The repeat is whole numbers (143 x 20): a fractional repeat under
  a nearest filter makes some lines a pixel thicker than their neighbours, which
  reads as moiré rather than as a screen.

Both are tunable in one place each — the level count in `ditherRegion`, and the
scanline alpha, repeat and overlay opacity in `crtOverlayTexture`.

## Notes

- three.js r128: no `THREE.CapsuleGeometry`, no bundled `OrbitControls`.
- The pack renders immediately using fallback art and is rebuilt once sprites
  land — but only if it hasn't been torn open yet (`state === "idle" &&
  tearProgress === 0`). That rebuild is `newPack({silent:true})`: it skips the
  drop-in tween, or the pack visibly zooms in a second time.
- Audio reports itself. Browsers refuse to open an `AudioContext` before a
  gesture and never say so, so a silent page looks identical to a working one.
  The sound button turns red and reads `!` while the context is blocked, every
  gesture retries the unlock (the old code latched after one failed attempt and
  stayed silent for good), and `window.__audio()` returns
  `{state, blocked, muted, plays, attempts, lastError}` from the console.
- The holo shader is driven by the reflection vector, so the foil moves when
  the card does rather than animating on its own; `uTime` only adds a crawl.
  Highlights are additive over the art instead of mixing it toward flat
  rainbow, and a specular lobe gates both the sheen and the sparkle so a card
  held flat-on isn't covered in speckles.
- Sprites take a whole-pixel scale only when it costs under 8%. Whole pixels
  are crisper — at a fractional scale nearest-neighbour gives some source rows
  3 screen pixels and others 4 — but snapping every scale above 2x drew a
  sprite fitting at 2.98 at 2.00, a third smaller than a neighbour fitting at
  1.97 that kept its exact scale. Across the 151 that was a mean size loss of
  11% and a worst case of 33%; with the 8% limit it is 1.8% and 7.9%.
- The card's side faces take their colour from its own border. They were an
  unlit near-white, which rendered brighter than the shaded front and ringed
  every card in white.
- Sprite animation is driven from the same `cards.forEach` loop in `animate()`.
