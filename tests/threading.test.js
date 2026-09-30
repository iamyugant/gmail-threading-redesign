// Logic tests for src/threading.js. Run: node --test tests/threading.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const T = require("../src/threading.js");
const jeq = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const M = (id, parent, extra = {}) => ({ id, parent, from: "A", to: ["B"], cc: [], ts: new Date(2026, 0, 1, 0, Number(String(id).replace(/\D/g, "")) || 0).toISOString(), body: "hi " + id, ...extra });
const ids = (tree) => tree.messages.map(n => n.id);
const parentOf = (tree, id) => tree.byId.get(id).parentId;

// tree building
test("empty / null / non-array input never throws", () => {
  for (const v of [[], null, undefined, "x", 42, {}]) {
    const t = T.buildThreadTree(v);
    assert.equal(t.root, null); jeq(t.messages, []);
  }
});

test("single message thread", () => {
  const t = T.buildThreadTree([M(1, null)]);
  assert.equal(t.root.id, "1"); assert.equal(t.root.children.length, 0); assert.equal(T.countBranches(t), 1);
});

test("basic tree: parent/child, depth, descendants, branches", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 1), M(3, 2), M(4, 1)]);
  assert.equal(parentOf(t, "3"), "2");
  assert.equal(t.byId.get("3").depth, 2);
  assert.equal(t.root.size, 3);
  assert.equal(T.countBranches(t), 2);
});

test("orphan parent attaches to root with fallback flag", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 99)]);
  assert.equal(parentOf(t, "2"), "1"); assert.equal(t.byId.get("2").fallback, "orphan");
});

test("self-parent is treated as orphan", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 2)]);
  assert.equal(parentOf(t, "2"), "1"); assert.equal(t.byId.get("2").fallback, "orphan");
});

test("2-cycle is broken, all messages reachable", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 3), M(3, 2)]);
  assert.equal(t.messages.length, 3);
  assert.equal(flattenAll(t).length, 3);
  assert.equal(t.byId.get("2").fallback, "cycle"); // earliest member is re-parented
  assert.equal(parentOf(t, "3"), "2");
});

test("node hanging off a cycle keeps its real parent", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 3), M(3, 2), M(4, 2)]);
  assert.equal(parentOf(t, "4"), "2"); assert.equal(t.byId.get("4").fallback, null);
  assert.equal(flattenAll(t).length, 4);
});

test("3-cycle and multiple independent cycles", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 4), M(3, 2), M(4, 3), M(5, 6), M(6, 5)]);
  assert.equal(flattenAll(t).length, 6);
  assert.equal(t.messages.filter(n => n.fallback === "cycle").length, 2);
});

test("no true root (everything has a parent): earliest message becomes root", () => {
  const t = T.buildThreadTree([M(1, 2), M(2, 1), M(3, 1)]);
  assert.equal(t.root.id, "1"); assert.equal(t.root.parentId, null);
  assert.equal(flattenAll(t).length, 3);
});

test("extra null-parent messages become missing-metadata children of root", () => {
  const t = T.buildThreadTree([M(1, null), M(2, null), M(3, null)]);
  assert.equal(t.root.id, "1");
  assert.equal(t.byId.get("2").fallback, "missing-metadata"); assert.equal(parentOf(t, "3"), "1");
});

test("missingHeaders flag overrides an existing parent", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 1), M(3, 2, { missingHeaders: true })]);
  assert.equal(parentOf(t, "3"), "1"); assert.equal(t.byId.get("3").fallback, "missing-metadata");
});

test("missingHeaders message that is the only/earliest candidate can still be root", () => {
  const t = T.buildThreadTree([M(1, null, { missingHeaders: true }), M(2, 1)]);
  assert.equal(t.root.id, "1"); assert.equal(parentOf(t, "2"), "1");
});

test("duplicate ids: first wins, warning recorded", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 1, { body: "first" }), M(2, 1, { body: "second" })]);
  assert.equal(t.messages.length, 2); assert.equal(t.byId.get("2").body, "first");
  assert.equal(t.warnings.filter(w => w.code === "duplicate-id").length, 1);
});

test("garbage entries are skipped", () => {
  const t = T.buildThreadTree([null, "str", 5, [], undefined, M(1, null)]);
  assert.equal(t.messages.length, 1); assert.equal(t.warnings.length, 5);
});

test("numeric and string ids/parents are unified", () => {
  const t = T.buildThreadTree([{ id: 1, parent: null, body: "a" }, { id: "2", parent: 1, body: "b" }, { id: 3, parent: "2", body: "c" }]);
  assert.equal(parentOf(t, "3"), "2"); assert.equal(t.byId.get("3").depth, 2);
});

test("missing id gets a stable auto id", () => {
  const t = T.buildThreadTree([{ body: "a" }, { body: "b" }]);
  jeq(ids(t), ["auto-0", "auto-1"]);
});

test("children sort chronologically regardless of input order", () => {
  const t = T.buildThreadTree([M(1, null), M(5, 1), M(3, 1), M(4, 1)]);
  jeq(t.root.children.map(c => c.id), ["3", "4", "5"]);
});

