/*
 * Minimal headless-Chrome driver over the DevTools protocol, with no dependencies.
 * Needs Node 22+ (global WebSocket) and a local Chrome or Chromium; set CHROME to point at a specific binary.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const found = process.env.CHROME || CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome not found. Install Google Chrome or set CHROME=/path/to/chrome");
  return found;
}

async function startBrowser({ portBase = 9300 } = {}) {
  const port = portBase + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "thread-e2e-"));
  const chrome = spawn(findChrome(), [
    "--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "--allow-file-access-from-files", "about:blank",
  ], { stdio: "ignore" });

  const close = () => { try { chrome.kill("SIGKILL"); } catch { /* already gone */ } fs.rmSync(profile, { recursive: true, force: true }); };
  process.on("exit", close);

  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
    if (!target) await sleep(200);
  }
  if (!target) { close(); throw new Error("Chrome did not start"); }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

  let nextId = 0;
  const pending = new Map();
  const consoleProblems = [];
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params.exceptionDetails;
      consoleProblems.push("exception: " + ((detail.exception && detail.exception.description) || detail.text));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleProblems.push("console.error: " + msg.params.args.map((a) => a.value || a.description).join(" ").slice(0, 300));
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");

  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return reply.result && reply.result.result ? reply.result.result.value : undefined;
  };
  const setViewport = ({ width, height, mobile }) =>
    send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const navigate = async (url) => { await send("Page.navigate", { url: "about:blank" }); await send("Page.navigate", { url }); };

  return { send, evaluate, setViewport, navigate, consoleProblems, close };
}

module.exports = { startBrowser, sleep };
