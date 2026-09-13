// Shared plumbing for the browser tests: a static server for the repo, a
// Chromium launch that works on a headless box with no GPU, and a handful of
// waits that know what this page does at boot.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
};

// The page must be served over http, not opened from file://: a file:// page
// cannot load its sibling sprites-data.js in Safari or Chrome.
function serve(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
      const file = path.join(ROOT, rel || "index.html");
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404).end("not found"); return; }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      });
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const url = `http://localhost:${server.address().port}/`;
      resolve({ url, close: () => new Promise(r => server.close(r)) });
    });
  });
}

// Playwright's own browsers are not installed here; the image ships one.
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const exe of ["chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(root, entry, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

async function launch(extraArgs = []) {
  const { chromium } = require("playwright-core");
  const executablePath = chromiumPath();
  if (!executablePath) {
    throw new Error(
      "No Chromium found. These tests drive a real browser.\n" +
      "  Set CHROMIUM_PATH to a Chromium/Chrome binary, or point\n" +
      "  PLAYWRIGHT_BROWSERS_PATH at a Playwright browser directory."
    );
  }
  return chromium.launch({
    executablePath,
    // Software GL: there is no GPU on CI, and the page is WebGL end to end.
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
           "--no-sandbox", ...extraArgs],
  });
}

// Collects the two things every test wants to assert on.
function watch(page) {
  const logs = [], errors = [];
  page.on("console", m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", e => errors.push(e.message));
  return { logs, errors };
}

// The page reports its own art load on the console; that line is the only
// reliable "ready" signal, since the pack is interactive well before it.
async function waitForArt(page, logs, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const line = logs.find(l => l.includes("[art]"));
    if (line) return line;
    await page.waitForTimeout(250);
  }
  throw new Error(`no [art] line within ${timeout}ms`);
}

// Open the pack. The drag across the tear strip is what a user does, but its
// coordinates depend on where the pack lands on screen; the "Open the pack"
// button the page reveals after 7 idle seconds runs the same tear and is the
// stable way to drive it from a test.
async function openPack(page, timeout = 30000) {
  await page.waitForSelector("#action", { state: "visible", timeout });
  await page.click("#action");
  // The tear, the pack lifting away and the first card dealing in.
  await page.waitForFunction(() => document.querySelectorAll("#pips .pip").length === 10,
                             null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

// The gesture itself, for the test that cares that dragging works at all.
// While the pack is idle any sideways drag tears it, and the strip fills at
// |dx| / (innerWidth * 0.62) -- so the drag has to cross most of the window.
async function dragTearStrip(page, y = 230) {
  const width = await page.evaluate(() => window.innerWidth);
  const x0 = Math.round(width * 0.08), x1 = Math.round(width * 0.92);
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let x = x0; x <= x1; x += 12) { await page.mouse.move(x, y); await page.waitForTimeout(16); }
  await page.mouse.move(x1, y);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll("#pips .pip").length === 10,
                             null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

// Flip through the whole pack. Cards are only written to the binder when they
// are revealed, so anything that asserts on stored state has to get here.
async function revealAll(page, timeout = 90000) {
  const deadline = Date.now() + timeout;
  const box = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => document.getElementById("summary").classList.contains("on"));
    if (done) return;
    await page.mouse.click(Math.round(box.w / 2), Math.round(box.h * 0.5));
    await page.waitForTimeout(900);
  }
  throw new Error("never reached the pack summary");
}

module.exports = { ROOT, serve, launch, watch, waitForArt, openPack, dragTearStrip,
                   revealAll, chromiumPath };
