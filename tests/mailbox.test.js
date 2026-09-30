// Logic tests for src/mailbox.js. Run: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const Mailbox = require("../src/mailbox.js");

const ME = "Maya Chen";
const msg = (from, extra = {}) => ({ id: Math.random().toString(36).slice(2), parent: null, from, to: [ME], cc: [], ts: "2026-01-02T10:00:00Z", body: "hello", ...extra });
const thread = (id, messages, extra = {}) => ({ id, subject: "Subject " + id, messages, ...extra });
const noFlags = () => ({ starred: {}, archived: {}, trashed: {} });
const inFolder = (folder, t, flags = noFlags(), hasDraft = false) => Mailbox.belongsToFolder(folder, t, { me: ME, flags, hasDraft });

test("authorship: incoming, outgoing, or both; case-insensitive on my name", () => {
  assert.deepEqual({ ...Mailbox.authorship(thread("a", [msg("Dev")]), ME) }, { hasIncoming: true, hasOutgoing: false });
  assert.deepEqual({ ...Mailbox.authorship(thread("a", [msg("maya chen")]), ME) }, { hasIncoming: false, hasOutgoing: true });
  assert.deepEqual({ ...Mailbox.authorship(thread("a", [msg("Dev"), msg(ME)]), ME) }, { hasIncoming: true, hasOutgoing: true });
});

test("authorship tolerates empty or junk threads", () => {
  for (const t of [{ id: "x" }, { id: "x", messages: null }, { id: "x", messages: [null, "s", 5] }]) {
    assert.deepEqual({ ...Mailbox.authorship(t, ME) }, { hasIncoming: false, hasOutgoing: false });
  }
});

test("inbox: needs someone else's message and must not be archived or trashed", () => {
  assert.ok(inFolder("inbox", thread("a", [msg("Dev")])));
  assert.ok(!inFolder("inbox", thread("b", [msg(ME)])), "my own new conversation is not inbox material");
  assert.ok(!inFolder("inbox", thread("c", [msg("Dev")]), { ...noFlags(), archived: { c: true } }));
  assert.ok(!inFolder("inbox", thread("d", [msg("Dev")]), { ...noFlags(), trashed: { d: true } }));
});

test("sent: any thread I wrote in, including replies inside someone else's thread", () => {
  assert.ok(inFolder("sent", thread("a", [msg("Dev"), msg(ME)])));
  assert.ok(!inFolder("sent", thread("b", [msg("Dev")])));
});

test("archive removes from inbox but keeps sent/starred; trash hides everywhere except trash", () => {
  const t = thread("a", [msg("Dev"), msg(ME)]);
  const archived = { starred: { a: true }, archived: { a: true }, trashed: {} };
  assert.ok(!inFolder("inbox", t, archived)); assert.ok(inFolder("archived", t, archived));
  assert.ok(inFolder("sent", t, archived)); assert.ok(inFolder("starred", t, archived));
  const trashed = { starred: { a: true }, archived: { a: true }, trashed: { a: true } };
  for (const f of ["inbox", "starred", "sent", "archived", "drafts"]) assert.ok(!inFolder(f, t, trashed, true), f);
  assert.ok(inFolder("trash", t, trashed));
});

test("drafts depends only on the draft flag; unknown folder matches nothing", () => {
  const t = thread("a", [msg("Dev")]);
  assert.ok(inFolder("drafts", t, noFlags(), true)); assert.ok(!inFolder("drafts", t, noFlags(), false));
  assert.ok(!inFolder("nonsense", t));
});

test("newestFirst sorts by last message time and tolerates missing times", () => {
  const a = thread("a", [msg("Dev", { ts: "2026-01-01T00:00:00Z" })]);
  const b = thread("b", [msg("Dev", { ts: "2026-01-03T00:00:00Z" })]);
  const c = thread("c", [msg("Dev", { ts: "garbage" })]);
  assert.deepEqual(Mailbox.newestFirst([a, c, b]).map((t) => t.id), ["b", "a", "c"]);
  assert.equal(Mailbox.lastActivity({ id: "x" }), 0);
});

