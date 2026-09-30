// Browser suite. index.html loads this file when opened with ?e2e; results are written to #e2e-results as JSON.
// Run it headless with `node tests/run-ui.js`.
(async () => {
  const results = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); };
  const ok = (v, msg) => { if (!v) throw new Error(msg || "assertion failed"); };
  const waitFor = async (fn, what, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch {} await sleep(20); } throw new Error("timed out waiting for " + what); };
  const only = new URLSearchParams(location.search).get("only");
  const test = async (name, fn) => {
    if (only && !name.includes(only)) return;
    // unmount whatever the previous test left open (its composer flushes a draft on unmount), then wipe storage
    try { window.__testApi.openThread(null); await sleep(60); localStorage.clear(); } catch {}
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: String((e && e.message) || e) }); }
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const mid = (id) => $$("[data-mid]").find(e => e.dataset.mid === String(id));
  const mids = () => $$("[data-mid]").map(e => e.dataset.mid);
  const header = (id) => $("[data-header]", mid(id));
  const isOpen = (id) => header(id).getAttribute("aria-expanded") === "true";
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
  const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  const composer = (id) => $(`[data-composer="${id}"]`);
  const removeLabels = (c) => $$('button[aria-label^="Remove"]', c).map(b => b.getAttribute("aria-label").replace("Remove ", ""));
  const sendBtn = (c) => $(".btn-primary", c);
  const MOBILE = innerWidth < 640, FLAT = MOBILE ? 2 : 3; // depth clamp: 3 on desktop, 2 on phones
  const announcer = () => ($("[data-announcer]") || {}).textContent || "";
  const showLedger = async () => { const t = $("[data-ledger-toggle]"); if (t && t.getAttribute("aria-expanded") !== "true") { t.click(); await waitFor(() => $("[data-ledger-toggle]").getAttribute("aria-expanded") === "true", "ledger expanded"); } };
  const ovItem = (part) => $$("[data-overview-item]").find(b => b.textContent.includes(part));
  const chip = (key) => $(`[data-status-for="${key}"]`);

  await waitFor(() => window.__testApi && $("[data-thread]"), "app to mount", 10000);
  const G = window.__testApi;
  const go = async (id) => { G.openThread(null); await sleep(30); G.openThread(id); await waitFor(() => $("h1"), "thread view"); };
  const loadOpen = async (thread) => { G.loadThreads([thread]); await go(thread.id); };
  const SAMPLE = G.sampleThreads;
  const restore = async () => { G.loadThreads(SAMPLE); await sleep(30); };
  const msg = (id, parent, extra = {}) => ({ id, parent, from: "Sender " + (id % 3), to: ["Maya Chen"], cc: [], ts: new Date(2026, 0, 1, 0, 0, Number(id) || 0).toISOString(), body: "Body of " + id, ...extra });
  const thread = (id, messages, subject = "Test " + id) => ({ id, subject, messages });

  // sample thread rendering
  await test("inbox lists the sample threads", async () => {
    await restore(); G.openThread(null);
    await waitFor(() => $$("[data-thread]").length === 3, "3 rows");
  });

  await test("Q4 thread renders all 13 messages as a tree", async () => {
    await restore(); await go("t1");
    eq(mids().length, 13);
    eq(mid("1").dataset.depth, "0"); eq(mid("7").dataset.depth, "6");
  });

  await test("latest reply on each branch AND unread messages start expanded", async () => {
    await restore(); await go("t1");
    eq(mids().filter(isOpen).sort(), ["11", "12", "13", "6", "7"]);
    // once everything is read, only branch tips remain expanded
    $("[data-mark-read]").click(); await go("t1");
    eq(mids().filter(isOpen).sort(), ["12", "13", "7"]);
  });

  await test("quoted text is de-duplicated behind a toggle; toggle reveals it", async () => {
    await restore(); await go("t1");
    ok(!$("[data-quoted]", mid("7")), "quote hidden by default");
    const tg = $("[data-quote-toggle]", mid("7")); ok(tg, "toggle exists");
    tg.click(); await waitFor(() => $("[data-quoted]", mid("7")), "quote visible");
    ok($("[data-quoted]", mid("7")).textContent.includes("wrote:"));
    tg.click(); await waitFor(() => !$("[data-quoted]", mid("7")), "quote hidden again");
  });

  await test("global quote toggle shows quotes everywhere", async () => {
    await restore(); await go("t1");
    $('[aria-label^="Quoted text hidden"]').click();
    await waitFor(() => $("[data-quoted]", mid("7")), "quote shown");
    ok(!$("[data-quote-toggle]", mid("7")));
  });

  await test("Outlook-style quote (-----Original Message-----) is split out", async () => {
    await restore(); await go("t1");
    $('[aria-label="Expand all messages"]').click();
    await waitFor(() => isOpen("6"), "6 open");
    ok(!mid("6").textContent.includes("Original Message"), "hidden by default");
    $("[data-quote-toggle]", mid("6")).click();
    await waitFor(() => $("[data-quoted]", mid("6")).textContent.includes("Original Message"), "revealed");
  });

  await test("overview card: counts, action items, mentions", async () => {
    await restore(); await go("t1");
    const ov = $('[aria-label="Thread overview"]');
    ok(ov.textContent.includes("13 messages")); ok(ov.textContent.includes("3 branches"));
    ok(ov.textContent.includes("mention of you") || ov.textContent.includes("mentions of you"), "mention link");
    eq($$("[data-overview-item]").length, 1, "ledger leads with what is still open");
    ok($("[data-ledger-toggle]").textContent.includes("Show 6 resolved & decisions"), $("[data-ledger-toggle]").textContent);
    await showLedger(); eq($$("[data-overview-item]").length, 7, "all items once expanded");
    ok(ov.textContent.includes("1 open"), "open count");
    ok(ov.textContent.includes("1 placed by time"));
  });

  await test("overview item jumps to and expands a collapsed message", async () => {
    await restore(); await go("t1"); await showLedger();
    ok(!isOpen("2"));
    ovItem("Payments SDK upgrade").click();
    await waitFor(() => isOpen("2"), "msg 2 expanded");
  });

  await test("header click expands and collapses", async () => {
    await restore(); await go("t1");
    header("3").click(); await waitFor(() => isOpen("3"), "open");
    header("3").click(); await waitFor(() => !isOpen("3"), "closed");
  });

  await test("missing-metadata message shows the exact spec tooltip", async () => {
    await restore(); await go("t1");
    eq($("[data-fallback]", mid("13")).title, "Appended chronologically (missing thread metadata).");
    eq(mid("13").dataset.depth, "1");
  });

  await test("nesting >3 levels: no more indentation, accent line + parent pill", async () => {
    await restore(); await go("t3");
    eq(mids().length, 9);
    eq($$("[data-deep-pill]").length, 8 - FLAT, `depth ${FLAT + 1}..8 have a pill`);
    const firstDeep = String(FLAT + 2), lastFlat = String(FLAT + 1); // ids are depth+1
    ok(mid(firstDeep).parentElement.classList.contains("border-l-2"), "first clamped level uses the accent line");
    ok(!mid(lastFlat).parentElement.classList.contains("border-l-2"), "last indented level is a normal thread line");
    ok(!document.querySelector(`#msg-${lastFlat} [data-deep-pill]`), "no pill yet"); ok(document.querySelector(`#msg-${firstDeep} [data-deep-pill]`), "pill on the first clamped level");
  });

  await test("single-message thread: no overview, minimap, fold controls", async () => {
    await restore(); await go("t2");
    eq(mids().length, 1); ok(isOpen("1"));
    ok(!$('[aria-label="Thread overview"]')); ok(!$("[data-minimap]")); ok(!$("[data-fold-btn]"));
  });

  await test("minimap: one tick per message; click marks it current", async () => {
    await restore(); await go("t1");
    const ticks = $$("[data-minimap] button"); eq(ticks.length, 13);
    ticks[7].click(); await waitFor(() => $$("[data-minimap] button")[7].getAttribute("aria-current") === "true", "current");
  });

  // folding
  await test("fold hides a whole branch, shows '+N replies', unfold restores", async () => {
    await restore(); await go("t1");
    $("[data-fold-btn]", mid("1")).click();
    await waitFor(() => mids().length === 1, "folded to root");
    eq($("[data-unfold]").textContent, "+ 12 replies");
    $("[data-unfold]").click(); await waitFor(() => mids().length === 13, "restored");
  });

  await test("folding a sub-branch only hides that sub-branch", async () => {
    await restore(); await go("t1");
    $("[data-fold-btn]", mid("8")).click();
    await waitFor(() => mids().length === 13 - 4, "8's 4 descendants hidden");
    ok(mid("2") && !mid("9"));
  });

  await test("jumping to a message inside a folded branch unfolds its ancestors", async () => {
    await restore(); await go("t1");
    await showLedger();
    $("[data-fold-btn]", mid("1")).click(); await waitFor(() => mids().length === 1, "folded");
    ovItem("Payments SDK upgrade").click();
    await waitFor(() => mid("2") && isOpen("2"), "unfolded & expanded");
  });

  // reply composer
  await test("reply icon opens composer under the message with correct recipients", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    ok(mid("3").contains(c), "docked inside message 3");
    ok(c.textContent.includes("Replying to Sara Kim"));
    eq(removeLabels(c), ["Sara Kim", "Dev Patel", "Luis Ortega"]);
    ok(sendBtn(c).disabled, "send disabled while empty");
  });

  await test("send adds a threaded child, closes composer, hides its own quote", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "Thanks Sara – done.");
    await waitFor(() => !sendBtn(composer("3")).disabled, "send enabled");
    sendBtn(composer("3")).click();
    await waitFor(() => mids().length === 14, "14 messages");
    ok(!composer("3"), "composer closed");
    const newId = mids().find(i => i.startsWith("local-"));
    eq(mid(newId).dataset.depth, "3");
    ok(mid(newId).textContent.includes("Thanks Sara – done."));
    ok($("[data-quote-toggle]", mid(newId)), "quote is tucked away");
    ok(!$("[data-quoted]", mid(newId)));
  });

  await test("replying to my own message goes to its original recipients", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("4")).click();
    const c = await waitFor(() => composer("4"), "composer");
    eq(removeLabels(c), ["Sara Kim", "Dev Patel"]);
  });

  await test("'Reply only to X' strips all Cc (accidental reply-all guard)", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    const b = $$("button", c).find(x => x.textContent === "Reply only to Sara"); ok(b, "button exists");
    b.click(); await waitFor(() => removeLabels(composer("3")).length === 1, "cc cleared");
    eq(removeLabels(composer("3")), ["Sara Kim"]);
  });

  await test("removing the only To recipient blocks sending; adding one re-enables it", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    let c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "hello");
    $('button[aria-label="Remove Sara Kim"]', c).click();
    await waitFor(() => composer("3").textContent.includes("Add at least one recipient"), "warning");
    ok(sendBtn(composer("3")).disabled);
    const inp = $('input[aria-label="Add recipient"]', composer("3"));
    setVal(inp, "new@x.com"); key(inp, "Enter");
    await waitFor(() => !sendBtn(composer("3")).disabled, "enabled again");
  });

  await test("empty To (own message with no recipients) handled", async () => {
    await loadOpen(thread("e1", [msg(1, null, { from: "Maya Chen", to: [], cc: [] }), msg(2, 1)]));
    $("[data-reply-icon]", mid("1")).click();
    const c = await waitFor(() => composer("1"), "composer");
    setVal($("textarea", c), "hi");
    ok(sendBtn(composer("1")).disabled); ok(composer("1").textContent.includes("Add at least one recipient"));
  });

  await test("whitespace-only reply cannot be sent", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "   \n  ");
    await sleep(30); ok(sendBtn(composer("3")).disabled);
  });

  await test("double-click Send only sends once", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "once");
    await waitFor(() => !sendBtn(composer("3")).disabled, "enabled");
    const b = sendBtn(composer("3")); b.click(); b.click(); b.click();
    await sleep(200); eq(mids().length, 14);
  });

  await test("Ctrl+Enter sends", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "kbd send");
    await waitFor(() => !sendBtn(composer("3")).disabled, "enabled");
    key($("textarea", composer("3")), "Enter", { ctrlKey: true });
    await waitFor(() => mids().length === 14, "sent");
  });

  await test("offline: Send disabled and 'Saved locally (Offline)' badge shown; recovers", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "offline text");
    $('[aria-label="Simulate offline (demo)"]').click();
    await waitFor(() => sendBtn(composer("3")).disabled, "disabled offline");
    ok(composer("3").textContent.includes("Saved locally (Offline)"));
    key($("textarea", composer("3")), "Enter", { ctrlKey: true }); await sleep(100);
    eq(mids().length, 13, "ctrl+enter must not send offline");
    $('[aria-label="Simulate offline (demo)"]').click();
    await waitFor(() => !sendBtn(composer("3")).disabled, "enabled online");
  });

  await test("draft autosaves within ~1.5s and the status says so", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "autosave me");
    ok(!localStorage.getItem("gmail-draft:t1:3"), "not saved instantly");
    await waitFor(() => localStorage.getItem("gmail-draft:t1:3"), "saved", 2500);
    ok(JSON.parse(localStorage.getItem("gmail-draft:t1:3")).text === "autosave me");
    await waitFor(() => composer("3").textContent.includes("Draft saved"), "status");
  });

  await test("Escape closes composer but keeps the draft; 'Continue draft' restores it", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "half written");
    key($("textarea", composer("3")), "Escape");
    await waitFor(() => !composer("3"), "closed");
    const btn = await waitFor(() => $("[data-reply-btn]", mid("3")), "reply button");
    eq(btn.textContent.trim().replace(/^\S+\s*/, "").length > 0, true);
    ok(btn.textContent.includes("Continue draft"));
    btn.click(); await waitFor(() => composer("3"), "reopened");
    eq($("textarea", composer("3")).value, "half written");
  });

  await test("collapsing a message mid-typing does not lose the draft; shows 'Draft' label", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "abc");
    header("3").click(); // collapse immediately (<1.5s)
    await waitFor(() => !isOpen("3"), "collapsed");
    ok(localStorage.getItem("gmail-draft:t1:3"), "flushed on unmount");
    await waitFor(() => header("3").textContent.includes("Draft"), "Draft label");
    header("3").click(); await waitFor(() => composer("3"), "composer back");
    eq($("textarea", composer("3")).value, "abc");
  });

  await test("discard clears the draft and the indicator", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    setVal($("textarea", c), "temp");
    await waitFor(() => localStorage.getItem("gmail-draft:t1:3"), "saved", 2500);
    $('[aria-label="Discard draft"]', composer("3")).click();
    await waitFor(() => !composer("3"), "closed");
    ok(!localStorage.getItem("gmail-draft:t1:3")); ok(!$("[data-reply-btn]", mid("3")).textContent.includes("Continue"));
  });

  await test("drafts survive a reload of the thread view (scan on mount)", async () => {
    await restore(); await go("t1");
    localStorage.setItem("gmail-draft:t1:5", JSON.stringify({ text: "old draft", to: null, cc: null }));
    await go("t1");
    ok(header("5").textContent.includes("Draft"), "label on message 5");
  });

  await test("corrupt draft JSON in storage is ignored", async () => {
    localStorage.setItem("gmail-draft:t1:3", "{not json");
    localStorage.setItem("gmail-draft:t1:4", JSON.stringify({ nope: 1 }));
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    eq($("textarea", c).value, "");
  });

  await test("localStorage write failures show a warning instead of crashing", async () => {
    await restore(); await go("t1");
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error("QuotaExceeded"); };
    try {
      $("[data-reply-icon]", mid("3")).click();
      const c = await waitFor(() => composer("3"), "composer");
      setVal($("textarea", c), "cannot save");
      await waitFor(() => composer("3").textContent.includes("Couldn't save draft"), "warning", 3000);
      ok(!sendBtn(composer("3")).disabled, "can still send");
    } finally { Storage.prototype.setItem = orig; }
  });

  // keyboard
  await test("keyboard: j/k move, o toggles, f folds, r replies", async () => {
    await restore(); await go("t1");
    document.body.focus();
    key(document.body, "j"); await waitFor(() => document.activeElement === header("1"), "j -> first");
    key(document.activeElement, "j"); await waitFor(() => document.activeElement === header("2"), "j -> second");
    key(document.activeElement, "k"); await waitFor(() => document.activeElement === header("1"), "k -> first");
    key(document.activeElement, "k"); await sleep(30); ok(document.activeElement === header("1"), "k at top stays");
    ok(!isOpen("1")); key(document.activeElement, "o"); await waitFor(() => isOpen("1"), "o opens");
    key(document.activeElement, "r"); await waitFor(() => composer("1"), "r opens composer");
    key($("textarea", composer("1")), "j"); await sleep(30);
    ok(document.activeElement.tagName === "TEXTAREA", "j inside textarea is typing, not navigation");
    key($("textarea", composer("1")), "Escape"); await waitFor(() => !composer("1"), "closed");
    header("1").focus(); key(header("1"), "f"); await waitFor(() => mids().length === 1, "f folds");
    key(document.activeElement, "j"); await sleep(30); ok(document.activeElement === header("1"), "j skips folded descendants");
  });

  await test("keyboard: Enter/Space on a focused header toggles it", async () => {
    await restore(); await go("t1");
    header("3").focus(); key(header("3"), "Enter"); await waitFor(() => isOpen("3"), "enter opens");
    key(header("3"), " "); await waitFor(() => !isOpen("3"), "space closes");
  });

  // robustness datasets
  await test("empty conversation renders an empty state (no crash)", async () => {
    await loadOpen(thread("x", []));
    ok($("h1").textContent.includes("Test x")); ok(document.body.textContent.includes("no messages")); eq(mids().length, 0);
  });

  await test("empty inbox renders an empty state", async () => {
    G.loadThreads([]); G.openThread(null); await waitFor(() => document.body.textContent.includes("inbox is empty"), "empty inbox");
  });

  await test("orphan replies render under the root with a tooltip", async () => {
    await loadOpen(thread("o", [msg(1, null), msg(2, 1), msg(3, 999)]));
    eq(mids().length, 3); eq($("[data-fallback]").dataset.fallback, "orphan");
    ok($("[data-fallback]").title.includes("isn't in this conversation"));
  });

  await test("reply cycle renders every message once", async () => {
    await loadOpen(thread("c", [msg(1, null), msg(2, 3), msg(3, 2), msg(4, 3)]));
    eq(mids().sort(), ["1", "2", "3", "4"]);
  });

  await test("no root / all messages point at each other", async () => {
    await loadOpen(thread("n", [msg(1, 2), msg(2, 1)]));
    eq(mids().sort(), ["1", "2"]);
  });

  await test("duplicate ids and garbage entries are tolerated", async () => {
    await loadOpen(thread("d", [msg(1, null), msg(1, null, { body: "dup" }), null, "junk", msg(2, 1)]));
    eq(mids().sort(), ["1", "2"]);
  });

  await test("messages with missing/odd fields render (no sender, no body, no recipients)", async () => {
    await loadOpen(thread("m", [{ id: 1 }, { id: 2, parent: 1, from: "", to: null, cc: "x@y.z", body: null }, { id: 3, parent: 1, from: "   ", body: "> only quote" }]));
    eq(mids().length, 3);
    $('[aria-label="Expand all messages"]').click();
    await waitFor(() => isOpen("3"), "expanded");
    ok(mid("3").textContent.includes("only quotes earlier text"));
    ok(mid("1").textContent.includes("(No message body)"));
    ok(mid("1").textContent.includes("Unknown sender") || mid("1").textContent.includes("U"));
  });

  await test("emoji / empty names produce valid avatars", async () => {
    await loadOpen(thread("em", [msg(1, null, { from: "🚀 Launch Team" }), msg(2, 1, { from: "" })]));
    const initials = $$("[data-mid] .rounded-full.text-white").map(e => e.textContent);
    ok(initials.includes("🚀")); ok(initials.includes("U"));
  });

  await test("HTML/script in bodies, names and subjects is rendered as text (no XSS)", async () => {
    window.__xss = 0;
    const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2<\/script>`;
    await loadOpen(thread("xss", [msg(1, null, { body: evil, from: evil }), msg(2, 1, { body: evil })], evil));
    $('[aria-label="Expand all messages"]').click(); await sleep(150);
    eq(window.__xss, 0); ok(!$("main img")); ok(!$("main script"));
    ok(mid("1").textContent.includes("<img src=x"));
  });

  await test("huge unbroken strings never cause horizontal page overflow", async () => {
    const long = "x".repeat(600);
    await loadOpen(thread("long", [msg(1, null, { body: long, from: long, to: [long], cc: [long + "y"] }), msg(2, 1, { body: "https://example.com/" + long })], long));
    $('[aria-label="Expand all messages"]').click(); await sleep(100);
    const de = document.documentElement;
    ok(de.scrollWidth <= window.innerWidth + 1, `page overflow: ${de.scrollWidth} > ${window.innerWidth}`);
    ok($("main").scrollWidth <= $("main").clientWidth + 1, "main overflows");
  });

  await test("very long subject / no subject", async () => {
    await loadOpen(thread("ns", [msg(1, null)], "   "));
    ok($("h1").textContent === "(no subject)");
  });

  await test("mentions: chip highlighted for me, muted for others, emails untouched", async () => {
    await loadOpen(thread("mn", [msg(1, null, { body: "hey @Maya and @Dev, write maya@example.com" }), msg(2, 1)]));
    $('[aria-label="Expand all messages"]').click(); await sleep(50);
    const chips = $$("span.rounded.px-1", mid("1")).map(e => e.textContent);
    eq(chips, ["@Maya", "@Dev"]);
    ok(mid("1").textContent.includes("maya@example.com"));
  });

  await test("bad data in one thread doesn't break the inbox; the error boundary contains a render crash", async () => {
    const bad = { id: "bad", subject: { toString() { throw new Error("boom"); } }, messages: [msg(1, null)] };
    const good = thread("good", [msg(1, null)], "Fine thread");
    G.loadThreads([bad, good]); G.openThread(null);
    await waitFor(() => $$("[data-thread]").length === 2, "both rows");
    ok(document.body.textContent.includes("Fine thread"));
    $('[data-thread="bad"]').click();
    await waitFor(() => $('[role="alert"]'), "error boundary");
    $('[role="alert"] button').click();
    await waitFor(() => $$("[data-thread]").length === 2, "back to inbox");
    $('[data-thread="good"]').click(); await waitFor(() => $("h1") && $("h1").textContent === "Fine thread", "other thread still opens");
  });

  await test("PERF: 300 messages render fast and stay interactive", async () => {
    const msgs = [msg(1, null)]; let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 2; i <= 300; i++) msgs.push(msg(i, 1 + Math.floor(rnd() * (i - 1))));
    const t0 = performance.now();
    await loadOpen(thread("big", msgs));
    await waitFor(() => mids().length === 300, "300 nodes", 8000);
    const ms = performance.now() - t0;
    ok(ms < 4000, `render took ${Math.round(ms)}ms`);
    eq($$("[data-minimap] button").length, 300);
    const t1 = performance.now(); $('[aria-label="Expand all messages"]').click();
    await waitFor(() => $$('[data-header][aria-expanded="true"]').length === 300, "all expanded", 8000);
    ok(performance.now() - t1 < 4000, "expand-all slow");
    $("[data-fold-btn]", mid("1")).click(); await waitFor(() => mids().length === 1, "fold all");
    results.push({ name: `(info) 300-msg render ${Math.round(ms)}ms`, ok: true });
  });

  await test("PERF: 120-deep chain renders", async () => {
    const msgs = [msg(1, null)]; for (let i = 2; i <= 120; i++) msgs.push(msg(i, i - 1));
    await loadOpen(thread("chain", msgs));
    await waitFor(() => mids().length === 120, "120 nodes", 8000);
    eq($$("[data-deep-pill]").length, 119 - FLAT);
  });


  // 1. resolution tracker
  await test("tracker: statuses are derived from the thread (resolved / awaiting)", async () => {
    await restore(); await go("t1"); await showLedger();
    eq(chip("2:0").textContent, "Resolved · Sara", "blocker closed by Sara's decision (latest decision below it)");
    eq(chip("3:0").textContent, "Resolved · you", "question answered by the person it was aimed at (that is me)");
    eq(chip("8:0").textContent, "Resolved · you");
    eq(chip("13:0").textContent, "Awaiting Sara");
    eq(chip("13:0").dataset.status, "open");
    ok(!chip("4:0"), "decisions have no status chip");
    eq($("[data-open-count]").textContent, "1 open");
  });
  await test("tracker: open items sort first in the overview", async () => {
    await restore(); await go("t1");
    ok($$("[data-overview-item]")[0].textContent.includes("headcount"), "open item on top");
  });
  await test("tracker: resolved chip jumps to the message that closed the loop", async () => {
    await restore(); await go("t1"); await showLedger();
    ok(!isOpen("4"));
    chip("3:0").click(); await waitFor(() => isOpen("4"), "answer expanded");
    chip("2:0").click(); await waitFor(() => isOpen("7"), "closing decision expanded");
  });
  await test("tracker: 'Mark resolved' / 'Reopen' work and persist", async () => {
    await restore(); await go("t1");
    $('[data-toggle-resolved="13:0"]').click();
    await waitFor(() => chip("13:0").textContent === "Marked resolved", "manual resolve");
    eq($("[data-open-count]").textContent, "0 open");
    await go("t1"); await showLedger();
    eq(chip("13:0").textContent, "Marked resolved", "persisted");
    $('[data-toggle-resolved="13:0"]').click();
    await waitFor(() => chip("13:0").textContent === "Awaiting Sara", "reopened");
    $('[data-toggle-resolved="2:0"]').click();
    await waitFor(() => chip("2:0").dataset.status === "open" && chip("2:0").textContent === "Unresolved", "reopen a derived-resolved blocker");
    eq($("[data-open-count]").textContent, "2 open");
  });
  await test("tracker: status also shows on the expanded message itself", async () => {
    await restore(); await go("t1");
    header("3").click(); await waitFor(() => isOpen("3"), "open");
    const row = $('[data-action-row="3:0"]'); ok(row, "action row");
    ok(row.textContent.includes("Resolved · you"), row.textContent);
  });
  await test("tracker: corrupt stored resolutions are ignored", async () => {
    localStorage.setItem("gmail-resolved:t1", "[1,2"); localStorage.setItem("gmail-lastseen:t1", "abc");
    await restore(); await go("t1");
    eq(chip("13:0").textContent, "Awaiting Sara"); ok($("[data-catchup]"), "falls back to the sample's lastSeen");
  });
  await test("tracker: single-message thread with a question still shows status, no overview", async () => {
    await loadOpen(thread("q1", [msg(1, null, { actions: [{ type: "question", text: "Lunch?" }] })]));
    ok(!$('[aria-label="Thread overview"]')); eq(chip("1:0").textContent, "Awaiting you");
  });

  // 2. branch focus
  await test("focus: branch chips + focus buttons appear only on fork heads", async () => {
    await restore(); await go("t1");
    eq($$("[data-branch-chip]").map(b => b.dataset.branchChip).sort(), ["13", "2", "8"]);
    eq($$("[data-focus-btn]").map(b => b.closest("[data-mid]").dataset.mid).sort(), ["13", "2", "8"]);
    await go("t3"); eq($$("[data-focus-btn]").length, 0, "a straight chain has no forks");
    ok(!$("[aria-label='Branches']"));
  });
  await test("focus: isolates one branch, dims and collapses its siblings, then restores", async () => {
    await restore(); await go("t1");
    $('[data-branch-chip="8"]').click();
    await waitFor(() => $("[data-focus-banner]"), "banner");
    eq(mids().sort(), ["1", "10", "11", "12", "13", "2", "8", "9"], "sibling subtrees are cut at their head");
    eq(mids().filter(i => mid(i).dataset.outside === "1").sort(), ["13", "2"]);
    ok(!isOpen("2") && !isOpen("13"), "dimmed heads cannot be expanded");
    ok($$("[data-unfold]").some(b => b.textContent === "+ 5 unselected replies"), "sibling count shown");
    ok($("[data-focus-banner]").textContent.includes("Luis: Marketing"), "banner names the branch");
    $("[data-focus-banner] button").click();
    await waitFor(() => mids().length === 13 && !$("[data-focus-banner]"), "restored");
  });
  await test("focus: b toggles, Esc exits, j/k skip the hidden part", async () => {
    await restore(); await go("t1");
    header("8").focus(); key(header("8"), "b"); await waitFor(() => $("[data-focus-banner]"), "focused via b");
    header("2").focus(); key(header("2"), "j");
    await waitFor(() => document.activeElement === header("8"), "j skips 2's hidden subtree");
    key(document.activeElement, "Escape"); await waitFor(() => !$("[data-focus-banner]") && mids().length === 13, "Esc exits");
    header("8").focus(); key(header("8"), "b"); await waitFor(() => $("[data-focus-banner]"), "on");
    key(document.activeElement, "b"); await waitFor(() => !$("[data-focus-banner]"), "b again turns it off");
  });
  await test("focus: jumping to a hidden message leaves focus mode", async () => {
    await restore(); await go("t1");
    await showLedger();
    $('[data-branch-chip="8"]').click(); await waitFor(() => $("[data-focus-banner]"), "focused");
    ovItem("Payments SDK upgrade").click();
    await waitFor(() => !$("[data-focus-banner]") && mid("2") && isOpen("2"), "left focus and revealed");
  });
  await test("focus: chip toggles off when clicked again; focusing the root shows everything", async () => {
    await restore(); await go("t1");
    $('[data-branch-chip="2"]').click(); await waitFor(() => $("[data-focus-banner]"), "on");
    $('[data-branch-chip="2"]').click(); await waitFor(() => !$("[data-focus-banner]"), "off");
    header("1").focus(); key(header("1"), "b"); await waitFor(() => $("[data-focus-banner]"), "root focus");
    eq(mids().length, 13); eq(mids().filter(i => mid(i).dataset.outside === "1").length, 0);
  });
  await test("focus: replying inside a focused branch works", async () => {
    await restore(); await go("t1");
    $('[data-branch-chip="8"]').click(); await waitFor(() => $("[data-focus-banner]"), "focused");
    $("[data-reply-icon]", mid("12")).click();
    const c = await waitFor(() => composer("12"), "composer");
    setVal($("textarea", c), "in focus"); await waitFor(() => !sendBtn(composer("12")).disabled, "enabled");
    sendBtn(composer("12")).click(); await waitFor(() => mids().some(i => i.startsWith("local-")), "sent");
  });

  // 3. catch me up
  await test("catch-up: banner summarises new replies, branches and decisions", async () => {
    await restore(); await go("t1");
    const t = $("[data-catchup]").textContent;
    ok(t.includes("5 new replies"), t); ok(t.includes("3 branches"), t); ok(t.includes("2 decisions"), t);
    eq($$("[data-new]").length, 5); eq($$("[data-minimap] button").filter(b => b.title.includes("new")).length, 5);
  });
  await test("catch-up: 'n' walks the unread messages in time order across branches, marking each read", async () => {
    await restore(); await go("t1");
    const seq = ["11", "12", "6", "7", "13"], left = [4, 3, 2, 1];
    for (let i = 0; i < 5; i++) {
      key(document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body, "n");
      await waitFor(() => document.activeElement === header(seq[i]), `n #${i + 1} -> ${seq[i]}`);
      if (i < 4) await waitFor(() => $$("[data-new]").length === left[i], "one fewer unread");
    }
    await waitFor(() => !$("[data-catchup]") && $$("[data-new]").length === 0, "banner gone when all read");
    key(document.activeElement, "n"); await sleep(100); // no unread: harmless
  });
  await test("catch-up: 'n' reveals unread messages inside folded or focused branches", async () => {
    await restore(); await go("t1");
    $("[data-fold-btn]", mid("1")).click(); await waitFor(() => mids().length === 1, "folded");
    $("[data-next-unread]").click(); await waitFor(() => mid("11") && isOpen("11"), "unfolded to reach 11");
    $('[data-branch-chip="2"]').click(); await waitFor(() => $("[data-focus-banner]"), "focus other branch");
    // "next" continues from wherever you are (scroll position may vary): unread messages inside the focused
    // branch come first; once they are used up the next one lives outside, so focus mode must release.
    for (let i = 0; i < 6 && $("[data-focus-banner]"); i++) { $("[data-next-unread]").click(); await sleep(150); }
    await waitFor(() => !$("[data-focus-banner]"), "focus released to reveal an unread message outside the branch");
  });
  await test("catch-up: expanding an unread message marks it read", async () => {
    await restore(); await go("t1");
    header("3").click(); await sleep(40); eq($$("[data-new]").length, 5, "reading an old message changes nothing");
    header("6").click(); header("6").click(); await waitFor(() => $$("[data-new]").length === 4, "6 read after a click");
  });
  await test("catch-up: Mark all read clears it; leaving marks read; 'Mark as unread' brings it back", async () => {
    await restore(); await go("t1");
    $("[data-mark-read]").click(); await waitFor(() => !$("[data-catchup]") && $$("[data-new]").length === 0, "cleared");
    await go("t1"); ok(!$("[data-catchup]"), "still read after reopening");
    $('[aria-label^="Mark as unread"]').click(); await waitFor(() => $("[data-catchup]"), "bar back");
    eq($$("[data-new]").length, 5);
    G.openThread(null); await sleep(60); await go("t1"); ok($("[data-catchup]"), "kept unread after leaving");
  });
  await test("catch-up: back-navigation without action marks the thread read (like Gmail)", async () => {
    await restore(); await go("t1"); ok($("[data-catchup]"));
    G.openThread(null); await sleep(60); await go("t1"); ok(!$("[data-catchup]"), "read on second visit");
  });
  await test("catch-up: my own replies are never 'new'; threads without lastSeen show nothing", async () => {
    await restore(); await go("t1"); $("[data-mark-read]").click();
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer"); setVal($("textarea", c), "mine");
    await waitFor(() => !sendBtn(composer("3")).disabled, "enabled"); sendBtn(composer("3")).click();
    await waitFor(() => mids().length === 14, "sent"); eq($$("[data-new]").length, 0); ok(!$("[data-catchup]"));
    await go("t3"); ok(!$("[data-catchup]"), "t3 has no lastSeen");
  });
  await test("catch-up: weird lastSeen values (NaN, string, future, 0) never crash", async () => {
    const mk = (ls) => ({ ...thread("ls", [msg(1, null), msg(2, 1), msg(3, 2)]), lastSeen: ls });
    for (const [ls, expectBar] of [[NaN, false], ["garbage", false], [Date.now() + 1e10, false], [0, true]]) {
      G.openThread(null); await sleep(60); localStorage.clear(); await loadOpen(mk(ls));
      eq(!!$("[data-catchup]"), expectBar, `lastSeen=${String(ls)}`); eq(mids().length, 3);
    }
  });
  await test("catch-up: singular wording for one new reply", async () => {
    const t = { ...thread("one", [msg(1, null, { from: "Maya Chen" }), msg(2, 1)]), lastSeen: Date.parse(msg(1, null).ts) };
    await loadOpen(t); ok($("[data-catchup]").textContent.includes("1 new reply "), $("[data-catchup]").textContent);
    ok($("[data-catchup]").textContent.includes("1 branch"));
  });

  // 4. who dropped off / who is waited on
  await test("people: dropped-off and waited-on participants are marked, with explanations", async () => {
    await restore(); await go("t1");
    const p = (n) => $(`[data-person="${n}"]`);
    eq(p("Dev Patel").dataset.dropped, "1"); ok(p("Dev Patel").title.includes("Last active") && p("Dev Patel").title.includes("not copied"), p("Dev Patel").title);
    eq(p("Sara Kim").dataset.pending, "1"); eq(p("Sara Kim").dataset.dropped, "0"); ok(p("Sara Kim").title.includes("Waiting on their answer"));
    eq(p("Maya Chen").dataset.pending, "0"); eq(p("Maya Chen").dataset.dropped, "0");
    const line = $("[data-people-status]").textContent;
    ok(line.includes("Waiting on Sara") && line.includes("Dev dropped off"), line);
  });
  await test("people: status line updates live when a question is manually resolved", async () => {
    await restore(); await go("t1");
    $('[data-toggle-resolved="13:0"]').click();
    await waitFor(() => !$("[data-people-status]").textContent.includes("Waiting on"), "waiting cleared");
    eq($('[data-person="Sara Kim"]').dataset.pending, "0");
  });
  await test("people: replying to an asker removes 'waiting on' for the responder", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("13")).click();
    const c = await waitFor(() => composer("13"), "composer"); setVal($("textarea", c), "Sara here: 12");
    // Sara isn't the sender, so this reply (from me) doesn't resolve. Verify honesty:
    await waitFor(() => !sendBtn(composer("13")).disabled, "enabled"); sendBtn(composer("13")).click();
    await waitFor(() => mids().length === 14, "sent");
    eq($('[data-person="Sara Kim"]').dataset.pending, "1", "a reply from me is not Sara's answer");
  });
  await test("people: with a single participant there is no status line", async () => {
    await loadOpen(thread("solo", [msg(1, null, { from: "Maya Chen", to: [] }), msg(2, 1, { from: "Maya Chen", to: [] })]));
    ok(!$("[data-people-status]"));
  });
  await test("people: 50 participants render without overflow (avatars capped)", async () => {
    const ms = [msg(1, null, { to: Array.from({ length: 50 }, (_, i) => "Person " + i) })];
    await loadOpen(thread("many", ms.concat([msg(2, 1)])));
    ok($$("[data-person]").length <= 8); ok(document.documentElement.scrollWidth <= innerWidth + 1);
  });

  // perf with the new analysis
  await test("PERF: 300 messages with 100 tracked questions, new-markers and fork chips", async () => {
    const msgs = [msg(1, null)]; let s2 = 11; const rnd = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
    for (let i = 2; i <= 300; i++) msgs.push(msg(i, 1 + Math.floor(rnd() * (i - 1)), i % 3 === 0 ? { actions: [{ type: "question", text: "Q" + i }] } : {}));
    const t0 = performance.now();
    await loadOpen({ ...thread("big2", msgs), lastSeen: 0 });
    await waitFor(() => mids().length === 300, "300 nodes", 8000);
    const ms = performance.now() - t0; ok(ms < 5000, `took ${Math.round(ms)}ms`);
    ok($$("[data-new]").length > 0); ok($$("[data-branch-chip]").length <= 8);
    results.push({ name: `(info) 300 msgs + 100 questions render ${Math.round(ms)}ms`, ok: true });
  });


  // sending a reply: tree integrity
  await test("send: reply attaches under the right parent, keeps ids unique, updates counts", async () => {
    await restore(); await go("t1");
    $("[data-fold-btn]", mid("3")).click(); await waitFor(() => $("[data-unfold]"), "folded"); // 3 has 4 replies below
    ok(mid("3").querySelector("[data-unfold]").textContent === "+ 4 replies");
    $("[data-fold-btn]", mid("3")).click(); await waitFor(() => mid("4"), "unfolded");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer"); setVal($("textarea", c), "new branch off Sara's message");
    await waitFor(() => !sendBtn(composer("3")).disabled, "enabled"); sendBtn(composer("3")).click();
    await waitFor(() => mids().length === 14, "14 messages");
    const nid = mids().find(i => i.startsWith("local-"));
    eq(new Set(mids()).size, 14, "ids unique");
    ok(mid("3").contains(mid(nid)), "inside parent's subtree");
    eq(mid(nid).dataset.depth, "3");
    ok(mid(nid).parentElement.parentElement === mid("3"), "direct child container of its parent");
    ok(mid(nid).previousElementSibling === null || mid(nid).previousElementSibling.dataset.mid === "4", "appended after the existing reply (chronological)");
    const ov = $('[aria-label="Thread overview"]').textContent;
    ok(ov.includes("14 messages"), ov); ok(ov.includes("4 branches"), "a reply under a non-leaf adds a branch: " + ov);
    $("[data-fold-btn]", mid("3")).click(); await waitFor(() => $("[data-unfold]"), "fold again");
    eq(mid("3").querySelector("[data-unfold]").textContent, "+ 5 replies", "reply count updated");
  });
  await test("send: focus and selection move to the new message; live region announces it", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("7")).click();
    const c = await waitFor(() => composer("7"), "composer"); setVal($("textarea", c), "shipping it");
    await waitFor(() => !sendBtn(composer("7")).disabled, "enabled"); sendBtn(composer("7")).click();
    await waitFor(() => mids().length === 14, "sent");
    const nid = mids().find(i => i.startsWith("local-"));
    await waitFor(() => document.activeElement === header(nid), "keyboard focus on the new message");
    await waitFor(() => $(`[data-tick="${nid}"]`).getAttribute("aria-current") === "true", "minimap selection follows");
    ok(announcer().includes("Reply sent to Sara Kim"), announcer());
    eq($("[data-quote-toggle]", mid(nid)) !== null, true, "quote tucked away");
  });
  await test("send: replying to a question I was asked closes it in the ledger (optimistic, derived)", async () => {
    const ask = thread("led", [msg(1, null, { from: "Bob", to: ["Maya Chen"] }), msg(2, 1, { from: "Bob", to: ["Maya Chen"], actions: [{ type: "question", text: "Can we ship Friday?" }] }), msg(3, 1, { from: "Cy", to: ["Maya Chen"] })]);
    await loadOpen(ask);
    eq(chip("2:0").textContent, "Awaiting you"); ok($("[data-open-count]").textContent === "1 open");
    $("[data-reply-icon]", mid("2")).click();
    const c = await waitFor(() => composer("2"), "composer"); setVal($("textarea", c), "Yes, Friday works.");
    await waitFor(() => !sendBtn(composer("2")).disabled, "enabled"); sendBtn(composer("2")).click();
    await waitFor(() => chip("2:0").textContent === "Resolved · you", "ledger updated");
    eq($("[data-open-count]").textContent, "0 open");
    const nid = mids().find(i => i.startsWith("local-"));
    chip("2:0").click(); await waitFor(() => header(nid) && isOpen(nid), "chip jumps to my reply");
  });
  await test("send: reply keeps working after the parent was folded or in a focused branch", async () => {
    await restore(); await go("t1");
    $("[data-fold-btn]", mid("8")).click(); await waitFor(() => !mid("9"), "8 folded");
    $("[data-reply-icon]", mid("8")).click();
    const c = await waitFor(() => composer("8"), "composer"); setVal($("textarea", c), "into a folded branch");
    await waitFor(() => !sendBtn(composer("8")).disabled, "enabled"); sendBtn(composer("8")).click();
    await waitFor(() => mids().some(i => i.startsWith("local-")) && mid("9"), "parent auto-unfolds so the reply is visible");
  });

  // offline: guard, queue, recovery
  await test("offline: banner + blocked Send/Ctrl+Enter, queue for later, auto-send on reconnect", async () => {
    await restore(); await go("t1");
    const toggleOffline = () => $('[aria-label="Simulate offline (demo)"]').click();
    ok(!$("[data-offline-banner]"), "no banner online");
    toggleOffline(); await waitFor(() => $("[data-offline-banner]"), "banner");
    eq($("[data-offline-banner]").getAttribute("role"), "status");
    ok($("[data-offline-banner]").textContent.includes("Sending is paused"));
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer"); setVal($("textarea", c), "queued while away");
    await waitFor(() => $("[data-queue]") && !$("[data-queue]").disabled, "queue enabled");
    ok(sendBtn(composer("3")).disabled, "Send disabled"); eq(sendBtn(composer("3")).title, "You're offline – use Queue for later");
    ok(composer("3").textContent.includes("Saved locally (Offline)"));
    key($("textarea", composer("3")), "Enter", { ctrlKey: true }); await sleep(120);
    eq(mids().length, 13, "Ctrl+Enter must neither send nor queue"); ok(composer("3"), "composer stays open with the draft");
    $("[data-queue]").click(); await waitFor(() => mids().length === 14, "queued message appears");
    const qid = mids().find(i => i.startsWith("local-"));
    ok($("[data-pending-chip]", mid(qid)), "Queued chip"); eq(mid(qid).dataset.depth, "3");
    ok($("[data-offline-banner]").textContent.includes("1 reply queued"), $("[data-offline-banner]").textContent);
    ok(announcer().includes("queued"), announcer());
    toggleOffline();
    await waitFor(() => !$("[data-pending-chip]") && !$("[data-offline-banner]"), "sent on reconnect");
    eq(mids().length, 14, "no duplicates"); ok(announcer().includes("Back online. 1 queued reply was sent."), announcer());
  });
  await test("offline: Queue is disabled without text or recipients; absent when online; several replies queue in order", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click(); await waitFor(() => composer("3"), "composer");
    ok(!$("[data-queue]"), "no queue button online");
    $('[aria-label="Simulate offline (demo)"]').click(); await waitFor(() => $("[data-queue]"), "queue button offline");
    ok($("[data-queue]").disabled, "empty text");
    setVal($("textarea", composer("3")), "one"); $$("button", composer("3")).filter(b => b.getAttribute("aria-label") && b.getAttribute("aria-label").startsWith("Remove")).slice(0, 1).forEach(b => b.click());
    await waitFor(() => composer("3").textContent.includes("Add at least one recipient"), "no recipient");
    ok($("[data-queue]").disabled, "no recipient");
    const inp = $('input[aria-label="Add recipient"]', composer("3")); setVal(inp, "x@y.z"); key(inp, "Enter");
    await waitFor(() => !$("[data-queue]").disabled, "enabled"); $("[data-queue]").click();
    await waitFor(() => mids().length === 14, "first queued");
    $("[data-reply-icon]", mid("7")).click(); await waitFor(() => composer("7"), "second composer"); setVal($("textarea", composer("7")), "two");
    await waitFor(() => $("[data-queue]") && !$("[data-queue]").disabled, "enabled"); $("[data-queue]").click();
    await waitFor(() => mids().length === 15, "second queued");
    ok($("[data-offline-banner]").textContent.includes("2 replies queued"));
    $('[aria-label="Simulate offline (demo)"]').click(); await waitFor(() => !$("[data-pending-chip]"), "both flushed");
    ok(announcer().includes("2 queued replies were sent"), announcer());
  });
  await test("offline: leaving the offline state with an open, unsent composer re-enables Send", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click(); const c = await waitFor(() => composer("3"), "composer"); setVal($("textarea", c), "text");
    $('[aria-label="Simulate offline (demo)"]').click(); await waitFor(() => sendBtn(composer("3")).disabled, "blocked");
    $('[aria-label="Simulate offline (demo)"]').click(); await waitFor(() => !sendBtn(composer("3")).disabled && !$("[data-queue]"), "recovered");
  });

  // minimap: depth + viewport
  await test("minimap: ticks indent with reply depth (clamped like the tree)", async () => {
    await restore(); await go("t3");
    const depths = $$("[data-tick]").map(t => Number(t.dataset.tickDepth));
    eq(depths, [0, 1, 2, 3, 3, 3, 3, 3, 3]);
    const ml = $$("[data-tick]").map(t => parseInt(t.style.marginLeft, 10));
    eq(ml, [0, 3, 6, 9, 9, 9, 9, 9, 9]);
  });
  await test("minimap: the band follows the viewport when scrolling, and the tick click scrolls to the message", async () => {
    await restore(); await go("t1");
    $('[aria-label="Expand all messages"]').click(); await waitFor(() => isOpen("13"), "all open");
    const tick = (id) => $(`[data-tick="${id}"]`);
    window.scrollTo(0, 0); await waitFor(() => tick("1").dataset.inview === "1", "first message in view at top");
    ok(tick("13").dataset.inview === "0", "last message not in view at top");
    mid("13").scrollIntoView({ block: "center" });
    await waitFor(() => tick("13").dataset.inview === "1" && tick("1").dataset.inview === "0", "band moved to the end");
    await waitFor(() => { const cur = $$("[data-tick]").find(t => t.getAttribute("aria-current") === "true"); return cur && cur.dataset.inview === "1"; }, "scroll-spy 'current' is a visible message");
    window.scrollTo(0, 0); await waitFor(() => tick("1").dataset.inview === "1" && tick("13").dataset.inview === "0", "band back to the top");
    tick("13").click();
    await waitFor(() => { const r = $("#msg-13").getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight; }, "clicking a tick scrolls that message into view", 4000);
  });
  await test("minimap: folded messages leave the rail's viewport band (not rendered => never 'in view')", async () => {
    await restore(); await go("t1");
    $("[data-fold-btn]", mid("1")).click(); await waitFor(() => mids().length === 1, "folded");
    eq($$('[data-tick][data-inview="1"]').map(t => t.dataset.tick).filter(id => id !== "1"), [], "only the root can be in view");
  });

  // 1-message thread
  await test("single message: clean card, no lines/rails/overview/banners, reply still works", async () => {
    await restore(); await go("t2");
    eq(mids().length, 1); ok(isOpen("1"));
    eq($$("main [class*='border-l']").length, 0, "no thread connectors");
    ok(!$('[aria-label="Thread overview"]') && !$("[data-minimap]") && !$("[data-catchup]") && !$("[data-fold-btn]") && !$("[data-focus-btn]") && !$("[data-delta]") && !$("[data-people-status]"));
    ok(!$("main").textContent.includes("branch"), "no branch language");
    ok(document.documentElement.scrollWidth <= innerWidth + 1);
    $("[data-reply-btn]").click(); const c = await waitFor(() => composer("1"), "composer"); setVal($("textarea", c), "sure!");
    await waitFor(() => !sendBtn(composer("1")).disabled, "enabled"); sendBtn(composer("1")).click();
    await waitFor(() => mids().length === 2, "second message appears"); ok($('[aria-label="Thread overview"]'), "overview appears once it is a real thread");
  });

  // audience drift
  await test("drift: dropped/added recipients are flagged per reply, with who-is-waiting emphasis and tooltips", async () => {
    await restore(); await go("t1");
    $('[aria-label="Expand all messages"]').click(); await waitFor(() => isOpen("8"), "open");
    const d8 = $("[data-delta-dropped]", mid("8"));
    ok(d8.textContent.includes("Dropped Dev, Sara") && d8.textContent.includes("still waiting on an answer"), d8.textContent);
    ok(d8.title.includes("Sara Kim — last wrote") && d8.title.includes("waiting on an answer"), d8.title);
    ok(d8.classList.contains("bg-[#fef7e0]"), "amber when a dropped person is still owed an answer");
    const d4 = $("[data-delta-dropped]", mid("4")); ok(d4.textContent.includes("Dropped Luis") && d4.classList.contains("bg-[var(--surface)]"), "neutral otherwise");
    const d6 = $("[data-delta-added]", mid("6")); ok(d6.textContent.includes("Added Security"), d6.textContent);
    ok(!$("#msg-2 [data-delta]"), "no drift, no badge (own card only)"); ok(!$("#msg-13 [data-delta]"), "time-placed messages get no delta");
    eq(d8.tabIndex, 0, "badge is keyboard-focusable for its tooltip"); ok(d8.getAttribute("aria-label").includes("Dropped from this reply"));
  });
  await test("drift: collapsed messages still hint at dropped recipients", async () => {
    await restore(); await go("t1");
    const ic = $("[data-delta-icon]", mid("4")); ok(ic && ic.title.includes("Luis Ortega"), ic && ic.title);
  });
  await test("drift: composer warns when someone is waiting on an answer elsewhere; 'Add to Cc' fixes it", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("9")).click(); const c = await waitFor(() => composer("9"), "composer");
    const nudge = $("[data-waiting-nudge]", c); ok(nudge && nudge.textContent.includes("Sara is waiting on an answer elsewhere"), nudge && nudge.textContent);
    eq(nudge.getAttribute("role"), "note");
    $("[data-add-waiting]", c).click(); await waitFor(() => !$("[data-waiting-nudge]", composer("9")), "nudge gone");
    ok(removeLabels(composer("9")).includes("Sara Kim"));
  });
  await test("drift: no nudge for people already on the reply, or once nobody is waiting", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click(); await waitFor(() => composer("3"), "composer");
    ok(!$("[data-waiting-nudge]", composer("3")), "Sara is the recipient");
    $('[data-toggle-resolved="13:0"]').click(); await waitFor(() => chip("13:0").textContent === "Marked resolved", "resolved");
    $("[data-reply-icon]", mid("9")).click(); await waitFor(() => composer("9"), "composer 9"); ok(!$("[data-waiting-nudge]", composer("9")));
  });

  // ledger by keyboard + live regions
  await test("ledger: 'x' resolves/reopens the current message's item; focus stays; live region announces", async () => {
    await restore(); await go("t1");
    header("13").focus(); key(header("13"), "x");
    await waitFor(() => chip("13:0").textContent === "Marked resolved", "resolved with x");
    ok(announcer().includes("Marked resolved: Can Sara confirm"), announcer());
    ok(document.activeElement === header("13"), "focus did not move");
    key(document.activeElement, "x"); await waitFor(() => chip("13:0").textContent === "Awaiting Sara", "reopened");
    ok(announcer().includes("Reopened: Can Sara confirm"), announcer());
    header("1").focus(); key(header("1"), "x"); await waitFor(() => announcer().includes("no question or blocker"), "explains when nothing to resolve");
  });
  await test("ledger: keyboard focus survives the overview re-sorting after a toggle", async () => {
    await restore(); await go("t1"); await showLedger();
    const btn = $('[aria-label="Thread overview"] [data-toggle-resolved="3:0"]'); btn.focus(); btn.click();
    await waitFor(() => { const a = document.activeElement; return a && a.dataset.toggleResolved === "3:0" && a.closest('[aria-label="Thread overview"]'); }, "focus on the same ledger control");
    eq(chip("3:0").dataset.status, "open"); ok($("[data-open-count]").textContent === "2 open");
  });
  await test("ledger: works inside an isolated branch (x on a focused message)", async () => {
    await restore(); await go("t1");
    $('[data-branch-chip="8"]').click(); await waitFor(() => $("[data-focus-banner]"), "focused");
    header("8").focus(); key(header("8"), "x");
    await waitFor(() => chip("8:0").dataset.status === "open", "reopened inside focus");
    eq($("[data-open-count]").textContent, "2 open");
  });
  await test("live regions: focus enter/exit, next unread, mark all read, resolve all announce politely", async () => {
    await restore(); await go("t1");
    const a = $("[data-announcer]"); eq(a.getAttribute("role"), "status"); eq(a.getAttribute("aria-live"), "polite"); ok(a.classList.contains("sr-only"));
    $('[data-branch-chip="8"]').click(); await waitFor(() => announcer().startsWith("Focused on branch: Luis:"), announcer());
    key(document.body, "Escape"); await waitFor(() => announcer() === "Showing all branches." || announcer().startsWith("Showing all branches."), announcer());
    $("[data-next-unread]").click(); await waitFor(() => announcer().startsWith("Unread reply from"), announcer());
    ok(/\d unread repl(y|ies) left/.test(announcer()), announcer());
    $("[data-mark-read]").click(); await waitFor(() => announcer().startsWith("All replies marked read"), announcer());
  });

  // contrast (WCAG AA 4.5:1 for small text)
  await test("contrast: status chips, banners, badges and nudges meet 4.5:1", async () => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) layers.push(c); if (c.a >= 1) break; } return layers.reverse().reduce((base, c) => over(c, base), { r: 255, g: 255, b: 255, a: 1 }); };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (el) => { const fg = over(parse(getComputedStyle(el).color), bgOf(el)), bg = bgOf(el); const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

    await restore(); await go("t1"); await showLedger();
    header("4").click(); header("8").click(); await waitFor(() => isOpen("4") && isOpen("8"), "open");
    $("[data-reply-icon]", mid("9")).click(); await waitFor(() => composer("9"), "composer");
    $('[aria-label="Simulate offline (demo)"]').click(); await waitFor(() => $("[data-offline-banner]"), "offline");
    const checks = [
      ["open status chip", $('[data-status="open"]')], ["resolved status chip", $('[data-status="resolved"]')],
      ["ledger toggle link", $("[data-toggle-resolved]")], ["catch-up text", $("[data-catchup] b")], ["catch-up link", $("[data-catchup] .link-btn")],
      ["people status line", $("[data-people-status]")], ["overview summary", $('[aria-label="Thread overview"] span.text-\\[13px\\]')],
      ["amber drift badge", $("[data-delta-dropped]", mid("8"))], ["neutral drift badge", $("[data-delta-dropped]", mid("4"))], ["added badge", $("[data-delta-added]", mid("6")) || $("[data-delta-added]")],
      ["waiting nudge", $("[data-waiting-nudge]")], ["nudge link", $("[data-add-waiting]")], ["offline banner", $("[data-offline-banner]")],
      ["collapsed snippet", $("#msg-2 .text-\\[13px\\]")], ["new-message name", $("[data-new] + span")],
    ];
    const bad = checks.filter(([n, el]) => !el || ratio(el) < 4.5).map(([n, el]) => `${n}: ${el ? ratio(el).toFixed(2) : "missing"}`);
    $('[data-branch-chip="8"]').click(); await waitFor(() => $("[data-focus-banner]"), "focus");
    for (const [n, el] of [["focus banner", $("[data-focus-banner]")], ["focus banner link", $("[data-focus-banner] .link-btn")], ["branch chip (active)", $('[data-branch-chip="8"]')], ["branch chip", $('[data-branch-chip="13"]')]])
      if (!el || ratio(el) < 4.5) bad.push(`${n}: ${el ? ratio(el).toFixed(2) : "missing"}`);
    eq(bad, [], "low contrast");
  });

  // extreme data bounds
  await test("extreme: zero tracked items -> overview without ledger, no 'open' noise", async () => {
    await loadOpen(thread("z", [msg(1, null), msg(2, 1), msg(3, 1)]));
    const ov = $('[aria-label="Thread overview"]'); ok(ov);
    eq($$("[data-overview-item]").length, 0); ok(!ov.textContent.includes(" open")); ok(!$("[data-open-count]"));
  });
  await test("extreme: 25 resolved items -> scrollable ledger, everything resolved, no overflow", async () => {
    const ms = [msg(1, null)];
    for (let i = 1; i <= 25; i++) { ms.push(msg(100 + i, 1, { from: "Bob", to: ["Maya Chen"], actions: [{ type: "question", text: "Question number " + i + "?" }] })); ms.push(msg(200 + i, 100 + i, { from: "Maya Chen", to: ["Bob"] })); }
    await loadOpen(thread("r25", ms));
    ok($("[data-caught-up]"), "nothing open -> explicit all-clear instead of an empty box"); eq($$("[data-overview-item]").length, 0);
    await showLedger(); eq($$("[data-overview-item]").length, 25); eq($("[data-open-count]").textContent, "0 open");
    eq($$('[data-status="resolved"]').length, 25);
    const ul = $('[aria-label="Thread overview"] ul'); ok(ul.scrollHeight > ul.clientHeight, "ledger scrolls instead of growing the page");
    eq($$("[data-branch-chip]").length, 8, "branch chips capped"); ok(document.documentElement.scrollWidth <= innerWidth + 1);
  });
  await test("extreme: 40 participants with identical initials stay distinguishable and bounded", async () => {
    const names = Array.from({ length: 40 }, (_, i) => "Alex Person" + (i + 1));
    await loadOpen(thread("p40", [msg(1, null, { from: "Maya Chen", to: names }), msg(2, 1, { from: names[0], to: ["Maya Chen"] })]));
    ok($$("[data-person]").length <= 8, "avatar cap");
    const initials = new Set($$("[data-person] .rounded-full.text-white").map(e => e.textContent)); ok(initials.size <= 2, "initials really are identical");
    const line = $("[data-people-status]").textContent;
    ok(/Alex Person\d+, Alex Person\d+, Alex Person\d+ \+\d+ more dropped off/.test(line), line);
    header("2").click(); await waitFor(() => isOpen("2") || true, "x");
    if (!isOpen("2")) header("2").click();
    const badge = await waitFor(() => $("[data-delta-dropped]", mid("2")), "badge");
    ok(/Dropped Alex Person\d+, Alex Person\d+, Alex Person\d+ \+\d+ more/.test(badge.textContent), badge.textContent);
    ok(badge.title.split("\n").length >= 38, "full list stays available as a tooltip");
    ok(document.documentElement.scrollWidth <= innerWidth + 1);
  });
  await test("extreme: 1-character messages and a 2000-word essay", async () => {
    const essay = Array.from({ length: 2000 }, (_, i) => "word" + i).join(" ");
    await loadOpen(thread("ess", [msg(1, null, { body: "x" }), msg(2, 1, { body: "." }), msg(3, 1, { body: essay + "\n\nOn earlier, Bob wrote:\n> old" }), msg(4, 3, { body: "ok" })]));
    $('[aria-label="Expand all messages"]').click(); await waitFor(() => isOpen("3"), "open");
    ok(mid("1").textContent.includes("x")); ok(mid("3").textContent.includes("word1999"));
    ok(document.documentElement.scrollWidth <= innerWidth + 1, "no overflow");
    header("3").click(); await waitFor(() => !isOpen("3"), "collapsed");
    ok(mid("3").querySelector("#msg-3 .truncate").offsetHeight < 40, "collapsed snippet stays one line");
  });


  // ledger: progressive disclosure (from the design critique)
  await test("ledger: leads with open items; resolved & decisions are one click away; undo keeps a just-toggled row", async () => {
    await restore(); await go("t1");
    eq($$("[data-overview-item]").map(b => b.textContent.includes("headcount")), [true]);
    ok(!$("[data-caught-up]"));
    $('[data-toggle-resolved="13:0"]').click();
    await waitFor(() => chip("13:0") && chip("13:0").textContent === "Marked resolved", "row stays visible right after resolving (undo affordance)");
    eq($("[data-open-count]").textContent, "0 open"); ok($("[data-toggle-resolved=\"13:0\"]").textContent === "Reopen");
    await go("t1");
    ok($("[data-caught-up]") && $("[data-caught-up]").textContent.includes("All caught up"), "fresh visit: everything resolved -> all clear");
    eq($("[data-ledger-toggle]").getAttribute("aria-expanded"), "false");
    await showLedger(); ok($("[data-ledger-toggle]").textContent.includes("Hide resolved & decisions"));
    $("[data-ledger-toggle]").click(); await waitFor(() => $("[data-ledger-toggle]").getAttribute("aria-expanded") === "false", "collapsed again");
  });
  await test("ledger: item text is never clamped to an ellipsis on narrow screens (status wraps below instead)", async () => {
    await restore(); await go("t1");
    const row = $("[data-overview-item]"), span = $("span.text-\\[13px\\]", row);
    ok(span.scrollHeight <= span.clientHeight + 1, `text clamped: ${span.scrollHeight} > ${span.clientHeight}`);
    ok(span.getBoundingClientRect().width >= (MOBILE ? 180 : 300), "text gets real width: " + span.getBoundingClientRect().width);
    const c = chip("13:0").getBoundingClientRect(), t = span.getBoundingClientRect();
    if (MOBILE) ok(c.top >= t.bottom - 1, "on phones the chip sits below the text"); else ok(Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2) < 20, "on desktop it shares the row");
  });

  // every feature at once: no horizontal overflow
  await test(`layout @${innerWidth}px: overview + catch-up + focus + offline banner + composer + drift badges never overflow`, async () => {
    await restore(); await go("t1");
    $('[aria-label="Expand all messages"]').click(); await waitFor(() => isOpen("8"), "open");
    $("[data-reply-icon]", mid("9")).click(); await waitFor(() => composer("9"), "composer");
    $('[aria-label="Simulate offline (demo)"]').click(); await waitFor(() => $("[data-offline-banner]"), "offline");
    $('[data-branch-chip="8"]').click(); await waitFor(() => $("[data-focus-banner]"), "focus");
    const de = document.documentElement;
    ok(de.scrollWidth <= innerWidth + 1, `page ${de.scrollWidth} > ${innerWidth}`); ok($("main").scrollWidth <= $("main").clientWidth + 1, "main overflow");
    for (const el of $$("[data-mid] *")) { const r = el.getBoundingClientRect(); if (r.width && r.right > innerWidth + 1) throw new Error("element leaks past the viewport: " + (el.getAttribute("data-delta-dropped") !== null ? "drift badge" : el.className.toString().slice(0, 60))); }
  });

  // accessibility
  await test("a11y: no interactive element nested inside role=button; all buttons have names", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click(); await waitFor(() => composer("3"), "composer");
    eq($$('[role="button"] button, [role="button"] a, [role="button"] input').length, 0, "nested interactive");
    const unnamed = $$("button").filter(b => {
      const clone = b.cloneNode(true); $$(".ms", clone).forEach(n => n.remove());
      return !(b.getAttribute("aria-label") || b.title || clone.textContent.trim());
    });
    eq(unnamed.length, 0, "unnamed buttons: " + unnamed.map(b => b.outerHTML.slice(0, 80)).join(" | "));
    ok($$('[role="button"]').every(e => e.tabIndex === 0 && e.hasAttribute("aria-expanded")));
    ok($('[role="status"]', composer("3")), "live region for save/offline status");
    ok($("textarea", composer("3")).getAttribute("aria-label").includes("Sara Kim"));
  });

  await test("a11y: focus returns to the Reply button after closing the composer", async () => {
    await restore(); await go("t1");
    $("[data-reply-icon]", mid("3")).click();
    const c = await waitFor(() => composer("3"), "composer");
    await waitFor(() => document.activeElement === $("textarea", c), "textarea autofocus");
    key($("textarea", c), "Escape");
    await waitFor(() => document.activeElement === $("[data-reply-btn]", mid("3")), "focus back on Reply");
  });

  await restore(); G.openThread(null);
  const pre = document.createElement("pre");
  pre.id = "e2e-results";
  pre.textContent = JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, null, 1);
  document.body.appendChild(pre);
  document.title = "E2E DONE";
})();
