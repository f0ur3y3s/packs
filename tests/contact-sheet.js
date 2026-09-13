#!/usr/bin/env node
// Not a test -- an eyeball tool. Renders card art windows into one PNG so a
// change to the scenes, the dither, the CRT or the sprite scaling can be
// compared side by side instead of one card at a time.
//
//   node tests/contact-sheet.js                       a default spread
//   node tests/contact-sheet.js out.png Onix Mewtwo   named Pokemon
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { serve, launch, watch, waitForArt } = require("./lib/harness");

// Dark, pale and mid Pokemon across as many habitats as twelve cells allow.
const DEFAULT = ["Kabuto", "Paras", "Diglett", "Rattata", "Zubat", "Gengar",
                 "Tentacool", "Lapras", "Onix", "Mewtwo", "Articuno", "Bulbasaur"];

(async () => {
  const [, , outArg, ...rest] = process.argv;
  const out = path.resolve(outArg || "contact-sheet.png");
  const names = rest.length ? rest : DEFAULT;
  const server = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const { logs } = watch(page);
    await page.goto(server.url + "kanto-pack-opener.html", { waitUntil: "commit", timeout: 60000 });
    await waitForArt(page, logs);
    const urls = await page.evaluate(ns => window.__sheet(ns), names);
    if (!urls.length) throw new Error(`no cards rendered for ${names.join(", ")}`);

    const cells = urls.map(u => PNG.sync.read(Buffer.from(u.split(",")[1], "base64")));
    const cols = Math.min(4, cells.length);
    const rows = Math.ceil(cells.length / cols);
    const cw = cells[0].width, ch = cells[0].height, gap = 8;
    const sheet = new PNG({ width: cols * cw + (cols + 1) * gap, height: rows * ch + (rows + 1) * gap });
    sheet.data.fill(18);
    cells.forEach((cell, i) => {
      const x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + gap);
      PNG.bitblt(cell, sheet, 0, 0, cell.width, cell.height, x, y);
    });
    fs.writeFileSync(out, PNG.sync.write(sheet));
    console.log(`${cells.length} cards -> ${out}  (${names.join(", ")})`);
  } finally {
    await browser.close();
    await server.close();
  }
})();
