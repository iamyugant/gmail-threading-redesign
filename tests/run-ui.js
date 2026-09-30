/*
 * Runs tests/ui-tests.js in headless Chrome at desktop and phone widths and prints a summary.
 *
 *   node tests/run-ui.js
 *
 * Environment: UI_ONLY=<text> runs matching tests only, UI_VIEWPORT=desktop|mobile limits the width,
 * UI_TIMEOUT=<ms> overrides the per-viewport time limit, CHROME=<path> picks the browser binary.
 */
const path = require("node:path");
const { startBrowser, sleep } = require("./support/browser");

const VIEWPORTS = [
  { name: "desktop 1440x900", width: 1440, height: 900, mobile: false },
  { name: "mobile 375x812", width: 375, height: 812, mobile: true },
].filter((v) => !process.env.UI_VIEWPORT || v.name.includes(process.env.UI_VIEWPORT));

const only = process.env.UI_ONLY ? `&only=${encodeURIComponent(process.env.UI_ONLY)}` : "";
const pageUrl = `file://${path.join(__dirname, "..", "index.html")}?e2e${only}`;
const timeoutMs = Number(process.env.UI_TIMEOUT || 240000);

async function waitForResults(browser) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    const raw = await browser.evaluate("(document.getElementById('e2e-results') || {}).textContent || ''");
    if (raw) return JSON.parse(raw);
  }
  return null;
}

(async () => {
  const browser = await startBrowser();
  let failed = 0;
  for (const viewport of VIEWPORTS) {
    await browser.setViewport(viewport);
    await browser.navigate(pageUrl);
    const report = await waitForResults(browser);
    if (!report) {
      console.error(`[${viewport.name}] timed out waiting for results`);
      browser.consoleProblems.slice(0, 10).forEach((line) => console.error("  " + line));
      process.exit(2);
    }
    console.log(`\n=== ${viewport.name} ===`);
    report.results.forEach((t) => console.log(`${t.ok ? "PASS" : "FAIL"}  ${t.name}${t.ok ? "" : `\n        -> ${t.error}`}`));
    console.log(`${viewport.name}: ${report.passed} passed, ${report.failed} failed`);
    failed += report.failed;
  }
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
