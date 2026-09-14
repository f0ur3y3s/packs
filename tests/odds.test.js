// The pack's odds, over enough packs that the numbers mean something. These
// are the rules of the thing -- if the reverse slot stops seeing rares or the
// misprint rate drifts, nothing else in the app will tell you.
const { serve, launch, watch, waitForArt } = require("./lib/harness");

const PACKS = 40000;
// Sampling error at 40k packs is well under a point; these bands are wide
// enough not to flake and tight enough to catch a real change.
const near = (got, want, tol) => Math.abs(got - want) <= tol;

module.exports = async function odds() {
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    const { logs, errors } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await waitForArt(page, logs);

    const o = await page.evaluate(n => window.__packOdds(n), PACKS);
    const kinds = await page.evaluate(() => window.__misprints.kinds);
    const failures = [], notes = [];
    const pct = n => (n / o.n * 100);

    if (o.malformed) failures.push(`${o.malformed} packs were malformed (wrong size, or more than one reverse or fault)`);

    // A holo rare in roughly one pack in three.
    const holo = pct(o.holo);
    if (!near(holo, 34, 1.5)) failures.push(`holo rare in ${holo.toFixed(1)}% of packs, expected ~34%`);

    // The reverse slot draws from the whole sheet, in proportion to how many
    // of each tier are on it. Rares included: a reverse holo rare is the pull
    // this slot exists for, and excluding it made the slot strictly cheaper.
    const tier = f => pct(o.tiers[f] || 0);
    const [c, u, r] = [tier("C"), tier("U"), tier("R")];
    if (!near(c + u + r, 100, 0.01)) failures.push(`reverse tiers sum to ${(c + u + r).toFixed(2)}%`);
    if (!near(c, 37.1, 1.5)) failures.push(`reverse slot was common ${c.toFixed(1)}% of the time, expected ~37%`);
    if (!near(u, 32.5, 1.5)) failures.push(`reverse slot was uncommon ${u.toFixed(1)}% of the time, expected ~32%`);
    if (!near(r, 30.5, 1.5)) failures.push(`reverse slot was rare ${r.toFixed(1)}% of the time, expected ~30%`);
    notes.push(`reverse slot: ${c.toFixed(1)}% C · ${u.toFixed(1)}% U · ${r.toFixed(1)}% R (1 reverse holo rare in ${(100 / r).toFixed(1)} packs)`);
    notes.push(`holo rare: ${holo.toFixed(1)}% of packs`);

    // Misprints: about one pack in twelve, at most one per pack, and every
    // kind has to be reachable -- a fault nobody can pull is not a feature.
    const faults = pct(o.faults);
    if (!near(faults, 8.33, 0.8)) failures.push(`misprint in ${faults.toFixed(2)}% of packs, expected ~8.3%`);
    const missing = kinds.filter(k => !o.kinds[k]);
    if (missing.length) failures.push(`these misprints never came up in ${o.n} packs: ${missing.join(", ")}`);
    const spread = kinds.map(k => `${k} ${(o.kinds[k] / o.faults * 100).toFixed(1)}%`).join(" · ");
    notes.push(`misprint in ${faults.toFixed(2)}% of packs`);
    notes.push(`of those: ${spread}`);

    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    return { failures, notes };
  } finally {
    await browser.close();
    await server.close();
  }
};
