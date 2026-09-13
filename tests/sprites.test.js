// Sprite sizing has been wrong in both directions: small Pokemon blown up 8x
// into visible blocks, and a whole-pixel snap that shrank a sprite fitting at
// 2.98 down to 2.00. This audits all 151 scales at once.
const { serve, launch, watch, waitForArt } = require("./lib/harness");

module.exports = async function sprites() {
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    const { logs, errors } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await waitForArt(page, logs);

    const { cap, scales } = await page.evaluate(() => window.__spriteScales());
    const names = Object.keys(scales);
    const values = names.map(n => scales[n]);
    const failures = [];
    if (names.length !== 151) failures.push(`audited ${names.length} sprites, expected 151`);

    const over = names.filter(n => scales[n] > cap + 1e-6);
    if (over.length) failures.push(`${over.length} sprites magnified past ${cap}x: ${over.slice(0, 5).join(", ")}`);

    // The snap to whole pixels is only allowed to cost 8%.
    const snapped = names.filter(n => Number.isInteger(scales[n]));
    const min = Math.min(...values), max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (min < 1) failures.push(`${names.filter(n => scales[n] < 1).length} sprites are drawn smaller than their source`);
    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);

    return {
      failures,
      notes: [
        `cap ${cap}x; range ${min.toFixed(2)}x–${max.toFixed(2)}x, mean ${mean.toFixed(2)}x`,
        `${snapped.length}/${names.length} land on a whole-pixel scale`,
      ],
    };
  } finally {
    await browser.close();
    await server.close();
  }
};
