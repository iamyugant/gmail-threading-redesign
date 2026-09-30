/*
 * Captures the key UI states at desktop and phone widths into docs/screenshots.
 *
 *   node tests/screenshots.js
 *
 * Icons are a web font. A capture taken before that font arrives shows empty buttons, so every
 * capture waits for the fonts and refuses to save an image if the icons did not render.
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

// Thread states run after the "Q4 Launch" thread is open. List states run on the inbox.
const THREAD_STATES = {
  "thread-overview": "",
  "focus-branch": `document.querySelector('[data-branch-chip="8"]').click()`,
  "audience-drift": `document.querySelector('[aria-label="Expand all messages"]').click()`,
  "offline-composer": `document.querySelector('#msg-9 [data-reply-icon]').click(); document.querySelector('[aria-label="Simulate offline (demo)"]').click()`,
};
const LIST_STATES = {
  "mail-list": "",
  "compose": `document.querySelector('[data-compose-btn]').click()`,
};

const LOAD_FONTS = `Promise.all([
  document.fonts.load('20px "Material Symbols Outlined"'),
  document.fonts.load('400 14px "Google Sans Text"'),
  document.fonts.load('500 14px "Google Sans Text"'),
]).then(() => document.fonts.ready).then(() => true)`;

// With the icon font loaded every .ms element is a glyph about 20px wide.
// Without it the browser draws the ligature name ("mark_email_unread") as text, which is far wider.
const ICONS_RENDERED = `document.fonts.check('20px "Material Symbols Outlined"')
  && [...document.querySelectorAll('.ms')].every((el) => el.getBoundingClientRect().width <= 48)`;

async function ensureFonts(browser, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await browser.evaluate(LOAD_FONTS);
    await sleep(300); // let layout reflow with the real glyphs before anything is measured or captured
    if (await browser.evaluate(ICONS_RENDERED)) return;
    console.warn(`  fonts not ready for ${label} (attempt ${attempt}/3)`);
  }
  throw new Error(`Icon font did not render for ${label}. Refusing to save a screenshot with missing icons.`);
}

async function waitForApp(browser) {
  for (let i = 0; i < 60; i++) {
    if (await browser.evaluate("!!window.__testApi && !!document.querySelector('[data-thread]')")) return;
    await sleep(200);
  }
  throw new Error("The app did not start");
}

async function capture(browser, viewport, state, { prepare, action, scrollToTop }) {
  const label = `${state} (${viewport.name})`;
  await browser.setViewport(viewport);
  await browser.navigate(pageUrl);
  await waitForApp(browser);
  await browser.evaluate(prepare);
  await sleep(400);
  if (action) { await browser.evaluate(action); await sleep(400); }
  if (scrollToTop) await browser.evaluate("window.scrollTo(0, 0)");
  await ensureFonts(browser, label);
  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outDir, `${state}.${viewport.name}.png`), Buffer.from(shot.result.data, "base64"));
  console.log(`saved ${state}.${viewport.name}.png`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await startBrowser({ portBase: 9800 });
  for (const viewport of VIEWPORTS) {
    for (const [state, action] of Object.entries(THREAD_STATES)) {
      await capture(browser, viewport, state, { prepare: "localStorage.clear(); window.__testApi.openThread('t1')", action, scrollToTop: true });
    }
    for (const [state, action] of Object.entries(LIST_STATES)) {
      await capture(browser, viewport, state, { prepare: "localStorage.clear(); window.__testApi.resetApp(); window.__testApi.navigate({ folder: 'inbox' })", action, scrollToTop: false });
    }
  }
  process.exit(0);
})().catch((error) => { console.error(error.message); process.exit(1); });
