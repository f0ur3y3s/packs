#!/usr/bin/env node
// Not a test -- an eyeball tool. Renders one card per kind of press fault into
// a single PNG, so a change to any of them can be checked against the rest and
// against a clean card.
//
//   node tests/misprint-sheet.js                 every kind, plus a control
//   node tests/misprint-sheet.js out.png Onix    every kind on one Pokemon
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { serve, launch, watch, waitForArt } = require("./lib/harness");

// One Pokemon per fault by default: a fault reads differently on a dark card
// than a pale one, and a holo behaves differently again.
const CAST = {
  offcut:   ["Charizard", "rare"],
  miscut:   ["Pikachu",   "none"],
  inkshift: ["Gengar",    "none"],
  ghost:    ["Lapras",    "reverse"],
  crimp:    ["Onix",      "none"],
  typo:     ["Alakazam",  "none"],
  foil:     ["Snorlax",   "rare"],
};

(async () => {
  const [, , outArg, only] = process.argv;
  const out = path.resolve(outArg || "misprint-sheet.png");
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const { logs, errors } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await waitForArt(page, logs);

    const kinds = await page.evaluate(() => window.__misprints.kinds);
    const jobs = kinds.map(k => {
      const [who, holo] = CAST[k] || ["Bulbasaur", "none"];
      return [only || who, k, only ? "none" : holo];
    });
    jobs.push([only || "Squirtle", null, "none"]);     // a clean control

    const cells = [];
    for (const [name, kind, holo] of jobs) {
      const url = await page.evaluate(a => window.__misprints.render(a[0], a[1], a[2]), [name, kind, holo]);
      if (!url) { console.log(`skipped ${name}: not in the roster`); continue; }
      cells.push(PNG.sync.read(Buffer.from(url.split(",")[1], "base64")));
      console.log(`${String(kind || "clean").padEnd(9)} ${name}${holo !== "none" ? " (" + holo + ")" : ""}`);
    }
    if (!cells.length) throw new Error("nothing rendered");

    const cols = Math.min(4, cells.length), rows = Math.ceil(cells.length / cols);
    const cw = cells[0].width, ch = cells[0].height, gap = 10;
    const sheet = new PNG({ width: cols * cw + (cols + 1) * gap, height: rows * ch + (rows + 1) * gap });
    sheet.data.fill(16);
    cells.forEach((cell, i) => {
      PNG.bitblt(cell, sheet, 0, 0, cell.width, cell.height,
                 gap + (i % cols) * (cw + gap), gap + Math.floor(i / cols) * (ch + gap));
    });
    fs.writeFileSync(out, PNG.sync.write(sheet));
    console.log(`-> ${out}`);
    if (errors.length) console.log("page errors:", errors.slice(0, 3));
  } finally {
    await browser.close();
    await server.close();
  }
})();
