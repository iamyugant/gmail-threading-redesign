/*
 * localStorage wrappers. Storage can be missing (sandboxed iframes, privacy modes) or full, so every
 * call swallows the error and reports failure through its return value instead.
 */
window.ThreadStorage = (function () {
  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  };
  const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const remove = (key) => { try { localStorage.removeItem(key); } catch { /* nothing to clean up */ } };

  const draftKey = (threadId, messageId) => `gmail-draft:${threadId}:${messageId}`;

  /** Returns { text, to, cc } or null when nothing usable is stored (corrupt JSON counts as nothing). */
  function loadDraft(key) {
    const d = readJSON(key, null);
    if (!d || typeof d.text !== "string") return null;
    return { text: d.text, to: Array.isArray(d.to) ? d.to : null, cc: Array.isArray(d.cc) ? d.cc : null };
  }

  /** Ids of messages in this thread that have a non-empty saved draft. */
  function draftedMessageIds(threadId) {
    const ids = new Set();
    try {
      const prefix = `gmail-draft:${threadId}:`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const draft = loadDraft(key);
        if (draft && draft.text.trim()) ids.add(key.slice(prefix.length));
      }
    } catch { /* storage unavailable: no drafts to show */ }
    return ids;
  }

  return {
    readJSON, writeJSON, remove, draftKey, loadDraft, draftedMessageIds,
    saveDraft: writeJSON, clearDraft: remove,
    lastSeenKey: (threadId) => `gmail-lastseen:${threadId}`,
    resolutionsKey: (threadId) => `gmail-resolved:${threadId}`,
  };
})();
