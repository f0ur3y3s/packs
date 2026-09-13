#!/usr/bin/env node
// Runs the browser tests. Each suite is a module exporting an async function
// that returns { failures: string[], notes: string[] } -- a suite that cannot
// decide anything should throw rather than pass quietly.
//
//   node tests/run.js            all suites
//   node tests/run.js audio      just the ones whose name matches
const path = require("path");
const { chromiumPath } = require("./lib/harness");

const SUITES = ["boot", "pack", "audio", "binder", "sprites"];

(async () => {
  try { require("playwright-core"); }
  catch (e) {
    console.error("playwright-core is not installed. From the tests/ directory:\n  npm install");
    process.exit(2);
  }
  if (!chromiumPath()) {
    console.error(
      "No Chromium found. These tests drive a real browser.\n" +
      "  Set CHROMIUM_PATH to a Chromium or Chrome binary, or point\n" +
      "  PLAYWRIGHT_BROWSERS_PATH at a Playwright browser directory.\n" +
      "  (On the Claude Code remote image it is already at /opt/pw-browsers.)"
    );
    process.exit(2);
  }

  const filter = process.argv.slice(2);
  const chosen = filter.length ? SUITES.filter(s => filter.some(f => s.includes(f))) : SUITES;
  if (!chosen.length) {
    console.error(`no suite matches ${filter.join(" ")}. Known: ${SUITES.join(", ")}`);
    process.exit(2);
  }

  let failed = 0;
  for (const name of chosen) {
    const started = Date.now();
    process.stdout.write(`\n== ${name} ==\n`);
    let result;
    try {
      result = await require(path.join(__dirname, `${name}.test.js`))();
    } catch (err) {
      console.log(`  ERROR  ${err && err.stack ? err.stack.split("\n")[0] : err}`);
      failed++;
      continue;
    }
    for (const note of result.notes || []) console.log(`  ·  ${note}`);
    for (const f of result.failures) console.log(`  ✗  ${f}`);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (result.failures.length) { failed++; console.log(`  FAIL (${secs}s)`); }
    else console.log(`  ok (${secs}s)`);
  }
  console.log(`\n${chosen.length - failed}/${chosen.length} suites passed`);
  process.exit(failed ? 1 : 0);
})();
