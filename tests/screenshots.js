/*
 * Captures the key UI states at desktop and phone widths into docs/screenshots.
 *
 *   node tests/screenshots.js
 */
const fs = require("node:fs");
const path = require("node:path");
const { startBrowser, sleep } = require("./support/browser");

const outDir = path.join(__dirname, "..", "docs", "screenshots");
const pageUrl = `file://${path.join(__dirname, "..", "index.html")}?testapi`;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "mobile", width: 375, height: 812, mobile: true },
];

// Each state is a snippet run after the "Q4 Launch" thread is open.
const STATES = {
  "thread-overview": "",
  "focus-branch": `document.querySelector('[data-branch-chip="8"]').click()`,
  "audience-drift": `document.querySelector('[aria-label="Expand all messages"]').click()`,
  "offline-composer": `document.querySelector('#msg-9 [data-reply-icon]').click(); document.querySelector('[aria-label="Simulate offline (demo)"]').click()`,
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await startBrowser({ portBase: 9800 });
  for (const viewport of VIEWPORTS) {
    for (const [state, action] of Object.entries(STATES)) {
      await browser.setViewport(viewport);
      await browser.navigate(pageUrl);
      for (let i = 0; i < 60 && !(await browser.evaluate("!!window.__testApi && !!document.querySelector('[data-thread]')")); i++) await sleep(200);
      await browser.evaluate("localStorage.clear(); window.__testApi.openThread('t1')");
      await sleep(400);
      if (action) { await browser.evaluate(action); await sleep(400); }
      await browser.evaluate("window.scrollTo(0, 0)");
      await sleep(200);
      const shot = await browser.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(outDir, `${state}.${viewport.name}.png`), Buffer.from(shot.result.data, "base64"));
      console.log(`saved ${state}.${viewport.name}.png`);
    }
  }
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
