/*
 * React hooks for the thread view. Loaded as a classic script after React; JSX-free on purpose so
 * the page still opens straight from disk (Babel cannot fetch external .jsx files over file://).
 */
window.ThreadHooks = (function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const T = window.Threading;
  const Store = window.ThreadStorage;

  // DOM helpers

  const findMessageElement = (id) => [...document.querySelectorAll("[data-mid]")].find((el) => el.dataset.mid === String(id));

  function focusMessageHeader(id, options) {
    const el = findMessageElement(id);
    const header = el && el.querySelector("[data-header]");
    if (header) header.focus(options);
  }

  // Environment

  function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => matchMedia(query).matches);
    useEffect(() => {
      const list = matchMedia(query);
      const onChange = () => setMatches(list.matches);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    }, [query]);
    return matches;
  }

  /** Below Tailwind's `sm` breakpoint (640px). At 375px each indent level costs ~24px of a ~340px column. */
  const useNarrowViewport = () => useMediaQuery("(max-width: 639px)");

  /** Browser connectivity, with a manual switch so the offline flow can be demonstrated. */
  function useOnlineStatus(simulatedOffline) {
    const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
    useEffect(() => {
      const up = () => setBrowserOnline(true);
      const down = () => setBrowserOnline(false);
      window.addEventListener("online", up);
      window.addEventListener("offline", down);
      return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
    }, []);
    return browserOnline && !simulatedOffline;
  }

  /** Text for an aria-live region. */
  function useAnnouncer() {
    const [announcement, setAnnouncement] = useState("");
    const flip = useRef(false);
    const announce = useCallback((message) => {
      // Screen readers skip a live-region update whose text did not change, so repeat messages alternate a zero-width space.
      flip.current = !flip.current;
      setAnnouncement(message + (flip.current ? "" : "​"));
    }, []);
    return { announcement, announce };
  }

  // Per-thread persisted state

  /**
   * Unread tracking. Everything newer than `lastSeen` (and not mine) is "new". Leaving the thread
   * moves the marker to now, like Gmail; "mark as unread" restores the starting point.
   */
  function useReadTracking({ threadId, threadLastSeen, firstMessageTime }) {
    const key = Store.lastSeenKey(threadId);
    const restartPoint = threadLastSeen != null ? threadLastSeen : firstMessageTime;
    const [lastSeen, setLastSeen] = useState(() => {
      const stored = Store.readJSON(key, null);
      return typeof stored === "number" ? stored : threadLastSeen != null ? threadLastSeen : null;
    });
    const [read, setRead] = useState(() => new Set());
    const keepUnread = useRef(false);

    useEffect(() => () => { if (!keepUnread.current) Store.writeJSON(key, Date.now()); }, [key]);

    const markRead = useCallback((id) => setRead((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
    const markAllRead = useCallback(() => { keepUnread.current = false; setLastSeen(Date.now()); }, []);
    const markUnread = useCallback(() => {
      keepUnread.current = true;
      Store.remove(key);
      setRead(new Set());
      setLastSeen(restartPoint == null ? null : restartPoint);
    }, [key, restartPoint]);
    return { lastSeen, read, markRead, markAllRead, markUnread };
  }

  /** Manual overrides of ledger status, persisted per thread. `recent` keeps just-toggled rows visible for undo. */
  function useResolutionLedger(threadId) {
    const key = Store.resolutionsKey(threadId);
    const [manual, setManual] = useState(() => {
      const stored = Store.readJSON(key, {});
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    });
    const [recent, setRecent] = useState(() => new Set());
    const latest = useRef(manual);

    /** Returns the announcement text for the change. */
    const toggleResolved = useCallback((item) => {
      const result = T.toggleResolution(latest.current, item);
      latest.current = result.manual;
      setManual(result.manual);
      Store.writeJSON(key, result.manual);
      setRecent((prev) => new Set(prev).add(item.key));
      return result.message;
    }, [key]);
    return { manual, recent, toggleResolved };
  }

  // Message disclosure & focus

  const toggled = (set, id) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };

  /** Which messages are expanded, and which have their replies folded away. */
  function useDisclosure(initialExpanded) {
    const [expanded, setExpanded] = useState(initialExpanded);
    const [folded, setFolded] = useState(() => new Set());

    const expand = useCallback((id) => setExpanded((prev) => new Set(prev).add(id)), []);
    const toggleExpanded = useCallback((id) => setExpanded((prev) => toggled(prev, id)), []);
    const setExpandedIds = useCallback((ids) => setExpanded(new Set(ids)), []);
    const toggleFold = useCallback((id) => setFolded((prev) => toggled(prev, id)), []);
    const clearFolds = useCallback(() => setFolded(new Set()), []);
    const unfold = useCallback((ids) => setFolded((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    }), []);

    return { expanded, folded, expand, toggleExpanded, setExpandedIds, toggleFold, unfold, clearFolds };
  }

  /**
   * Branch focus. While focused, everything outside the lineage is treated as folded so navigation
   * (j/k) skips it, and `describeBranch` supplies the announcement text.
   */
  function useBranchFocus(tree, folded, describeBranch, announce) {
    const [focusId, setFocusId] = useState(null);
    const lineage = React.useMemo(() => (focusId ? T.resolveLineage(tree, focusId) : null), [tree, focusId]);
    const hiddenIds = React.useMemo(() => {
      if (!lineage) return folded;
      const hidden = new Set(folded);
      tree.messages.forEach((n) => { if (!lineage.has(n.id)) hidden.add(n.id); });
      return hidden;
    }, [folded, lineage, tree]);

    const describe = useRef(describeBranch);
    describe.current = describeBranch;
    const wasFocused = useRef(false);
    useEffect(() => {
      const node = focusId && tree.byId.get(focusId);
      if (node) announce(`Focused on branch: ${describe.current(node)}. Other branches are dimmed.`);
      else if (wasFocused.current) announce("Showing all branches.");
      wasFocused.current = !!focusId;
    }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps -- announce only when focus changes, not when the tree grows

    const toggleFocus = useCallback((id) => setFocusId((prev) => (prev === id ? null : id)), []);
    const clearFocus = useCallback(() => setFocusId(null), []);
    return { focusId, lineage, hiddenIds, toggleFocus, clearFocus };
  }

  // Viewport tracking

  /**
   * Two IntersectionObservers over the rendered messages:
   *  - scroll-spy: the message crossing the upper band of the viewport becomes "current"
   *  - in-view set: every message currently on screen (the minimap's grey band)
   * `suppressUntil.current` holds off scroll-spy right after a programmatic jump, so the smooth scroll
   * passing other messages does not steal the selection.
   */
  function useScrollTracking({ enabled, messageCount, hiddenIds, expanded, suppressUntil, onCurrent }) {
    const [inView, setInView] = useState(() => new Set());
    const supported = typeof IntersectionObserver !== "undefined";
    const messageElements = () => document.querySelectorAll("[id^='msg-']");
    const onCurrentRef = useRef(onCurrent);
    onCurrentRef.current = onCurrent;

    useEffect(() => {
      if (!enabled || !supported) return undefined;
      const observer = new IntersectionObserver((entries) => {
        if (Date.now() < suppressUntil.current) return;
        const topmost = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (topmost) onCurrentRef.current(topmost.target.id.slice(4));
      }, { rootMargin: "-20% 0px -70% 0px" });
      messageElements().forEach((el) => observer.observe(el));
      return () => observer.disconnect();
    }, [enabled, supported, messageCount, hiddenIds, expanded, suppressUntil]);

    useEffect(() => {
      if (!enabled || !supported) return undefined;
      const observer = new IntersectionObserver((entries) => setInView((prev) => {
        const next = new Set(prev);
        entries.forEach((e) => { const id = e.target.id.slice(4); if (e.isIntersecting) next.add(id); else next.delete(id); });
        return next;
      }));
      // An element removed from the DOM never reports "not visible", so start from a clean slate on every re-observe.
      setInView(new Set());
      messageElements().forEach((el) => observer.observe(el));
      return () => observer.disconnect();
    }, [enabled, supported, messageCount, hiddenIds]);

    return inView;
  }

  // Keyboard

  /**
   * Thread shortcuts: j/k move, n next unread, o open/close, f fold, b focus branch, x resolve, r reply,
   * e archive, # delete, Esc leaves focus mode. `api` is read through a ref so the listener is registered once.
   * Ignored while typing, and with Ctrl/Cmd/Alt held so browser shortcuts keep working.
   */
  function useThreadShortcuts(api) {
    const latest = useRef(api);
    latest.current = api;
    useEffect(() => {
      const onKeyDown = (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target;
        if (target && target.closest && target.closest("input, textarea, select, [contenteditable='true']")) return;
        const a = latest.current;
        if (!a.root) return;
        if (e.key === "Escape" && a.focusId) { a.clearFocus(); return; }
        if (e.key === "e" && a.archive) { e.preventDefault(); a.archive(); return; }
        if (e.key === "#" && a.trash) { e.preventDefault(); a.trash(); return; }

        const holder = target && target.closest ? target.closest("[data-mid]") : null;
        const current = holder ? holder.dataset.mid : a.activeId;
        const order = T.visibleOrder(a.root, a.hiddenIds);

        if (e.key === "j" || e.key === "k") {
          e.preventDefault();
          const at = order.indexOf(current);
          a.navigateTo(order[e.key === "j" ? Math.min(order.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1)]);
        } else if (e.key === "n") {
          e.preventDefault();
          a.nextUnread(current);
        } else if (current != null && order.includes(current)) {
          const action = { o: a.toggleOpen, f: a.toggleFold, b: a.toggleFocus, x: a.resolve, r: a.reply }[e.key];
          if (action) { e.preventDefault(); action(current); }
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, []);
  }

  // Routing, mailbox, toasts

  /** Routes look like #/inbox, #/sent/<threadId>, #/inbox?q=launch. The hash keeps deep links and the Back button working on static hosting. */
  function parseRoute(hash) {
    const [path, queryString = ""] = String(hash || "").replace(/^#\/?/, "").split("?");
    const parts = path.split("/").filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
    return {
      folder: window.Mailbox.FOLDERS.includes(parts[0]) ? parts[0] : "inbox",
      threadId: parts[1] != null ? parts[1] : null,
      query: new URLSearchParams(queryString).get("q") || "",
    };
  }

  function formatRoute({ folder, threadId = null, query = "" }) {
    const thread = threadId != null ? `/${encodeURIComponent(threadId)}` : "";
    return `#/${folder}${thread}${query ? `?q=${encodeURIComponent(query)}` : ""}`;
  }

  function useHashRoute() {
    const [route, setRoute] = useState(() => parseRoute(location.hash));
    useEffect(() => {
      const onChange = () => setRoute(parseRoute(location.hash));
      window.addEventListener("hashchange", onChange);
      return () => window.removeEventListener("hashchange", onChange);
    }, []);
    /** `replace` swaps the current history entry (used while typing a search so Back doesn't replay keystrokes). */
    const navigate = useCallback((next, { replace = false } = {}) => {
      const hash = formatRoute(next);
      setRoute(parseRoute(hash));
      if (replace) history.replaceState(null, "", hash);
      else location.hash = hash;
    }, []);
    return { route, navigate };
  }

  const EMPTY_MAILBOX = { starred: {}, archived: {}, trashed: {}, composed: [] };

  /** Stars, archive/trash placement and conversations I composed, persisted as one document. */
  function useMailboxState() {
    const [mailbox, setMailbox] = useState(() => {
      const saved = Store.readJSON(Store.mailboxKey, null);
      const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);
      return saved && isMap(saved.starred) && isMap(saved.archived) && isMap(saved.trashed) && Array.isArray(saved.composed) ? saved : EMPTY_MAILBOX;
    });
    const latest = useRef(mailbox);
    const apply = useCallback((change) => {
      const next = change(latest.current);
      latest.current = next;
      setMailbox(next);
      Store.writeJSON(Store.mailboxKey, next);
    }, []);

    const toggleStar = useCallback((id) => apply((m) => ({ ...m, starred: { ...m.starred, [id]: !m.starred[id] } })), [apply]);
    /** Returns where the conversation was, so the caller can offer Undo. */
    const moveTo = useCallback((id, place) => {
      const before = { archived: !!latest.current.archived[id], trashed: !!latest.current.trashed[id] };
      apply((m) => ({
        ...m,
        archived: { ...m.archived, [id]: place === "archived" ? true : place === "inbox" ? false : m.archived[id] },
        trashed: { ...m.trashed, [id]: place === "trash" },
      }));
      return before;
    }, [apply]);
    const restorePlacement = useCallback((id, before) => apply((m) => ({ ...m, archived: { ...m.archived, [id]: before.archived }, trashed: { ...m.trashed, [id]: before.trashed } })), [apply]);
    const addConversation = useCallback((thread) => apply((m) => ({ ...m, composed: [...m.composed, thread] })), [apply]);
    const reset = useCallback(() => { latest.current = EMPTY_MAILBOX; setMailbox(EMPTY_MAILBOX); Store.remove(Store.mailboxKey); }, []);
    return { mailbox, toggleStar, moveTo, restorePlacement, addConversation, reset };
  }

  /** One transient message with an optional action ("Undo"), dismissed after a few seconds. */
  function useToast(durationMs = 7000) {
    const [toast, setToast] = useState(null);
    const timer = useRef(null);
    const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
    const show = useCallback((next) => {
      clearTimeout(timer.current);
      setToast({ ...next, id: Date.now() });
      timer.current = setTimeout(() => setToast(null), durationMs);
    }, [durationMs]);
    useEffect(() => () => clearTimeout(timer.current), []);
    return { toast, show, dismiss };
  }

  /** Messages for a thread: the seeded ones plus replies I sent here, which survive reloads (including queued ones). */
  function useThreadMessages(thread) {
    const key = Store.repliesKey(thread.id);
    const [messages, setMessages] = useState(() => {
      const saved = Store.readJSON(key, []);
      return [...thread.messages, ...(Array.isArray(saved) ? saved.filter((m) => m && typeof m === "object") : [])];
    });
    useEffect(() => {
      const mine = messages.filter((m) => m && String(m.id).startsWith("local-"));
      if (mine.length || Store.readJSON(key, null) != null) Store.writeJSON(key, mine);
    }, [messages, key]);
    return [messages, setMessages];
  }

  // Composer draft

  /**
   * Draft state for one reply: text and recipients, autosaved every 1.5s while dirty and flushed when the
   * composer unmounts (collapsing the message mid-typing must not lose words). `finish()` ends the draft
   * for good (sent or discarded), stops the unmount flush from resurrecting it, and makes `isFinished()`
   * true so a double-click cannot send twice.
   */
  function useReplyDraft({ threadId, target, defaults, onDraftChange }) {
    const key = Store.draftKey(threadId, target.id);
    const [initial] = useState(() => {
      const saved = Store.loadDraft(key);
      return { text: saved ? saved.text : "", to: (saved && saved.to) || defaults.to, cc: (saved && saved.cc) || defaults.cc };
    });
    const [text, setText] = useState(initial.text);
    const [to, setTo] = useState(initial.to);
    const [cc, setCc] = useState(initial.cc);
    const [status, setStatus] = useState(initial.text ? "restored" : null);

    const latest = useRef({ text, to, cc });
    latest.current = { text, to, cc };
    const dirty = useRef(false);
    const finished = useRef(false);
    const notify = useRef(onDraftChange);
    notify.current = onDraftChange;

    useEffect(() => {
      const timer = setInterval(() => {
        if (!dirty.current) return;
        dirty.current = false;
        setStatus(Store.saveDraft(key, latest.current) ? "saved" : "error");
        notify.current(target.id, latest.current.text.trim() !== "");
      }, 1500);
      return () => {
        clearInterval(timer);
        if (dirty.current && !finished.current) {
          Store.saveDraft(key, latest.current);
          notify.current(target.id, latest.current.text.trim() !== "");
        }
      };
    }, [key, target.id]);

    const edited = (setter) => (value) => { setter(value); dirty.current = true; setStatus(null); };
    const finish = () => {
      finished.current = true;
      dirty.current = false;
      Store.clearDraft(key);
      notify.current(target.id, false);
    };
    const isFinished = () => finished.current;
    return { text, to, cc, status, setText: edited(setText), setTo: edited(setTo), setCc: edited(setCc), finish, isFinished };
  }

  return {
    findMessageElement, focusMessageHeader,
    useMediaQuery, useNarrowViewport, useOnlineStatus, useAnnouncer,
    useReadTracking, useResolutionLedger, useDisclosure, useBranchFocus,
    useScrollTracking, useThreadShortcuts, useReplyDraft,
    useHashRoute, useMailboxState, useToast, useThreadMessages,
  };
})();
