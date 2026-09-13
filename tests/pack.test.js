// The pack's entrance and the deal. The entrance is here because it regressed:
// the sprite bundle finishing its background load used to re-run newPack(),
// replaying the drop-in so the pack appeared to zoom in twice.
const { serve, launch, watch, waitForArt, openPack, dragTearStrip } = require("./lib/harness");

module.exports = async function pack() {
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    const { logs, errors } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });

    // Sampled per frame: the entrance is only 0.65s and spends a fraction of
    // that below half scale, so a coarser poll misses it outright.
    const trace = await page.evaluate(() => new Promise(res => {
      const out = [], t0 = performance.now();
      (function step() {
        out.push([Math.round(performance.now() - t0), window.__packScale ? window.__packScale() : -1]);
        if (performance.now() - t0 > 20000) res(out); else requestAnimationFrame(step);
      })();
    }));
    // The pack's scale only grows within one entrance, so the first non-zero
    // reading and every drop after it is one drop-in.
    let entrances = 0, prev = null;
    for (const [, s] of trace) {
      if (s < 0) continue;
      if (prev === null) { if (s > 0) { entrances++; prev = s; } continue; }
      if (s < prev - 0.05 || (prev === 0 && s > 0)) entrances++;
      prev = s;
    }

    const art = await waitForArt(page, logs);

    // A stray tap on the untorn pack hides the "Open the pack" fallback. It has
    // to come back: without it one tap left the button gone for the rest of the
    // pack, with nothing on screen but the hint text.
    await page.waitForSelector("#action", { state: "visible", timeout: 20000 });
    await page.mouse.click(450, 430);
    await page.waitForTimeout(400);
    const hiddenAfterTap = await page.evaluate(() => getComputedStyle(document.getElementById("action")).display === "none");
    let rearmed = true;
    try { await page.waitForSelector("#action", { state: "visible", timeout: 12000 }); }
    catch (e) { rearmed = false; }

    // The real gesture, not the fallback button: dragging across the pack is
    // the one interaction the whole app is built around.
    await dragTearStrip(page);
    const pips = await page.evaluate(() => document.querySelectorAll("#pips .pip").length);
    await page.mouse.click(450, 430);           // flip the top card face-up
    await page.waitForTimeout(2500);

    const failures = [];
    if (entrances !== 1) failures.push(`pack played its entrance ${entrances} times, expected 1`);
    if (pips !== 10) failures.push(`expected 10 pips after the tear, saw ${pips}`);
    if (!hiddenAfterTap) failures.push("touching the pack should hide the fallback button");
    if (!rearmed) failures.push("the fallback button never came back after a tap that tore nothing");
    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    return { failures, notes: [`entrances: ${entrances}`, `pips: ${pips}`, `fallback button re-armed: ${rearmed}`, art.trim()] };
  } finally {
    await browser.close();
    await server.close();
  }
};
