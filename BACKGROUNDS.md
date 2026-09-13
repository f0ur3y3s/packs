# Natural environments behind the sprites

> **Status: phases 1–4 are built and shipped, and the artwork wash is gone.** Habitat scenes are drawn on
> every card. What is left is phase 4 (richer time-of-day and accents) and the
> layered-parallax extension at the end. The rest of this document is the
> reasoning behind the approach, kept because the trade-offs still apply.

## Where this stands today

The art window is a habitat-tinted gradient with a blurred wash of the
Pokémon's own official artwork over it. The wash gives each card its own colour
but no sense of *place* — nothing reads as ground, horizon or sky, so the sprite
floats on a smear.

We already have the data to fix that. `SPRITE_META` carries PokeAPI's `habitat`
for all 151, and it is well spread:

| habitat | count | | habitat | count |
|---|---|---|---|---|
| grassland | 35 | | sea | 15 |
| urban | 22 | | rough-terrain | 8 |
| forest | 21 | | cave | 8 |
| waters-edge | 19 | | rare | 5 |
| mountain | 18 | | | |

Nothing here needs a new data source. The habitat field is already bundled and
already costs us nothing.

## Options considered

**Rip the game location art.** Best possible match, and not on the table — it is
Nintendo's copyrighted artwork. The sprites we already use come from an openly
published community dataset; location backgrounds do not.

**Photo APIs (Unsplash, Pexels).** Free tiers exist, but photographs sit badly
behind 80-pixel sprites, and each one needs a runtime fetch, an API key and
attribution. It would also undo the work done to make the app run with no
network at all.

**A CC0 pixel-art asset pack** (Kenney, OpenGameArt). Licensing is clean and the
aesthetic matches. The problem is curation: nine habitats need art that reads at
428×286 behind a sprite, and pack coverage is uneven — we would be hunting for a
credible "urban" and "rare" set. Worth revisiting if the procedural route stalls.

**Generated stills, baked into the bundle.** Nine habitats × a few variants,
generated once and shipped as JPEGs. Predictable and good-looking, but adds
payload and needs a generation step outside this repo.

**Procedural scenes drawn in canvas.** Recommended, below.

## Recommendation: procedural habitat scenes

Draw a layered scene per card in the same canvas pass that already builds the
card face. Sky or water gradient, a far silhouette, a mid layer, a near layer,
and scatter detail — each habitat gets its own palette and layer behaviour.

I prototyped this to check it holds up; `docs/bg-poc.png` is nine habitats
rendered from the real palettes. It is deliberately crude — flat polygon
silhouettes, no texture — but it shows the habitats read as distinct places and
that the per-Pokémon seeding produces different terrain each time.

Why this one:

- **No payload and no network.** It is code, not assets. The bundle stays where
  it is and the app keeps working offline.
- **It scales to all 151 for free.** No per-Pokémon art to source or store.
- **It matches the sprites.** Flat colour and hard edges sit naturally behind
  pixel art in a way photographs do not.
- **It is tunable.** Palette and layer counts are constants, so the look can be
  iterated in minutes rather than regenerated.

## Two constraints the implementation must respect

**Scenes have to be deterministic.** The binder rebuilds a card from nothing but
its dex number, and `statsFor` is already seeded from the Pokémon's name so the
rebuilt card matches the one pulled. A background seeded from `Math.random()`
would make the binder's copy differ from the card you remember. Seed it the same
way: `mulberry32(hashStr(mon.name + "·scene"))`.

**Scenes have to be drawn before the sprite.** The animation plate is snapshotted
after the window is drawn and before the sprite, and stepping a frame repaints
only that rectangle. Anything drawn into the window before the snapshot costs
nothing per frame; anything drawn after it would be repainted 12 times a second
on top of the existing shadow work. Draw the scene in `buildCardFace`, where the
habitat gradient goes now.

## Making 35 grassland cards look different

Seeded variation across several axes, all cheap:

- **Horizon height** and layer roughness from the seed.
- **Time of day.** Three or four palette ramps per habitat — dawn, day, dusk,
  night — chosen by the seed. This alone turns 9 habitats into ~30 distinct
  looks.
- **Species colour as an accent.** `SPRITE_META.color` is already there; tint the
  sky or the near layer toward it so the scene agrees with the card frame.
- **Rarity.** Give holo and rare pulls a more dramatic sky. The card already
  knows its finish.

## Phasing

1. ~~**Scene generator.**~~ Done — `drawHabitatScene` in the app: sky ramp, sun
   or moon, three seeded terrain bands, scatter, and a centre lift.
2. ~~**Tune against real cards.**~~ Done. `window.__sheet(names)` renders art
   windows without opening packs; the check across dark, pale and mid Pokémon is
   what caught the sprite-scale bug below. Separation comes from the centre lift
   plus the sprite's own drop shadow, and night was weighted down and lifted off
   its floor because dark-on-dark was the one failing combination.
3. ~~**Decide the wash's fate.**~~ Removed. Compared side by side it read as fog
   over a scene, so it was first disabled wherever a scene was drawn — which,
   with all 151 carrying a habitat, meant everywhere. It is now gone from the
   card and out of the bundle by default, taking 0.6 MB and 151 boot-time image
   decodes with it. `bundle-sprites.py --backdrops` brings it back.
4. ~~**Time-of-day ramps and accents.**~~ Done. Each time of day now carries its
   own light colour, a horizon glow around the sun or moon, and a star field at
   night, rather than a single tint over one sky. The species colour from
   `SPRITE_META` washes the lower sky and the nearest terrain band, so the scene
   agrees with the card frame instead of being a separate decision. Holo rares
   and legendaries get a band of light across the sky.

## The extension worth knowing about

The card face is a single texture, so the background and the sprite currently
parallax together. Splitting them into two layers — the scene on one quad, the
sprite on another slightly in front — would let them move at different rates as
the card tilts, which is what would make the window read as a diorama with real
depth rather than a picture of one.

That is a bigger change: it means a second mesh per card, reworking how the
holo mask covers the window, and revisiting the partial-texture-upload path that
keeps the animation cheap. Worth doing, but after the scenes themselves look
right — and worth knowing it is available, because it changes how much effort is
justified on faking depth within a single layer.

## Rough effort

| Phase | Effort |
|---|---|
| 1 — generator and integration | half a day |
| 2 — tuning against all 151 | half a day, mostly looking |
| 3 — wash decision | an hour |
| 4 — time of day and accents | a few hours |
| Layered parallax extension | a day, and it touches the render path |

## Open questions

- How stylised? The prototype is flat vector shapes. Dithered pixel-art
  gradients would sit closer to the sprites but cost more to write.
- Should the scene be visible behind the whole art window, or fade out at the
  top so the sprite stays dominant?
- Keep the official-artwork wash at all once scenes exist?
