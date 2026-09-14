// The binder is the only persistent state in the app, and the only place a
// card is rebuilt from scratch rather than kept: the filters, the duplicate
// counts and the live 3D card all read from localStorage.
const { serve, launch, watch, waitForArt, openPack, revealAll } = require("./lib/harness");

const SEED = {
  v: 1, packs: 4, pulls: 23,
  cards: {
    "6":   { n: 3, best: "rare",    f: { rare: 1, none: 2 } },   // holo + duplicates
    "25":  { n: 2, best: "reverse", f: { reverse: 1, none: 1 } },
    "9":   { n: 1, best: "none",    f: { none: 1 } },
    "150": { n: 1, best: "rare",    f: { rare: 1 } },
    "94":  { n: 1, best: "none",    f: { none: 1 }, m: { inkshift: 1 } },  // a misprint
    "143": { n: 2, best: "rare",    f: { rare: 1, none: 1 }, m: { foil: 1 } }, // and a misprinted duplicate
  },
};

module.exports = async function binder() {
  const server = await serve();
  const browser = await launch();
  const failures = [], notes = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 880 } });
    const { logs, errors } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await waitForArt(page, logs);

    // --- a real pull must be recorded ---------------------------------------
    await page.evaluate(() => localStorage.removeItem("kanto.binder.v1"));
    await page.reload({ waitUntil: "commit" });
    await waitForArt(page, logs);
    await openPack(page);
    await revealAll(page);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kanto.binder.v1") || "null"));
    if (!stored) failures.push("opening a pack wrote nothing to localStorage");
    else {
      const total = Object.values(stored.cards).reduce((n, c) => n + c.n, 0);
      if (total !== 10) failures.push(`a pack is 10 cards, the binder recorded ${total}`);
      if (stored.packs !== 1) failures.push(`expected packs=1, got ${stored.packs}`);
      // Every card must carry a per-finish tally, or the binder cannot show
      // which copies are holo.
      const missing = Object.entries(stored.cards).filter(([, c]) => !c.f || !Object.keys(c.f).length);
      if (missing.length) failures.push(`${missing.length} entries stored no finish tally`);
      notes.push(`fresh pull: ${total} cards across ${Object.keys(stored.cards).length} species`);
    }

    // --- the filters and the live card, from a known collection -------------
    const seed = JSON.parse(JSON.stringify(SEED));
    for (const c of Object.values(seed.cards)) c.first = Date.now();
    await page.evaluate(s => localStorage.setItem("kanto.binder.v1", JSON.stringify(s)), seed);
    await page.reload({ waitUntil: "commit" });
    await waitForArt(page, logs);
    await page.click("#binderbtn", { timeout: 30000 });
    await page.waitForTimeout(1200);

    const counts = {};
    for (const filter of ["all", "dupes", "holo", "misprint"]) {
      const chip = await page.$(`.chip[data-filter="${filter}"]`);
      if (!chip) { failures.push(`no "${filter}" filter chip`); continue; }
      await chip.click();
      await page.waitForTimeout(700);
      counts[filter] = await page.evaluate(() => document.querySelectorAll(".slot.own").length);
    }
    if (counts.all !== 6) failures.push(`six species were seeded, the grid showed ${counts.all} collected`);
    if (counts.dupes !== 3) failures.push(`three species have duplicates, the dupes filter showed ${counts.dupes}`);
    // "Holos" means any finish other than plain, so the reverse holo counts too.
    if (counts.holo !== 4) failures.push(`four species have a foil finish, the holo filter showed ${counts.holo}`);
    if (counts.misprint !== 2) failures.push(`two species were seeded with a misprint, the filter showed ${counts.misprint}`);
    notes.push(`filters: ${JSON.stringify(counts)}`);

    // The detail view renders its own WebGL card; opening it repeatedly must
    // not leave a canvas behind each time.
    await page.click('.chip[data-filter="holo"]');
    await page.waitForTimeout(500);
    for (let i = 0; i < 3; i++) {
      const slot = await page.$(".slot.own");
      await slot.click();
      await page.waitForTimeout(900);
      await page.click("#binderActions .cta");
      await page.waitForTimeout(400);
    }
    const slot = await page.$(".slot.own");
    await slot.click();
    await page.waitForTimeout(1500);
    const canvases = await page.evaluate(() => document.querySelectorAll("#binderStage canvas").length);
    if (canvases !== 1) failures.push(`binder stage holds ${canvases} canvases after four opens, expected 1`);
    const meta = await page.evaluate(() => document.getElementById("binderMeta").innerText);
    if (!/holo|rare/i.test(meta)) failures.push(`binder detail did not mention the holo finish: ${JSON.stringify(meta)}`);
    notes.push(`detail meta: ${meta.replace(/\n/g, " | ")}`);

    // Opening a misprint rebuilds it from the name and the kind alone, so the
    // card in the binder has to be the card that came out of the pack.
    await page.click("#binderActions .cta");     // the detail view is still up
    await page.waitForTimeout(400);
    await page.click('.chip[data-filter="misprint"]');
    await page.waitForTimeout(600);
    const mis = await page.$(".slot.own");
    await mis.click();
    await page.waitForTimeout(1500);
    const misMeta = await page.evaluate(() => document.getElementById("binderMeta").innerText);
    if (!/registration|foil error/i.test(misMeta)) failures.push(`binder detail did not name the fault: ${JSON.stringify(misMeta)}`);
    const twice = await page.evaluate(() => {
      const a = window.__misprints.spec("Gengar", "inkshift");
      const b = window.__misprints.spec("Gengar", "inkshift");
      return JSON.stringify(a) === JSON.stringify(b);
    });
    if (!twice) failures.push("a misprint's parameters are not stable, so the binder cannot rebuild the card you pulled");
    notes.push(`misprint detail: ${misMeta.replace(/\n/g, " | ")}`);

    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    return { failures, notes };
  } finally {
    await browser.close();
    await server.close();
  }
};
