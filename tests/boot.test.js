// The page must boot with no network at all beyond its own origin, and it must
// find all 151 sprites in the bundle. Both have broken before: the sprite CDN
// refused CORS, and a 4.1 MB blocking <script> froze the boot overlay at 0%.
const { serve, launch, watch, waitForArt } = require("./lib/harness");

module.exports = async function boot() {
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 860 } });
    const { logs, errors } = watch(page);

    const blocked = [];
    await page.route("**", route => {
      const url = route.request().url();
      if (url.startsWith(server.url)) return route.continue();
      blocked.push(url.slice(0, 100));
      return route.abort();
    });

    const t0 = Date.now();
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 60000 });
    const bootMs = Date.now() - t0;
    const art = await waitForArt(page, logs);

    const failures = [];
    if (blocked.length) failures.push(`page reached outside its origin: ${[...new Set(blocked)].join(", ")}`);
    if (!/151\/151/.test(art)) failures.push(`expected 151/151 sprites, got: ${art}`);
    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    return { failures, notes: [`boot overlay cleared in ${(bootMs / 1000).toFixed(1)}s`, art.trim()] };
  } finally {
    await browser.close();
    await server.close();
  }
};
