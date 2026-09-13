# Tests

Browser tests for `kanto-pack-opener.html`. They drive a real Chromium against
a local static server, because almost everything worth checking here only
exists at runtime: WebGL, canvas textures, `localStorage`, an `AudioContext`
the browser may refuse to open.

```sh
cd tests
npm install
node run.js             # everything
node run.js audio pack  # just the suites whose name matches
```

They need a Chromium binary. `run.js` looks at `CHROMIUM_PATH`, then
`PLAYWRIGHT_BROWSERS_PATH`, then `/opt/pw-browsers`, and says so plainly if it
finds none rather than failing halfway through a suite. It launches with
software GL (`--use-angle=swiftshader`), so it runs on a box with no GPU —
which also means the frame rates it can measure are not worth anything.

| Suite | What it is for |
| --- | --- |
| `boot` | The page boots with no network beyond its own origin, and finds 151/151 sprites. Both have broken: the sprite CDN refused CORS, and a 4.1 MB blocking `<script>` froze the boot overlay at 0%. |
| `pack` | The pack plays its drop-in exactly once (loading the art used to replay it), a drag across the strip tears it and deals ten cards, and a stray tap does not permanently remove the fallback button. |
| `audio` | The context opens on a gesture and sounds actually schedule; against a stubbed `AudioContext` that refuses to run, the button reports it and every gesture retries. |
| `binder` | A real pack is recorded to `localStorage` with per-finish tallies, the filters count correctly, and reopening a card does not leak a WebGL canvas per open. |
| `sprites` | Audits all 151 sprite scales at once: nothing magnified past the cap, nothing drawn below 1×. |

`contact-sheet.js` is not a test — it renders card art windows into one PNG so a
change to the scenes, the dither or the sprite scaling can be eyeballed side by
side:

```sh
node contact-sheet.js out.png Onix Mewtwo Gengar
```

## Writing one

A suite is `<name>.test.js` exporting an async function that returns
`{ failures: string[], notes: string[] }`. Notes always print; failures print
and fail the run. A suite that cannot reach a verdict should throw rather than
return no failures — a test that passes because it never got far enough is
worse than no test. Add the name to `SUITES` in `run.js`.

`lib/harness.js` has the shared pieces: `serve()`, `launch()`, `watch(page)`
for console and page errors, `waitForArt()` (the page's own `[art]` console
line is the only reliable ready signal), `dragTearStrip()`, `openPack()` and
`revealAll()`.

The page exposes a few hooks for these tests, all named `__`:
`window.__packScale()`, `window.__spriteScales()`, `window.__sheet(names)`,
`window.__back()` and `window.__audio()`.