test("search: all words must match across subject, people and new text", () => {
  const t = thread("a", [msg("Luis Ortega", { to: ["Maya Chen"], body: "Pricing claim needs legal sign-off" })], { subject: "Q4 Launch" });
  assert.ok(Mailbox.matchesQuery(t, "")); assert.ok(Mailbox.matchesQuery(t, "   "));
  assert.ok(Mailbox.matchesQuery(t, "launch")); assert.ok(Mailbox.matchesQuery(t, "LEGAL pricing"));
  assert.ok(Mailbox.matchesQuery(t, "luis")); assert.ok(!Mailbox.matchesQuery(t, "legal budget"));
});

test("search: from: narrows to senders; empty from: is ignored", () => {
  const t = thread("a", [msg("Luis Ortega", { to: ["Dev Patel"] })]);
  assert.ok(Mailbox.matchesQuery(t, "from:luis")); assert.ok(!Mailbox.matchesQuery(t, "from:dev"), "Dev is only a recipient");
  assert.ok(Mailbox.matchesQuery(t, "from:"));
});

test("search ignores quoted history", () => {
  const t = thread("a", [msg("Dev", { body: "Thanks!\n\nOn Mon, Bob wrote:\n> the secret codeword is zebra" })]);
  assert.ok(!Mailbox.matchesQuery(t, "zebra")); assert.ok(Mailbox.matchesQuery(t, "thanks"));
});

test("search is safe on malformed threads and regex-looking input", () => {
  assert.ok(!Mailbox.matchesQuery({ id: "x" }, "anything"));
  assert.ok(!Mailbox.matchesQuery(thread("a", [msg("Dev")]), "(.*)[")); // treated as plain text, never a regex
  assert.ok(Mailbox.matchesQuery(thread("a", [msg("Dev", { body: "cost is $5 (approx)" })]), "$5 (approx)"));
});

test("summarizeThread: sender list, snippet, count and unread", () => {
  const t = thread("a", [msg("Dev", { ts: "2026-01-01T10:00:00Z", body: "First" }), msg(ME, { ts: "2026-01-01T11:00:00Z", body: "Second line\nmore" }), msg("Sara", { ts: "2026-01-01T12:00:00Z", body: "Third" })]);
  const seen = Date.parse("2026-01-01T10:30:00Z");
  const s = Mailbox.summarizeThread(t, { me: ME, lastSeen: seen });
  assert.equal(s.who, "Dev, me, Sara"); assert.equal(s.snippet, "Third"); assert.equal(s.count, 3); assert.equal(s.unread, 1, "only Sara's is after lastSeen and not mine");
});

test("summarizeThread falls back to thread.lastSeen and handles empty threads", () => {
  const t = thread("a", [msg("Dev", { ts: "2026-01-01T10:00:00Z" })], { lastSeen: 0 });
  assert.equal(Mailbox.summarizeThread(t, { me: ME, lastSeen: null }).unread, 1);
  assert.equal(Mailbox.summarizeThread(t, { me: ME, lastSeen: Date.now() }).unread, 0, "stored value wins over the thread default");
  const empty = Mailbox.summarizeThread(thread("e", []), { me: ME, lastSeen: null });
  assert.equal(empty.snippet, "(no messages)"); assert.equal(empty.count, 0);
});

test("parseRecipients: separators, whitespace, duplicates, case", () => {
  assert.deepEqual(Mailbox.parseRecipients(" a@x.com, B ;c\nA@X.com,,  "), ["a@x.com", "B", "c"]);
  assert.deepEqual(Mailbox.parseRecipients(""), []); assert.deepEqual(Mailbox.parseRecipients(null), []);
});

test("createConversation builds a one-message thread from me", () => {
  const c = Mailbox.createConversation({ id: "c-1", me: ME, to: ["dev@x.com"], subject: "  Hi  ", body: "Body \n", now: Date.parse("2026-02-03T04:05:06Z") });
  assert.equal(c.id, "c-1"); assert.equal(c.subject, "Hi"); assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].from, ME); assert.deepEqual(c.messages[0].to, ["dev@x.com"]); assert.equal(c.messages[0].body, "Body");
  assert.equal(c.messages[0].ts, "2026-02-03T04:05:06.000Z");
  assert.ok(!Mailbox.belongsToFolder("inbox", c, { me: ME, flags: noFlags() }));
  assert.ok(Mailbox.belongsToFolder("sent", c, { me: ME, flags: noFlags() }));
});

test("every folder has a label and an empty-state text", () => {
  for (const f of Mailbox.FOLDERS) { assert.ok(Mailbox.FOLDER_LABELS[f]); assert.ok(Mailbox.EMPTY_TEXT[f]); }
});