test("equal timestamps fall back to input order (stable)", () => {
  const same = "2026-01-01T00:00:00.000Z";
  const t = T.buildThreadTree([M(1, null, { ts: same }), M("b", 1, { ts: same }), M("a", 1, { ts: same })]);
  jeq(t.root.children.map(c => c.id), ["b", "a"]);
});

test("reply that predates its parent (clock skew) still nests under parent", () => {
  const t = T.buildThreadTree([M(1, null), M(9, 1, { ts: "2026-01-01T05:00:00Z" }), M(2, 9, { ts: "2026-01-01T01:00:00Z" })]);
  assert.equal(parentOf(t, "2"), "9"); assert.equal(flattenAll(t).length, 3);
});

test("invalid / missing timestamps keep input order and don't throw", () => {
  const t = T.buildThreadTree([{ id: 1, body: "" }, { id: 2, parent: 1, ts: "garbage" }, { id: 3, parent: 1, ts: null }, { id: 4, parent: 1 }]);
  jeq(t.root.children.map(c => c.id), ["2", "3", "4"]);
});

test("field coercion: strings, null, numbers, missing sender", () => {
  const t = T.buildThreadTree([{ id: 1, from: null, to: "solo@x.com", cc: null, body: 12345, actions: "nope" }]);
  const n = t.root;
  assert.equal(n.from, "Unknown sender"); jeq(n.to, ["solo@x.com"]); jeq(n.cc, []);
  assert.equal(n.body, "12345"); jeq(n.actions, []);
});

test("invalid action items are dropped", () => {
  const t = T.buildThreadTree([{ id: 1, actions: [{ type: "bogus", text: "x" }, { type: "question", text: "  " }, { type: "decision", text: " ok " }, null] }]);
  jeq(t.root.actions, [{ type: "decision", text: "ok" }]);
});

