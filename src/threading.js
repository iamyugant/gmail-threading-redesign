/*
 * Thread model: turns a bag of email-like messages into a single-rooted reply tree and
 * derives the state the UI needs (ledger, unread, audience drift, lineage).
 *
 * Pure functions only: no DOM, no React, no storage. The browser loads this as a classic
 * script (window.Threading); Node tests load it with require().
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Threading = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ACTION_TYPES = new Set(["decision", "question", "blocker"]);

  // Small helpers

  const toText = (v) => { try { return v == null ? "" : String(v); } catch { return ""; } }; // hostile toString() must not crash a render
  const trimmed = (v) => toText(v).trim();
  const nameKey = (v) => trimmed(v).toLowerCase();
  const toList = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(trimmed).filter(Boolean);

  /** De-duplicates case-insensitively, keeping first spelling; `exclude` names are dropped. */
  function uniqueNames(list, exclude = []) {
    const seen = new Set(exclude.map(nameKey));
    const out = [];
    for (const name of list) {
      const key = nameKey(name);
      if (key && !seen.has(key)) { seen.add(key); out.push(trimmed(name)); }
    }
    return out;
  }

  const firstNameOf = (name) => trimmed(name).split(/\s+/)[0] || "?";
  const displayFirstName = (name, me) => (me && nameKey(name) === nameKey(me) ? "me" : firstNameOf(name));
  const initialOf = (name) => { const ch = [...trimmed(name)][0]; return ch ? ch.toUpperCase() : "?"; };

  /** First name, unless someone else in `universe` shares it, then the full name ("Alex, Alex" helps nobody). */
  function shortName(name, universe = []) {
    const first = firstNameOf(name).toLowerCase();
    const clashes = universe.some((other) => nameKey(other) !== nameKey(name) && firstNameOf(other).toLowerCase() === first);
    return clashes ? trimmed(name) : firstNameOf(name);
  }

  const listNames = (names, max = 3) =>
    names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} +${names.length - max} more`;

  function firstLine(text, max = 140) {
    const line = toText(text).split("\n").map((l) => l.trim()).find(Boolean) || "";
    return line.length > max ? line.slice(0, max - 1) + "…" : line;
  }

  const TIME_OPTS = { hour: "numeric", minute: "2-digit" };
  function formatDate(ts, now = Date.now(), dateOnly = false) {
    if (ts == null || isNaN(ts)) return "";
    if (!dateOnly && now - ts >= 0 && now - ts < 60000) return "Just now";
    const d = new Date(ts);
    if (d.toDateString() === new Date(now).toDateString()) return d.toLocaleTimeString("en-US", TIME_OPTS);
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return dateOnly ? day : `${day}, ${d.toLocaleTimeString("en-US", TIME_OPTS)}`;
  }

  // Tree construction

  /** Validates and normalises raw messages. Anything unusable is skipped and reported in `warnings`. */
  function coerceMessages(raw, warnings) {
    const seenIds = new Set();
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((m, index) => {
      if (!m || typeof m !== "object" || Array.isArray(m)) { warnings.push({ code: "invalid-message", index }); return; }
      const id = m.id == null || m.id === "" ? `auto-${index}` : String(m.id);
      if (seenIds.has(id)) { warnings.push({ code: "duplicate-id", id }); return; }
      seenIds.add(id);
      const ts = Date.parse(m.ts);
      out.push({
        ...m,
        id,
        parent: m.parent == null || m.parent === "" ? null : String(m.parent),
        from: trimmed(m.from) || "Unknown sender",
        to: toList(m.to),
        cc: toList(m.cc),
        references: toList(m.references),
        body: typeof m.body === "string" ? m.body : toText(m.body),
        actions: (Array.isArray(m.actions) ? m.actions : [])
          .filter((a) => a && ACTION_TYPES.has(a.type) && trimmed(a.text))
          .map((a) => ({ type: a.type, text: trimmed(a.text) })),
        _ts: isNaN(ts) ? null : ts,
        _i: index,
      });
    });
    return out;
  }

  /**
   * Gives every message a sortable time. A message with no parseable timestamp inherits the previous
   * valid one, so it stays where the sender's client put it instead of jumping to 1970 (which would
   * sort it above its own parent and make the cycle breaker pick the wrong victim).
   */
  function assignEffectiveTimes(messages) {
    let previous = 0;
    messages.forEach((m) => {
      m._eff = m._ts != null ? (previous = m._ts) : previous;
      m.date = m._ts != null ? formatDate(m._ts) : trimmed(m.date);
      m.dateShort = m._ts != null ? formatDate(m._ts, Date.now(), true) : m.date;
    });
    return messages.slice().sort((a, b) => a._eff - b._eff || a._i - b._i);
  }

  /**
   * Picks a parent for every non-root message.
   *  - explicit parent that exists: use it
   *  - parent missing / self-referencing / absent: nearest surviving id in `references` (JWZ-style: the
   *    References chain lets us "see past" a lost message), else the root
   *  - legacy client with no threading headers: root, flagged so the UI can say why
   */
  function assignParents(sorted, byId, root) {
    const nearestReference = (m) => m.references.slice().reverse().find((ref) => ref !== m.id && byId.has(ref)) || null;
    sorted.forEach((m) => {
      const node = byId.get(m.id);
      if (node === root) return;
      const attach = (parentId, fallback) => { node.parentId = parentId; node.fallback = fallback; };
      const viaReferences = (reason) => {
        const ref = nearestReference(m);
        return ref ? attach(ref, "partial-references") : attach(root.id, reason);
      };
      if (m.missingHeaders) attach(root.id, "missing-metadata");
      else if (m.parent == null) viaReferences("missing-metadata");
      else if (m.parent === m.id || !byId.has(m.parent)) viaReferences("orphan");
      else node.parentId = m.parent;
    });
  }

  /**
   * Reply loops (A replies to B, B to A) come from broken clients or merged mailboxes. Walk each
   * node up toward the root; on finding a loop, re-parent the loop's earliest message to the root.
   * Earliest-first keeps the outcome deterministic and matches what a human would call "the original".
   */
  function breakCycles(sorted, byId, root) {
    const reachesRoot = new Set([root.id]);
    sorted.forEach((m) => {
      for (let guard = 0; !reachesRoot.has(m.id) && guard <= sorted.length; guard++) {
        const path = [byId.get(m.id)];
        const onPath = new Set([m.id]);
        let cursor = path[0];
        let loop = null;
        while (!reachesRoot.has(cursor.id)) {
          const next = byId.get(cursor.parentId);
          if (onPath.has(next.id)) { loop = path.slice(path.indexOf(next)); break; }
          path.push(next); onPath.add(next.id); cursor = next;
        }
        if (loop) {
          const earliest = loop.reduce((a, b) => (b.order < a.order ? b : a));
          earliest.parentId = root.id;
          earliest.fallback = "cycle";
        } else path.forEach((n) => reachesRoot.add(n.id));
      }
    });
  }

  /** Iterative BFS/reverse pass: depth and descendant counts without recursion (threads can be thousands deep). */
  function measureTree(root) {
    const order = [root];
    for (let i = 0; i < order.length; i++) {
      order[i].children.forEach((child) => { child.depth = order[i].depth + 1; order.push(child); });
    }
    for (let i = order.length - 1; i >= 0; i--) {
      order[i].size = order[i].children.reduce((sum, child) => sum + 1 + child.size, 0);
    }
  }

  /**
   * Builds the reply tree. Guarantees: every valid message appears exactly once, there are no cycles,
   * and there is exactly one root (none only for an empty thread).
   */
  function buildThreadTree(raw) {
    const warnings = [];
    const sorted = assignEffectiveTimes(coerceMessages(raw, warnings));
    const byId = new Map();
    sorted.forEach((m, order) => byId.set(m.id, { ...m, children: [], fallback: null, parentId: null, depth: 0, size: 0, order }));
    if (!sorted.length) return { root: null, byId, messages: [], warnings };

    const trueRoot = sorted.find((m) => m.parent == null && !m.missingHeaders);
    const root = byId.get((trueRoot || sorted[0]).id);

    assignParents(sorted, byId, root);
    breakCycles(sorted, byId, root);
    sorted.forEach((m) => { const node = byId.get(m.id); if (node !== root) byId.get(node.parentId).children.push(node); });
    measureTree(root);
    root.parentId = null;
    return { root, byId, messages: sorted.map((m) => byId.get(m.id)), warnings };
  }

  const countBranches = (tree) => tree.messages.filter((n) => n.children.length === 0).length;

  function ancestorIds(byId, id) {
    const out = [];
    for (let node = byId.get(id); node && node.parentId != null; node = byId.get(node.parentId)) out.push(node.parentId);
    return out;
  }

  /** Ids in reading order, skipping the descendants of folded nodes. */
  function visibleOrder(root, folded = new Set()) {
    const out = [];
    if (!root) return out;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      out.push(node.id);
      if (!folded.has(node.id)) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    return out;
  }

  // Lineage & navigation

  /** Focus mode: the path to the root, the message itself and everything below it. Siblings are excluded. */
  function resolveLineage(tree, id) {
    const start = tree.byId.get(String(id));
    if (!start) return null;
    const lineage = new Set([start.id]);
    ancestorIds(tree.byId, start.id).forEach((a) => lineage.add(a));
    const stack = start.children.slice();
    while (stack.length) {
      const node = stack.pop();
      lineage.add(node.id);
      node.children.forEach((c) => stack.push(c));
    }
    return lineage;
  }

  const findForkHeads = (tree) =>
    tree.messages.filter((n) => n.children.length >= 2).flatMap((n) => n.children.map((c) => ({ id: c.id, forkId: n.id })));

  /** Next unread message in time order across branches, wrapping around; null if nothing is unread. */
  function findNextUnread(tree, unreadIds, currentId) {
    const unread = tree.messages.filter((n) => unreadIds.has(n.id));
    if (!unread.length) return null;
    const current = tree.byId.get(String(currentId));
    const after = unread.find((n) => n.order > (current ? current.order : -1));
    return (after || unread[0]).id;
  }

  // Message text

  const ORIGINAL_MESSAGE_RE = /^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i;
  const isQuoteLine = (line) => line.trimStart().startsWith(">");

  /**
   * Splits a body into what the sender just wrote and the history quoted below it. Only a trailing
   * quote block is cut: interleaved replies ("> Q1 / A1 / > Q2 / A2") are the message and stay intact.
   */
  function splitQuoted(body) {
    const source = typeof body === "string" ? body.replace(/\r\n?/g, "\n") : "";
    const lines = source.split("\n");
    let cut = lines.findIndex((line, i) =>
      ORIGINAL_MESSAGE_RE.test(line) || (/^From:\s/.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date):\s/.test(l))));

    if (cut < 0) {
      let start = lines.length;
      while (start > 0 && (lines[start - 1].trim() === "" || isQuoteLine(lines[start - 1]))) start--;
      if (start < lines.length && lines.slice(start).some(isQuoteLine)) {
        cut = start;
        if (cut > 0 && /wrote:\s*$/i.test(lines[cut - 1])) {
          cut--;
          // Long addresses wrap the attribution over two lines ("On Mon, … <a@b.c>" / "wrote:").
          if (cut > 0 && !/^On\s/.test(lines[cut]) && /^On\s/.test(lines[cut - 1])) cut--;
        }
      }
    }
    if (cut < 0) return { text: source.trimEnd(), quoted: "", quotedLines: 0 };
    const quoted = lines.slice(cut).join("\n").trim();
    return { text: lines.slice(0, cut).join("\n").trimEnd(), quoted, quotedLines: quoted ? quoted.split("\n").length : 0 };
  }

  /** Quoted reply preamble for a message we send (capped, so replying to an essay doesn't paste the essay). */
  function quoteBlock(parent, maxLines = 8) {
    const lines = (splitQuoted(parent.body).text.trim() || "(no text)").split("\n");
    const quoted = lines.slice(0, maxLines).map((l) => "> " + l);
    if (lines.length > maxLines) quoted.push("> …");
    return `On ${parent.date}, ${parent.from} wrote:\n${quoted.join("\n")}`;
  }

  // The lookbehind keeps e-mail addresses (maya@example.com) and "@@x" from being read as mentions.
  const MENTION_RE = /(?<![\p{L}\p{N}_.@])@[\p{L}][\p{L}\p{N}_-]*/gu;

  function tokenizeMentions(text) {
    const source = typeof text === "string" ? text : "";
    const tokens = [];
    let cursor = 0;
    let match;
    MENTION_RE.lastIndex = 0;
    while ((match = MENTION_RE.exec(source))) {
      if (match.index > cursor) tokens.push({ text: source.slice(cursor, match.index), mention: null });
      tokens.push({ text: match[0], mention: match[0].slice(1) });
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) tokens.push({ text: source.slice(cursor), mention: null });
    return tokens;
  }

  const handleForms = (name) => {
    const parts = nameKey(name).split(/\s+/).filter(Boolean);
    return [parts[0], parts.join(""), parts.join("."), parts.join("_")];
  };
  const mentionsPerson = (text, name) => {
    const forms = new Set(handleForms(name));
    return tokenizeMentions(text).some((t) => t.mention && forms.has(t.mention.toLowerCase()));
  };
  const resolveMention = (handle, names) => names.find((n) => handleForms(n).includes(nameKey(handle))) || null;

  /** Default recipients for replying to `target`. Replying to your own message goes to its original audience. */
  function replyRecipients(target, me) {
    if (nameKey(target.from) === nameKey(me)) {
      const to = uniqueNames(toList(target.to), [me]);
      return { to, cc: uniqueNames(toList(target.cc), [me, ...to]) };
    }
    const to = uniqueNames([target.from], [me]);
    return { to, cc: uniqueNames([...toList(target.to), ...toList(target.cc)], [me, ...to]) };
  }

  // Audience drift

  const audienceOf = (message) => uniqueNames([message.from, ...toList(message.to), ...toList(message.cc)]);

  /** Who was on the parent message but is absent from this reply, and who joined. Null for the root. */
  function calculateAudienceDrift(message, parent) {
    if (!parent) return null;
    const before = audienceOf(parent);
    const after = audienceOf(message);
    const afterKeys = new Set(after.map(nameKey));
    const beforeKeys = new Set(before.map(nameKey));
    return {
      dropped: before.filter((n) => !afterKeys.has(nameKey(n))),
      added: after.filter((n) => !beforeKeys.has(nameKey(n))),
    };
  }

  // Thread analysis

  const descendantsInTimeOrder = (node) => {
    const out = [];
    const stack = node.children.slice();
    while (stack.length) {
      const n = stack.pop();
      out.push(n);
      n.children.forEach((c) => stack.push(c));
    }
    return out.sort((a, b) => a.order - b.order);
  };

  /** Who a question is aimed at: the people it @mentions, else its To list (never the asker). */
  function whoIsAsked(message, allNames) {
    const mentioned = tokenizeMentions(splitQuoted(message.body).text)
      .filter((t) => t.mention)
      .map((t) => resolveMention(t.mention, allNames))
      .filter(Boolean);
    return uniqueNames(mentioned.length ? mentioned : message.to, [message.from]);
  }

  /**
   * One ledger row per decision/question/blocker, with a status derived from the tree:
   *  - question: resolved when someone it was aimed at replies somewhere below it
   *  - blocker: resolved by the latest decision recorded below it
   * `manual` overrides always win, and are flagged so the UI can say "Marked resolved".
   */
  function buildLedger(messages, allNames, manual) {
    const items = [];
    messages.forEach((node) => node.actions.forEach((action, index) => {
      const key = `${node.id}:${index}`;
      const item = { key, id: node.id, type: action.type, text: action.text, from: node.from, state: "open", by: null, manual: false, asked: [] };
      if (action.type === "decision") {
        item.state = "decided";
      } else {
        const below = descendantsInTimeOrder(node);
        if (action.type === "question") {
          item.asked = whoIsAsked(node, allNames);
          item.by = below.find((d) => nameKey(d.from) !== nameKey(node.from) &&
            (item.asked.length === 0 || item.asked.some((a) => nameKey(a) === nameKey(d.from)))) || null;
        } else {
          const decisions = below.filter((d) => d.actions.some((a) => a.type === "decision"));
          item.by = decisions.length ? decisions[decisions.length - 1] : null;
        }
        item.state = item.by ? "resolved" : "open";
        if (manual[key] === "resolved" || manual[key] === "open") {
          item.state = manual[key];
          item.manual = true;
          item.by = null;
        }
      }
      items.push(item);
    }));
    return items;
  }

  /**
   * "Dropped off" means absent from the latest reply of every branch. Comparing against only the newest
   * message would flag nearly everyone in any forked thread, which teaches people to ignore the signal.
   */
  function describePeople(messages, allNames, openItems) {
    const onLatestReplies = new Set();
    messages.filter((n) => n.children.length === 0).forEach((n) => audienceOf(n).forEach((p) => onLatestReplies.add(nameKey(p))));
    return allNames.map((name) => {
      const written = messages.filter((m) => nameKey(m.from) === nameKey(name));
      const lastActive = written.length ? written[written.length - 1] : null;
      const pending = openItems.filter((i) => i.type === "question" && i.asked.some((a) => nameKey(a) === nameKey(name)));
      const dropped = !onLatestReplies.has(nameKey(name));
      const notes = [];
      if (dropped) notes.push(lastActive ? `Last active ${lastActive.date} · not copied on the latest replies` : "Copied earlier, never replied · not on the latest replies");
      if (pending.length) notes.push(`Waiting on their answer: “${pending[0].text}”`);
      return { name, dropped, pending, lastActive, note: notes.join(" · ") };
    });
  }

  /** Unread = newer than `lastSeen`, not written by me, and not already opened this visit. */
  function summariseUnread(tree, items, openItems, { me, lastSeen, read }) {
    const unread = tree.messages.filter((m) =>
      lastSeen != null && m._eff > lastSeen && nameKey(m.from) !== nameKey(me) && !read.has(m.id));
    const unreadIds = new Set(unread.map((m) => m.id));
    const topLevelBranch = (node) => { while (node.depth > 1) node = tree.byId.get(node.parentId); return node.id; };
    const summary = {
      count: unreadIds.size,
      since: lastSeen,
      branches: new Set(unread.map(topLevelBranch)).size,
      decisions: items.filter((i) => i.type === "decision" && unreadIds.has(i.id)).length,
      questionsForMe: openItems.filter((i) => i.type === "question" && unreadIds.has(i.id) && i.asked.some((a) => nameKey(a) === nameKey(me))).length,
      mentions: unread.filter((m) => mentionsPerson(splitQuoted(m.body).text, me)).length,
    };
    return { unreadIds, summary };
  }

  /** Per-message recipient drift, skipping messages placed by time: a diff against an arbitrary node would mislead. */
  function collectAudienceDrift(tree) {
    const drift = new Map();
    tree.messages.forEach((node) => {
      if (node.parentId == null || node.fallback) return;
      const d = calculateAudienceDrift(node, tree.byId.get(node.parentId));
      if (d && (d.dropped.length || d.added.length)) drift.set(node.id, d);
    });
    return drift;
  }

  /**
   * Everything the overview needs, derived from the tree alone:
   * ledger `items`, `people` status, `unreadIds` + `summary`, and per-message audience `drift`.
   */
  function analyzeThread(tree, { me = "", lastSeen = null, manual = {}, read = new Set() } = {}) {
    const allNames = uniqueNames(tree.messages.flatMap((m) => [m.from, ...m.to, ...m.cc]));
    const items = buildLedger(tree.messages, allNames, manual);
    const openItems = items.filter((i) => i.state === "open");
    const { unreadIds, summary } = summariseUnread(tree, items, openItems, { me, lastSeen, read });
    return {
      items,
      openCount: openItems.length,
      people: describePeople(tree.messages, allNames, openItems),
      newIds: unreadIds,
      summary,
      deltas: collectAudienceDrift(tree),
    };
  }

  /** Pure ledger transition; `message` is what assistive technology is told. */
  function toggleResolution(manual, item) {
    const resolved = item.state !== "resolved";
    return {
      manual: { ...manual, [item.key]: resolved ? "resolved" : "open" },
      resolved,
      message: `${resolved ? "Marked resolved" : "Reopened"}: ${item.text}`,
    };
  }

  return {
    buildThreadTree, countBranches, ancestorIds, visibleOrder,
    resolveLineage, findForkHeads, findNextUnread,
    splitQuoted, quoteBlock, tokenizeMentions, mentionsMe: mentionsPerson, resolveMention, replyRecipients,
    calculateAudienceDrift, analyzeThread, toggleResolution,
    shortName, listNames, firstLine, uniq: uniqueNames, first: displayFirstName, initial: initialOf, formatDate,
  };
});
