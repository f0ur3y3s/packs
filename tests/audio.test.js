// Audio is the one thing in this app that fails silently: browsers refuse to
// open an AudioContext before a gesture and report nothing. Two cases here --
// the normal one, and a context stubbed to refuse forever, which is what
// Safari looks like when the unlock does not take.
const { serve, launch, watch, waitForArt, dragTearStrip } = require("./lib/harness");

const button = page => page.evaluate(() => {
  const b = document.getElementById("sound");
  return { glyph: b.textContent, warn: b.classList.contains("warn"), label: b.getAttribute("aria-label") };
});

// Stands in for a browser that will not let the context run. `openAfter` is the
// number of silent-frame attempts before it relents; 0 means never.
function stubbornContext(openAfter) {
  const Real = window.AudioContext || window.webkitAudioContext;
  let starts = 0;
  window.__primeAttempts = () => starts;
  class Stubborn extends Real {
    constructor(...a) {
      super(...a);
      Object.defineProperty(this, "state", { get: () => this.__open ? "running" : "suspended" });
    }
    resume() { return this.__open ? super.resume() : Promise.reject(new Error("not allowed")); }
    createBufferSource() {
      const src = super.createBufferSource();
      const start = src.start.bind(src);
      src.start = (...a) => {
        starts++;
        if (openAfter && starts >= openAfter && !this.__open) {
          this.__open = true;
          super.resume().catch(() => {});
          this.dispatchEvent(new Event("statechange"));
        }
        return start(...a);
      };
      return src;
    }
  }
  window.AudioContext = window.webkitAudioContext = Stubborn;
}

module.exports = async function audio() {
  const server = await serve();
  const browser = await launch();
  const failures = [], notes = [];
  try {
    // --- 1. the normal path -------------------------------------------------
    {
      const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
      const { logs, errors } = watch(page);
      await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
      await page.waitForFunction(() => window.__audio, null, { timeout: 60000 });

      const before = await page.evaluate(() => window.__audio());
      if (before.state !== "unopened") failures.push(`before any gesture the context should be unopened, was ${before.state}`);
      if (before.blocked) failures.push("nothing has been tapped yet, so audio must not report itself blocked");

      await waitForArt(page, logs);
      await page.mouse.click(450, 400);
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => window.__audio());
      if (after.state !== "running") failures.push(`context should be running after a click, was ${after.state}`);

      await dragTearStrip(page);
      const played = await page.evaluate(() => window.__audio());
      if (!(played.plays > 0)) failures.push("tearing the pack scheduled no sounds");
      if (played.lastError) failures.push(`audio reported an error: ${played.lastError}`);

      await page.click("#sound"); await page.waitForTimeout(150);
      const muted = await button(page);
      if (muted.glyph !== "✕") failures.push(`muted button should read ✕, read ${muted.glyph}`);
      await page.click("#sound"); await page.waitForTimeout(150);
      const unmuted = await button(page);
      if (unmuted.glyph !== "♪" || unmuted.warn) failures.push(`unmuted button should read ♪ with no warning, read ${JSON.stringify(unmuted)}`);
      if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
      notes.push(`normal: state=${played.state} plays=${played.plays} attempts=${played.attempts}`);
      await page.close();
    }

    // --- 2. a context that never opens, and one that relents ----------------
    for (const openAfter of [0, 3]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
      const { errors } = watch(page);
      await page.addInitScript(stubbornContext, openAfter);
      await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
      await page.waitForFunction(() => window.__audio, null, { timeout: 60000 });
      for (let i = 0; i < 4; i++) { await page.mouse.click(450, 400); await page.waitForTimeout(350); }
      const st = await page.evaluate(() => window.__audio());
      const b = await button(page);
      const attempts = await page.evaluate(() => window.__primeAttempts());
      if (openAfter === 0) {
        if (!st.blocked) failures.push("a context that never opens must report blocked");
        if (b.glyph !== "!" || !b.warn) failures.push(`blocked audio should mark the button, button was ${JSON.stringify(b)}`);
        // The old code latched after one failed attempt and never tried again.
        if (attempts < 2) failures.push(`unlock was tried ${attempts} time(s); it must retry on every gesture`);
      } else {
        if (st.state !== "running" || st.blocked) failures.push(`audio did not recover once the context relented: ${JSON.stringify(st)}`);
      }
      if (errors.length) failures.push(`page errors (stub openAfter=${openAfter}): ${errors.slice(0, 3).join(" | ")}`);
      notes.push(`stub openAfter=${openAfter}: state=${st.state} blocked=${st.blocked} primes=${attempts}`);
      await page.close();
    }
    return { failures, notes };
  } finally {
    await browser.close();
    await server.close();
  }
};
