/*
 * Mailbox model: which folder a conversation belongs in, how search matches it, and what an inbox row shows.
 *
 * Pure functions, same loading rules as threading.js (window.Mailbox in the browser, require() in Node).
 */
(function (root, factory) {
  const threading = typeof module === "object" && module.exports ? require("./threading.js") : root.Threading;
  const api = factory(threading);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Mailbox = api;
})(typeof self !== "undefined" ? self : this, function (Threading) {
  const FOLDERS = ["inbox", "starred", "sent", "drafts", "archived", "trash"];
  const FOLDER_LABELS = { inbox: "Inbox", starred: "Starred", sent: "Sent", drafts: "Drafts", archived: "Archived", trash: "Trash" };
  const EMPTY_TEXT = {
    inbox: "Your inbox is empty.",
    starred: "No starred conversations. Star one to find it quickly.",
    sent: "You haven't sent anything yet.",
    drafts: "No drafts.",
    archived: "Nothing archived.",
    trash: "Trash is empty.",
  };

  // A malformed thread (say, a subject whose toString() throws) must never break the list it appears in.
  const text = (v) => { try { return v == null ? "" : String(v); } catch { return ""; } };
  const sameName = (a, b) => text(a).trim().toLowerCase() === text(b).trim().toLowerCase();
  const messagesOf = (thread) => (thread && Array.isArray(thread.messages) ? thread.messages.filter((m) => m && typeof m === "object") : []);

  /** Whether anyone else wrote in the thread (inbox material) and whether I did (sent material). */
  function authorship(thread, me) {
    const messages = messagesOf(thread);
    return {
      hasIncoming: messages.some((m) => !sameName(m.from, me)),
      hasOutgoing: messages.some((m) => sameName(m.from, me)),
    };
  }

  /**
   * Folder membership. Trash wins over everything; archiving removes a thread from the inbox only.
   * `flags` holds id -> true maps: { starred, archived, trashed }.
   */
  function belongsToFolder(folder, thread, { me, flags, hasDraft }) {
    const id = thread.id;
    const trashed = !!flags.trashed[id];
    if (folder === "trash") return trashed;
    if (trashed) return false;
    const { hasIncoming, hasOutgoing } = authorship(thread, me);
    switch (folder) {
      case "inbox": return hasIncoming && !flags.archived[id];
      case "starred": return !!flags.starred[id];
      case "sent": return hasOutgoing;
      case "drafts": return !!hasDraft;
      case "archived": return !!flags.archived[id];
      default: return false;
    }
  }

  function lastActivity(thread) {
    const times = messagesOf(thread).map((m) => Date.parse(m.ts)).filter((t) => !isNaN(t));
    return times.length ? Math.max(...times) : 0;
  }

  const newestFirst = (threads) => threads.slice().sort((a, b) => lastActivity(b) - lastActivity(a));

  /**
   * Plain words must all appear in the subject, participants or newly written text of some message.
   * `from:name` narrows to conversations where that sender wrote. Quoted history is ignored so a reply
   * does not match just because it quotes the word.
   */
  function matchesQuery(thread, query) {
    const terms = text(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const messages = messagesOf(thread);
    const haystack = [
      text(thread.subject),
      ...messages.flatMap((m) => [text(m.from), ...[].concat(m.to || []).map(text), ...[].concat(m.cc || []).map(text), Threading.splitQuoted(m.body).text]),
    ].join("\n").toLowerCase();
    return terms.every((term) => {
      if (term.startsWith("from:")) {
        const sender = term.slice(5);
        return !sender || messages.some((m) => text(m.from).toLowerCase().includes(sender));
      }
      return haystack.includes(term);
    });
  }

  /** Everything an inbox row needs. Throws only if the thread is unusable; callers guard for that. */
  function summarizeThread(thread, { me, lastSeen }) {
    const tree = Threading.buildThreadTree(thread.messages);
    const messages = tree.messages;
    const last = messages[messages.length - 1];
    const seen = typeof lastSeen === "number" ? lastSeen : thread.lastSeen != null ? thread.lastSeen : null;
    const unread = Threading.analyzeThread(tree, { me, lastSeen: seen }).summary.count;
    return {
      who: Threading.uniq(messages.map((m) => Threading.first(m.from, me))).slice(0, 3).join(", "),
      subject: text(thread.subject).trim(),
      snippet: last ? (Threading.firstLine(Threading.splitQuoted(last.body).text) || "(no message body)") : "(no messages)",
      when: last ? Threading.formatDate(last._ts, Date.now(), true) : "",
      count: messages.length,
      unread,
    };
  }

  /** Splits "a@x.com, Bob; carol" into clean, de-duplicated recipients. */
  function parseRecipients(value) {
    return Threading.uniq(text(value).split(/[,;\n]/));
  }

  /** Builds the stored form of a newly composed conversation. */
  function createConversation({ id, me, to, subject, body, now = Date.now() }) {
    return {
      id,
      subject: text(subject).trim(),
      messages: [{ id: "1", parent: null, from: me, to, cc: [], ts: new Date(now).toISOString(), body: text(body).trimEnd() }],
    };
  }

  return { FOLDERS, FOLDER_LABELS, EMPTY_TEXT, authorship, belongsToFolder, newestFirst, lastActivity, matchesQuery, summarizeThread, parseRecipients, createConversation };
});