test("very deep chain (5000) does not overflow the stack", () => {
  const msgs = [M(1, null)];
  for (let i = 2; i <= 5000; i++) msgs.push({ ...M(i, i - 1), ts: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  const t = T.buildThreadTree(msgs);
  assert.equal(t.byId.get("5000").depth, 4999); assert.equal(t.root.size, 4999);
  assert.equal(T.visibleOrder(t.root).length, 5000);
});

test("very deep cycle of 3000 nodes resolves quickly", () => {
  const msgs = [M(1, null)];
  for (let i = 2; i <= 3000; i++) msgs.push({ ...M(i, i === 2 ? 3000 : i - 1), ts: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  const t0 = Date.now(); const t = T.buildThreadTree(msgs);
  assert.ok(Date.now() - t0 < 2000); assert.equal(flattenAll(t).length, 3000);
});

test("wide fan-out (10k children)", () => {
  const msgs = [M(1, null)];
  for (let i = 2; i <= 10000; i++) msgs.push({ ...M(i, 1), ts: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  const t = T.buildThreadTree(msgs);
  assert.equal(t.root.children.length, 9999); assert.equal(T.countBranches(t), 9999);
});

test("PROPERTY: random graphs always yield a valid single-rooted tree containing every message once", () => {
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let iter = 0; iter < 300; iter++) {
    const n = 1 + Math.floor(rnd() * 40);
    const msgs = [];
    for (let i = 1; i <= n; i++) {
      const r = rnd();
      const parent = r < 0.15 ? null : r < 0.25 ? 900 + i : r < 0.3 ? i : 1 + Math.floor(rnd() * n);
      msgs.push({ id: i, parent, ts: rnd() < 0.2 ? "bad" : new Date(2026, 0, 1, 0, Math.floor(rnd() * 500)).toISOString(), missingHeaders: rnd() < 0.1, body: "x" });
    }
    const t = T.buildThreadTree(msgs);
    assert.equal(t.messages.length, n);
    const seen = flattenAll(t);
    assert.equal(seen.length, n, `iter ${iter}: reachable ${seen.length}/${n}`);
    assert.equal(new Set(seen).size, n);
    for (const node of t.messages) {
      if (node === t.root) { assert.equal(node.parentId, null); continue; }
      assert.equal(node.depth, t.byId.get(node.parentId).depth + 1);
    }
    assert.equal(t.root.size, n - 1);
  }
});

test("ancestors and flatten (with folding)", () => {
  const t = T.buildThreadTree([M(1, null), M(2, 1), M(3, 2), M(4, 1)]);
  jeq(T.ancestorIds(t.byId, "3"), ["2", "1"]);
  jeq(T.visibleOrder(t.root), ["1", "2", "3", "4"]);
  jeq(T.visibleOrder(t.root, new Set(["2"])), ["1", "2", "4"]);
  jeq(T.visibleOrder(null), []);
});

function flattenAll(t) { return T.visibleOrder(t.root); }

// quote splitting
test("no quote: whole body is text", () => {
  const r = T.splitQuoted("Hello\nworld"); assert.equal(r.text, "Hello\nworld"); assert.equal(r.quoted, "");
});
test("gmail style attribution + > block is stripped", () => {
  const r = T.splitQuoted("Sounds good.\n\nOn Oct 12, 9:02 AM, Maya wrote:\n> Can you review?\n> Thanks");
  assert.equal(r.text, "Sounds good."); assert.match(r.quoted, /^On Oct 12/); assert.equal(r.quotedLines, 3);
});
test("attribution wrapped over two lines", () => {
  const r = T.splitQuoted("Yes\n\nOn Mon, Oct 12, 2026 at 9:02 AM Maya Chen\n<maya@x.com> wrote:\n> hi");
  assert.equal(r.text, "Yes"); assert.match(r.quoted, /^On Mon/);
});
test("quote-only message", () => {
  const r = T.splitQuoted("> just a quote\n> more"); assert.equal(r.text, ""); assert.equal(r.quotedLines, 2);
});
test("inline (interleaved) replies are NOT stripped", () => {
  const body = "> Q1?\nA1\n> Q2?\nA2";
  const r = T.splitQuoted(body); assert.equal(r.quoted, ""); assert.equal(r.text, body);
});
test("outlook -----Original Message-----", () => {
  const r = T.splitQuoted("Done.\n\n-----Original Message-----\nFrom: A\nSent: x\n\nold text");
  assert.equal(r.text, "Done."); assert.match(r.quoted, /^-----Original/);
});
test("outlook From:/Sent: header block without dashes", () => {
  const r = T.splitQuoted("Ok\n\nFrom: Bob\nSent: Monday\nTo: me\nSubject: Re: x\n\nold");
  assert.equal(r.text, "Ok"); assert.match(r.quoted, /^From: Bob/);
});
test("a normal 'From:' line without Sent:/Date: is not a quote", () => {
  const r = T.splitQuoted("From: the design team, with love"); assert.equal(r.quoted, "");
});
test("CRLF line endings", () => {
  const r = T.splitQuoted("Hi\r\n\r\nOn x, Bob wrote:\r\n> old\r\n"); assert.equal(r.text, "Hi"); assert.ok(r.quoted.includes("> old"));
});
test("nested >> quotes and indented >", () => {
  const r = T.splitQuoted("Hi\n\nOn x, Bob wrote:\n> a\n>> b\n  > c"); assert.equal(r.text, "Hi"); assert.equal(r.quotedLines, 4);
});
test("trailing blank lines after quote are kept inside the quote block only", () => {
  const r = T.splitQuoted("Hi\n> q\n\n\n"); assert.equal(r.text, "Hi"); assert.equal(r.quoted, "> q");
});
test("'wrote:' line without a > block is not treated as a quote", () => {
  const r = T.splitQuoted("Dan wrote:\nsomething"); assert.equal(r.quoted, "");
});
test("mid-line > characters are ignored", () => {
  const r = T.splitQuoted("a > b and c > d"); assert.equal(r.quoted, "");
});
test("non-string / empty bodies", () => {
  for (const v of ["", null, undefined, 5, {}]) { const r = T.splitQuoted(v); assert.equal(r.quoted, ""); assert.equal(typeof r.text, "string"); }
});
test("quoteBlock -> splitQuoted round trip preserves reply text and finds the quote", () => {
  const parent = { date: "Oct 12, 9:02 AM", from: "Maya", body: "Line 1\nLine 2\n\nOn earlier, Z wrote:\n> older" };
  const body = "My reply\nwith two lines\n\n" + T.quoteBlock(parent);
  const r = T.splitQuoted(body);
  assert.equal(r.text, "My reply\nwith two lines");
  assert.ok(r.quoted.includes("> Line 1") && !r.quoted.includes("older"));
});
test("quoteBlock truncates long parents and handles empty text", () => {
  const long = { date: "d", from: "f", body: Array.from({ length: 20 }, (_, i) => "L" + i).join("\n") };
  assert.ok(T.quoteBlock(long).endsWith("> …"));
  assert.ok(T.quoteBlock({ date: "d", from: "f", body: "" }).includes("(no text)"));
});

// mentions
test("mention tokenizing", () => {
  const p = T.tokenizeMentions("Hi @Maya, ping @José and @dev-ops!");
  jeq(p.filter(x => x.mention).map(x => x.text), ["@Maya", "@José", "@dev-ops"]);
  assert.equal(p.map(x => x.text).join(""), "Hi @Maya, ping @José and @dev-ops!");
});
test("emails are not mentions; lone @ and @@ are safe", () => {
  assert.equal(T.tokenizeMentions("mail maya@example.com now").filter(x => x.mention).length, 0);
  assert.equal(T.tokenizeMentions("@ alone @@x 123@456").filter(x => x.mention).length, 0);
});
test("mentionsMe matches first name, full name joined; case-insensitive; not partial", () => {
  assert.ok(T.mentionsMe("@maya please look", "Maya Chen"));
  assert.ok(T.mentionsMe("cc @MayaChen", "Maya Chen"));
  assert.ok(T.mentionsMe("cc @maya.chen", "Maya Chen"));
  assert.ok(!T.mentionsMe("@mayahem", "Maya Chen"));
  assert.ok(!T.mentionsMe("no mention", "Maya Chen"));
  assert.ok(!T.mentionsMe(null, "Maya Chen"));
});

// recipients
const ME = "Maya Chen";
test("reply to someone: To sender, Cc everyone else, minus me", () => {
  const r = T.replyRecipients({ from: "Sara", to: ["Dev", "Maya Chen"], cc: ["Luis"] }, ME);
  jeq(r, { to: ["Sara"], cc: ["Dev", "Luis"] });
});
test("reply to my own message goes to its original recipients", () => {
  const r = T.replyRecipients({ from: "Maya Chen", to: ["Sara"], cc: ["Dev"] }, ME);
  jeq(r, { to: ["Sara"], cc: ["Dev"] });
});
test("own message with no recipients yields empty To (composer must handle)", () => {
  jeq(T.replyRecipients({ from: "maya chen", to: [], cc: [] }, ME), { to: [], cc: [] });
});
test("dedupes case-insensitively, trims, drops blanks and the sender from Cc", () => {
  const r = T.replyRecipients({ from: "Sara", to: [" sara ", "DEV", "dev", "", "Maya Chen"], cc: ["Dev ", null] }, ME);
  jeq(r, { to: ["Sara"], cc: ["DEV"] });
});
test("sender is the only participant", () => {
  jeq(T.replyRecipients({ from: "Solo", to: [], cc: [] }, ME), { to: ["Solo"], cc: [] });
});

// small helpers
test("firstLine skips blanks, truncates, tolerates null", () => {
  assert.equal(T.firstLine("\n\n  hello \nworld"), "hello");
  assert.equal(T.firstLine("x".repeat(500), 10).length, 10);
  assert.equal(T.firstLine(null), "");
});
test("initial handles empty, whitespace, emoji, lowercase", () => {
  assert.equal(T.initial(""), "?"); assert.equal(T.initial("   "), "?"); assert.equal(T.initial(null), "?");
  assert.equal(T.initial("maya"), "M"); assert.equal(T.initial("🚀 Team"), "🚀");
});
test("first name / me", () => {
  assert.equal(T.first("Maya Chen", ME), "me"); assert.equal(T.first("Sara Kim", ME), "Sara"); assert.equal(T.first("", ME), "?");
});
test("formatDate: just now, same day, other day, invalid", () => {
  const now = new Date(2026, 5, 15, 12, 0).getTime();
  assert.equal(T.formatDate(now - 5000, now), "Just now");
  assert.match(T.formatDate(now - 3600e3, now), /^\d{1,2}:\d{2}\s?[AP]M$/);
  assert.match(T.formatDate(now - 3 * 86400e3, now), /^Jun 12, /);
  assert.equal(T.formatDate(NaN), ""); assert.equal(T.formatDate(null), "");
  assert.match(T.formatDate(now - 3 * 86400e3, now, true), /^Jun 12$/);
});

// resolution / unread / people / focus
const N = (specs, opts) => {
  // specs: [id, parent, from, to, cc, minute, body, actions]
  const msgs = specs.map(([id, parent, from, to, cc, min, body, actions]) => ({
    id, parent, from, to: to || [], cc: cc || [], ts: new Date(2026, 0, 1, 0, min).toISOString(), body: body || "x", actions: actions || [],
  }));
  return T.buildThreadTree(msgs);
};
const A = (tree, o = {}) => T.analyzeThread(tree, { me: "Maya Chen", ...o });
const item = (an, id, i = 0) => an.items.find(x => x.key === `${id}:${i}`);
const Q = [{ type: "question", text: "q?" }], B = [{ type: "blocker", text: "b" }], D = [{ type: "decision", text: "d" }];

test("resolveMention: first name, joined, dotted, case-insensitive, no partial", () => {
  const names = ["Maya Chen", "Sara Kim"];
  assert.equal(T.resolveMention("maya", names), "Maya Chen");
  assert.equal(T.resolveMention("SaraKim", names), "Sara Kim");
  assert.equal(T.resolveMention("sara.kim", names), "Sara Kim");
  assert.equal(T.resolveMention("mayaa", names), null); assert.equal(T.resolveMention("", names), null);
});

test("question: resolved when an addressed person replies below it", () => {
  const an = A(N([[1, null, "Ann", ["Bob"], [], 0], [2, 1, "Sara", ["Bob", "Maya Chen"], [], 1, "hi", Q], [3, 2, "Maya Chen", ["Sara"], [], 2]]));
  const it = item(an, 2); assert.equal(it.state, "resolved"); assert.equal(it.by.id, "3");
});
test("question: asker's own follow-up does not resolve it", () => {
  const an = A(N([[1, null, "Sara", ["Bob"], [], 0, "x", Q], [2, 1, "Sara", ["Bob"], [], 1]]));
  assert.equal(item(an, 1).state, "open");
});
test("question: a reply from someone NOT addressed does not resolve it", () => {
  const an = A(N([[1, null, "Sara", ["Bob"], ["Cy"], 0, "x", Q], [2, 1, "Cy", ["Sara"], [], 1]]));
  assert.equal(item(an, 1).state, "open"); jeq(JSON.parse(JSON.stringify(item(an, 1).asked)), ["Bob"]);
});
test("question: @mention narrows who it is aimed at (overrides To)", () => {
  const specs = [[1, null, "Sara", ["Bob", "Maya Chen"], [], 0, "@Maya can you approve?", Q], [2, 1, "Bob", ["Sara"], [], 1]];
  const an = A(N(specs));
  jeq(JSON.parse(JSON.stringify(item(an, 1).asked)), ["Maya Chen"]); assert.equal(item(an, 1).state, "open");
  specs.push([3, 1, "Maya Chen", ["Sara"], [], 2]);
  assert.equal(item(A(N(specs)), 1).state, "resolved");
});
test("question with no recipients: any other author resolves it", () => {
  const an = A(N([[1, null, "Sara", [], [], 0, "x", Q], [2, 1, "Zed", [], [], 1]]));
  assert.equal(item(an, 1).state, "resolved");
});
test("question: unaddressed reply in a sibling branch does not count (must be below it)", () => {
  const an = A(N([[1, null, "Ann", ["Bob"], [], 0], [2, 1, "Sara", ["Bob"], [], 1, "x", Q], [3, 1, "Bob", ["Ann"], [], 2]]));
  assert.equal(item(an, 2).state, "open");
});
test("blocker: resolved by the LATEST decision below it; sibling-branch decisions don't count", () => {
  const specs = [[1, null, "A", ["B"], [], 0], [2, 1, "B", ["A"], [], 1, "x", B], [3, 2, "A", ["B"], [], 2, "x", D], [4, 3, "B", ["A"], [], 3, "x", D], [5, 1, "C", ["A"], [], 4, "x", D]];
  const it = item(A(N(specs)), 2);
  assert.equal(it.state, "resolved"); assert.equal(it.by.id, "4");
  assert.equal(item(A(N([[1, null, "A", [], [], 0], [2, 1, "B", [], [], 1, "x", B], [3, 1, "C", [], [], 2, "x", D]])), 2).state, "open");
});
test("decisions are 'decided' and never counted as open", () => {
  const an = A(N([[1, null, "A", [], [], 0, "x", D]])); assert.equal(item(an, 1).state, "decided"); assert.equal(an.openCount, 0);
});
test("manual override wins both ways and marks item as manual", () => {
  const specs = [[1, null, "Sara", ["Bob"], [], 0, "x", Q], [2, 1, "Bob", ["Sara"], [], 1]];
  const t = N(specs);
  const a = item(A(t, { manual: { "1:0": "open" } }), 1); assert.equal(a.state, "open"); assert.equal(a.manual, true);
  const t2 = N([[1, null, "Sara", ["Bob"], [], 0, "x", Q]]);
  const b = item(A(t2, { manual: { "1:0": "resolved" } }), 1); assert.equal(b.state, "resolved"); assert.equal(b.manual, true); assert.equal(b.by, null);
  assert.equal(A(t2, { manual: { "99:0": "resolved" } }).openCount, 1, "unknown keys ignored");
});
test("item keys are stable: '<msgId>:<index>'", () => {
  const an = A(N([[1, null, "A", [], [], 0, "x", [{ type: "question", text: "a" }, { type: "blocker", text: "b" }]]]));
  jeq(an.items.map(i => i.key), ["1:0", "1:1"]);
});

test("people: dropped = absent from every branch's latest message", () => {
  const an = A(N([[1, null, "Ann", ["Bob", "Cy"], [], 0], [2, 1, "Bob", ["Ann"], [], 1], [3, 1, "Cy", ["Ann"], [], 2]]));
  assert.equal(an.people.filter(p => p.dropped).length, 0, "everyone appears in some leaf");
  const an2 = A(N([[1, null, "Ann", ["Bob", "Cy"], [], 0], [2, 1, "Bob", ["Ann"], [], 1]]));
  const cy = an2.people.find(p => p.name === "Cy"); assert.equal(cy.dropped, true); assert.match(cy.note, /never replied/);
  const bob = an2.people.find(p => p.name === "Bob"); assert.equal(bob.dropped, false);
});
test("people: dropped note names the last message they wrote", () => {
  const an = A(N([[1, null, "Ann", ["Bob"], [], 0], [2, 1, "Bob", ["Ann"], [], 1], [3, 2, "Ann", ["Zed"], [], 2]]));
  const bob = an.people.find(p => p.name === "Bob"); assert.equal(bob.dropped, true); assert.match(bob.note, /Last active/);
});
test("people: pending only while a question aimed at them is open", () => {
  const specs = [[1, null, "Ann", ["Bob"], [], 0, "x", Q]];
  assert.equal(A(N(specs)).people.find(p => p.name === "Bob").pending.length, 1);
  assert.equal(A(N(specs), { manual: { "1:0": "resolved" } }).people.find(p => p.name === "Bob").pending.length, 0);
  assert.equal(A(N(specs)).people.find(p => p.name === "Ann").pending.length, 0, "asker isn't waited on");
});
test("analyze on empty / single-message trees never throws", () => {
  const e = A(T.buildThreadTree([])); assert.equal(e.items.length, 0); assert.equal(e.summary.count, 0);
  const s = A(N([[1, null, "Ann", [], [], 0]])); assert.equal(s.people.length, 1);
});

test("unread: after lastSeen, not mine, not in read set; null lastSeen = nothing new", () => {
  const t = N([[1, null, "Ann", [], [], 0], [2, 1, "Bob", [], [], 10], [3, 2, "Maya Chen", [], [], 20], [4, 3, "Cy", [], [], 30]]);
  const seen = new Date(2026, 0, 1, 0, 5).getTime();
  jeq([...A(t, { lastSeen: seen }).newIds], ["2", "4"]);
  jeq([...A(t, { lastSeen: seen, read: new Set(["2"]) }).newIds], ["4"]);
  assert.equal(A(t, { lastSeen: null }).newIds.size, 0);
  assert.equal(A(t, { lastSeen: Date.now() + 1e9 }).newIds.size, 0);
  assert.equal(A(t, { lastSeen: NaN }).newIds.size, 0);
  assert.equal(A(t, { lastSeen: -1 }).newIds.size, 3, "everything not mine is new");
});
test("unread summary: distinct branches, decisions, questions for me, mentions", () => {
  const t = N([
    [1, null, "Ann", ["Maya Chen"], [], 0],
    [2, 1, "Bob", ["Maya Chen"], [], 10, "hi @Maya", Q],          // branch 2 (asks me)
    [3, 2, "Cy", ["Bob"], [], 11, "x", D],                        // same branch, decision
    [4, 1, "Dee", ["Ann"], [], 12, "x", D],                       // branch 4
  ]);
  const s = A(t, { lastSeen: new Date(2026, 0, 1, 0, 5).getTime() }).summary;
  assert.equal(s.count, 3); assert.equal(s.branches, 2); assert.equal(s.decisions, 2); assert.equal(s.questionsForMe, 1); assert.equal(s.mentions, 1);
});
test("nextUnread: time order across branches, wraps, tolerates unknown/non-new current", () => {
  const t = N([[1, null, "A", [], [], 0], [2, 1, "B", [], [], 10], [3, 1, "C", [], [], 20], [4, 2, "D", [], [], 30]]);
  const nw = new Set(["2", "3", "4"]);
  assert.equal(T.findNextUnread(t, nw, null), "2");
  assert.equal(T.findNextUnread(t, nw, "2"), "3");
  assert.equal(T.findNextUnread(t, nw, "3"), "4");
  assert.equal(T.findNextUnread(t, nw, "4"), "2", "wraps");
  assert.equal(T.findNextUnread(t, nw, "1"), "2"); assert.equal(T.findNextUnread(t, nw, "nope"), "2");
  assert.equal(T.findNextUnread(t, new Set(), "1"), null);
});

test("focusSet: path to root + node + all descendants; siblings excluded", () => {
  const t = N([[1, null, "A", [], [], 0], [2, 1, "B", [], [], 1], [3, 2, "C", [], [], 2], [4, 1, "D", [], [], 3], [5, 4, "E", [], [], 4]]);
  jeq([...T.resolveLineage(t, "2")].sort(), ["1", "2", "3"]);
  jeq([...T.resolveLineage(t, 4)].sort(), ["1", "4", "5"]);
  assert.equal(T.resolveLineage(t, "1").size, 5); assert.equal(T.resolveLineage(t, "zzz"), null);
});
test("forkHeads: children of nodes with 2+ replies only", () => {
  const chain = N([[1, null, "A", [], [], 0], [2, 1, "B", [], [], 1], [3, 2, "C", [], [], 2]]);
  assert.equal(T.findForkHeads(chain).length, 0);
  const t = N([[1, null, "A", [], [], 0], [2, 1, "B", [], [], 1], [3, 1, "C", [], [], 2], [4, 3, "D", [], [], 3], [5, 3, "E", [], [], 4]]);
  jeq(T.findForkHeads(t).map(h => h.id), ["2", "3", "4", "5"]);
});

test("PROPERTY: analyze/focus/nextUnread never throw on random malformed threads and stay consistent", () => {
  let seed = 99;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const kinds = ["question", "blocker", "decision", "bogus"];
  for (let iter = 0; iter < 200; iter++) {
    const n = 1 + Math.floor(rnd() * 30), msgs = [];
    for (let i = 1; i <= n; i++) {
      const r = rnd();
      msgs.push({ id: i, parent: r < 0.15 ? null : r < 0.2 ? 500 : 1 + Math.floor(rnd() * n), from: "P" + Math.floor(rnd() * 5), to: ["P" + Math.floor(rnd() * 5)], cc: [], body: rnd() < 0.3 ? "@P1 hi" : "x",
        ts: new Date(2026, 0, 1, 0, Math.floor(rnd() * 100)).toISOString(), actions: rnd() < 0.4 ? [{ type: kinds[Math.floor(rnd() * 4)], text: "t" }] : [] });
    }
    const tree = T.buildThreadTree(msgs);
    const an = T.analyzeThread(tree, { me: "P0", lastSeen: new Date(2026, 0, 1, 0, 30).getTime() });
    const ids = new Set(tree.messages.map(m => m.id));
    for (const id of an.newIds) assert.ok(ids.has(id));
    for (const it of an.items) { assert.ok(ids.has(it.id)); if (it.by) assert.ok(ids.has(it.by.id)); }
    assert.equal(an.openCount, an.items.filter(i => i.state === "open").length);
    const pick = tree.messages[Math.floor(rnd() * tree.messages.length)].id;
    const fs = T.resolveLineage(tree, pick); assert.ok(fs.has(tree.root.id) && fs.has(pick));
    const nu = T.findNextUnread(tree, an.newIds, pick); assert.ok(nu === null ? an.newIds.size === 0 : an.newIds.has(nu));
  }
});

// audience drift / references / transitions / lineage
const P = (id, parent, from, to, cc, min, extra = {}) => ({ id, parent, from, to, cc, ts: new Date(2026, 0, 1, 0, min).toISOString(), body: "x", ...extra });

test("recipientDelta: dropped and added are computed against the parent's audience", () => {
  const parent = { from: "Ann", to: ["Bob", "Cy"], cc: ["Dee"] };
  const node = { from: "Bob", to: ["Ann"], cc: ["Eve"] };
  const d = T.calculateAudienceDrift(node, parent);
  jeq(d.dropped, ["Cy", "Dee"]); jeq(d.added, ["Eve"]);
});
test("recipientDelta: a plain reply (sender flips, same people) has no drift; case/whitespace ignored", () => {
  const d = T.calculateAudienceDrift({ from: "bob ", to: [" ANN"], cc: [] }, { from: "Ann", to: ["Bob"], cc: [] });
  jeq(d, { dropped: [], added: [] });
});
test("recipientDelta: no parent -> null; missing arrays tolerated", () => {
  assert.equal(T.calculateAudienceDrift({ from: "A", to: [], cc: [] }, null), null);
  jeq(T.calculateAudienceDrift({ from: "A" }, { from: "A", to: ["B"] }), { dropped: ["B"], added: [] });
});
test("analyze.deltas: only real drift is reported; fallback-placed messages are skipped", () => {
  const t = T.buildThreadTree([P(1, null, "Ann", ["Bob", "Cy"], [], 0), P(2, 1, "Bob", ["Ann", "Cy"], [], 1), P(3, 2, "Ann", ["Bob"], [], 2), P(4, 99, "Zed", ["Ann"], [], 3)]);
  const an = T.analyzeThread(t, { me: "Nobody" });
  assert.equal(an.deltas.has("2"), false, "same audience");
  jeq(an.deltas.get("3").dropped, ["Cy"]);
  assert.equal(an.deltas.has("4"), false, "orphan placed at root by time: no meaningful parent");
});
test("analyze.deltas: private back-channel (2 people dropped) is visible", () => {
  const t = T.buildThreadTree([P(1, null, "Maya", ["Dev", "Sara", "Luis"], [], 0), P(2, 1, "Luis", ["Maya"], [], 1)]);
  jeq(T.analyzeThread(t, { me: "Maya" }).deltas.get("2").dropped, ["Dev", "Sara"]);
});

test("References fallback: orphan is placed under the nearest surviving ancestor in its chain", () => {
  const t = T.buildThreadTree([P(1, null, "A", [], [], 0), P(2, 1, "B", [], [], 1), P(4, 3, "C", [], [], 3, { references: [1, 2, 3] })]);
  assert.equal(parentOf(t, "4"), "2"); assert.equal(t.byId.get("4").fallback, "partial-references");
});
test("References fallback: none of the references exist -> root as before", () => {
  const t = T.buildThreadTree([P(1, null, "A", [], [], 0), P(4, 3, "C", [], [], 3, { references: [7, 8] })]);
  assert.equal(parentOf(t, "4"), "1"); assert.equal(t.byId.get("4").fallback, "orphan");
});
test("References fallback also rescues messages with no In-Reply-To but a References chain", () => {
  const t = T.buildThreadTree([P(1, null, "A", [], [], 0), P(2, 1, "B", [], [], 1), P(3, null, "C", [], [], 2, { references: ["1", "2"] })]);
  assert.equal(parentOf(t, "3"), "2"); assert.equal(t.byId.get("3").fallback, "partial-references");
});
test("References: self-references ignored; missingHeaders flag beats references; string refs OK", () => {
  const t = T.buildThreadTree([P(1, null, "A", [], [], 0), P(2, 1, "B", [], [], 1), P(3, 9, "C", [], [], 2, { references: "3" }), P(4, 2, "D", [], [], 3, { missingHeaders: true, references: [2] })]);
  assert.equal(parentOf(t, "3"), "1"); assert.equal(parentOf(t, "4"), "1"); assert.equal(t.byId.get("4").fallback, "missing-metadata");
});
test("PROPERTY: random References chains keep the tree valid (no loss, no cycles)", () => {
  let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let it = 0; it < 200; it++) {
    const n = 2 + Math.floor(rnd() * 30), msgs = [];
    for (let i = 1; i <= n; i++) msgs.push(P(i, rnd() < 0.3 ? null : rnd() < 0.3 ? 900 : 1 + Math.floor(rnd() * n), "P" + (i % 4), [], [], Math.floor(rnd() * 200),
      { references: Array.from({ length: Math.floor(rnd() * 4) }, () => 1 + Math.floor(rnd() * (n + 3))) }));
    const t = T.buildThreadTree(msgs); assert.equal(T.visibleOrder(t.root).length, n);
  }
});

test("toggleResolution: open -> resolved -> open, derived-resolved can be reopened, input not mutated", () => {
  const frozen = Object.freeze({});
  const a = T.toggleResolution(frozen, { key: "1:0", state: "open", text: "Q?" });
  assert.equal(a.resolved, true); jeq(a.manual, { "1:0": "resolved" }); assert.equal(a.message, "Marked resolved: Q?");
  const b = T.toggleResolution(a.manual, { key: "1:0", state: "resolved", text: "Q?" });
  assert.equal(b.resolved, false); jeq(b.manual, { "1:0": "open" }); assert.equal(b.message, "Reopened: Q?");
  jeq(T.toggleResolution({ x: "open" }, { key: "y", state: "resolved", text: "t" }).manual, { x: "open", y: "open" }, "other keys preserved");
});
test("toggleResolution round-trips through analyze", () => {
  const t = N([[1, null, "Sara", ["Bob"], [], 0, "x", Q]]);
  let manual = {}; const st = () => A(t, { manual }).items[0].state;
  assert.equal(st(), "open");
  manual = T.toggleResolution(manual, A(t, { manual }).items[0]).manual; assert.equal(st(), "resolved");
  manual = T.toggleResolution(manual, A(t, { manual }).items[0]).manual; assert.equal(st(), "open");
});
test("listNames caps long lists", () => {
  assert.equal(T.listNames(["A", "B"]), "A, B"); assert.equal(T.listNames(["A", "B", "C", "D", "E"]), "A, B, C +2 more"); assert.equal(T.listNames([]), "");
});

test("lineage isolation (exhaustive on a fixed graph): ancestors + self + descendants, nothing else", () => {
  //        1
  //      / | \
  //     2  3  4
  //    / \    |
  //   5   6   7
  const t = N([[1, null, "A", [], [], 0], [2, 1, "B", [], [], 1], [3, 1, "C", [], [], 2], [4, 1, "D", [], [], 3], [5, 2, "E", [], [], 4], [6, 2, "F", [], [], 5], [7, 4, "G", [], [], 6]]);
  const expect = { 1: "1234567", 2: "1256", 3: "13", 4: "147", 5: "125", 6: "126", 7: "147" };
  for (const [id, want] of Object.entries(expect)) assert.equal([...T.resolveLineage(t, id)].sort().join(""), want, "focus " + id);
});
test("PROPERTY: focus set == ancestors ∪ {node} ∪ descendants (checked against an independent walk)", () => {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let it = 0; it < 150; it++) {
    const n = 2 + Math.floor(rnd() * 40), msgs = [];
    for (let i = 1; i <= n; i++) msgs.push(P(i, i === 1 ? null : 1 + Math.floor(rnd() * (i - 1)), "P", [], [], i));
    const t = T.buildThreadTree(msgs);
    const parentMap = new Map(t.messages.map(m => [m.id, m.parentId]));
    const isAnc = (a, b) => { for (let x = parentMap.get(b); x != null; x = parentMap.get(x)) if (x === a) return true; return false; };
    for (const node of t.messages) {
      const fs = T.resolveLineage(t, node.id);
      for (const other of t.messages) {
        const expected = other.id === node.id || isAnc(other.id, node.id) || isAnc(node.id, other.id);
        assert.equal(fs.has(other.id), expected, `node ${node.id} vs ${other.id}`);
      }
    }
  }
});

test("PERF: splitQuoted on a 2000-word essay and a 20k-line body stays fast", () => {
  const essay = Array.from({ length: 2000 }, (_, i) => "word" + i).join(" ") + "\n\nOn x, Bob wrote:\n> old";
  let t0 = Date.now(); const r = T.splitQuoted(essay); assert.ok(Date.now() - t0 < 100); assert.equal(r.quotedLines, 2);
  const big = Array.from({ length: 20000 }, (_, i) => "line " + i).join("\n") + "\n> q";
  t0 = Date.now(); T.splitQuoted(big); assert.ok(Date.now() - t0 < 200);
});
test("1-character and empty-ish messages normalise and split cleanly", () => {
  for (const b of ["x", ".", " ", "\n", ">"]) { const r = T.splitQuoted(b); assert.equal(typeof r.text, "string"); }
  assert.equal(T.splitQuoted("x").text, "x"); assert.equal(T.splitQuoted(">").text, "");
});

test("shortName: first name unless it would be ambiguous in the thread", () => {
  const u = ["Alex Kim", "Alex Wu", "Sara Lee"];
  assert.equal(T.shortName("Sara Lee", u), "Sara"); assert.equal(T.shortName("Alex Kim", u), "Alex Kim");
  assert.equal(T.shortName("Alex Wu", u), "Alex Wu"); assert.equal(T.shortName("", u), "?");
  assert.equal(T.shortName("Solo", []), "Solo"); assert.equal(T.shortName("alex kim", ["Alex Kim"]), "alex", "same person, different case");
});
