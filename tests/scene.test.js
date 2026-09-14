// The habitat scene is sampled from its own oversized texture with a
// tilt-driven offset, and two things have to hold or the effect breaks without
// saying so: the shader has to compile, and the offset can never reach the
// edge of the picture it is shifting into.
//
// Note on what this does NOT cover: the direction of the offset. The first
// version mapped it to the wrong axis -- a sideways drag slid the scene
// vertically -- and nothing here would have caught that. It was found, and
// fixed, by rendering the offset itself as colour. If it regresses, do that
// again rather than trusting this suite.
const { serve, launch, watch, waitForArt } = require("./lib/harness");

module.exports = async function scene() {
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    const { logs, errors } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await waitForArt(page, logs);
    await page.waitForTimeout(1500);          // let the pack's cards build

    const p = await page.evaluate(() => window.__parallax());
    const failures = [], notes = [];

    if (!p.hasScene) failures.push("no card in the pack has a habitat scene");

    // The scene canvas has to actually be bigger than the window it shows in.
    const wantW = Math.round(p.artW * p.overscan), wantH = Math.round(p.artH * p.overscan);
    if (p.sceneW !== wantW || p.sceneH !== wantH)
      failures.push(`scene canvas is ${p.sceneW}x${p.sceneH}, expected ${wantW}x${wantH}`);

    // uTilt reaches 1.7 on the device-orientation path, which is the widest
    // input the shader ever sees. At full tilt the offset must still be inside
    // the margin, or the sky wraps round to the ground at the window's edge.
    const MAX_TILT = 1.7;
    const worst = p.uParallax * MAX_TILT;       // depth is 1.0 in the foreground
    if (!(worst < p.inset))
      failures.push(`at full tilt the scene shifts ${worst.toFixed(4)} of the texture but only ${p.inset.toFixed(4)} is spare — the edge will show`);
    notes.push(`scene ${p.sceneW}x${p.sceneH} for a ${p.artW}x${p.artH} window · ` +
               `shift ${(worst * 100).toFixed(1)}% of ${(p.inset * 100).toFixed(1)}% spare`);

    // And the sprite leaning the other way must stay inside its own inset.
    if (p.spriteParallaxMaxPx >= p.spritePad)
      failures.push(`the sprite can move ${p.spriteParallaxMaxPx.toFixed(1)}px but is only inset ${p.spritePad}px — it will clip the window`);
    notes.push(`sprite moves at most ${p.spriteParallaxMaxPx.toFixed(1)}px against a ${p.spritePad}px inset`);

    // A shader that fails to compile leaves a black card and a console error,
    // not a page error, so it would otherwise pass every other suite.
    const shader = logs.filter(l => /shader error|WebGLProgram|GLSL/i.test(l));
    if (shader.length) failures.push(`shader did not compile: ${shader[0].slice(0, 200)}`);
    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    return { failures, notes };
  } finally {
    await browser.close();
    await server.close();
  }
};
