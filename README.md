# Gmail Threading Redesign — Enterprise Collaboration & Lineage

> An interactive, resilient threading prototype resolving conversational branching, audience drift, and decision amnesia in high-density enterprise communication.

|  |  |
|---|---|
| **Live demo** | _Placeholder — add the GitHub Pages / Vercel URL here once deployed_ |
| **Walkthrough video (5 min)** | _Placeholder — add the Loom link here_ ([script](docs/LOOM_SCRIPT.md)) |
| **Design rationale** | [docs/DESIGN.md](docs/DESIGN.md) |

![Thread overview with the resolution ledger, branch chips and audience signals](docs/screenshots/thread-overview.desktop.png)

---

## Executive summary

### The problem

Gmail renders a conversation as a chronological stack. That works for two people; it breaks down in the ten-to-fifteen-person threads that run enterprise programs:

- **Parallel conversations are flattened.** Engineering's blocker, marketing's legal question and finance's late note are interleaved in one list, so readers reconstruct who is answering whom by hand.
- **Decisions get buried.** Past a handful of replies the middle of the thread collapses behind a "···" accordion. A blocker raised in reply 2 and settled in reply 7 is re-asked in reply 11.
- **Audience changes are invisible.** When a reply goes to a subset, people silently fall off `To`/`Cc`. The person a question was aimed at never sees it, and a private back-channel forms.

### The thesis

Treat a thread as what it really is: a **tree with state and a changing audience**. The prototype turns the message list into a context-aware workspace grounded in the same ideas that make data trustworthy — *lineage* (who replied to what), *provenance* (who closed which decision, and where) and *explicit accountability* (who is still owed an answer).

---

## Key innovations & interaction architecture

### Causal focus branch — `b`
Isolate one conversation from root to tip. The path to the root and everything below the chosen message stay sharp; sibling branches dim (150 ms transition) and collapse into a `+N unselected replies` chip. `Esc` restores the full thread, and jumping to a hidden message leaves focus mode automatically so you never stare at nothing.

![Focus mode dims sibling branches](docs/screenshots/focus-branch.desktop.png)

### Interactive resolution ledger
The overview card is a live ledger of decisions, questions and blockers. Status is derived from the thread itself:

- a **question** is resolved when someone it was aimed at (`@mentions`, otherwise `To`) replies below it;
- a **blocker** is resolved by the latest decision recorded below it.

Chips read `Awaiting Sara` → `Resolved · Sara`; clicking one jumps to the reply that closed the loop. A manual **Mark resolved / Reopen** always wins and is labelled as such. The ledger leads with open items; resolved items and decisions (the audit trail) are one click away, and a row you just toggled stays visible so it can be undone.

### Audience drift & provenance badges
Every reply is diffed against its parent's audience. A badge shows who was **dropped** and who was **added**, turning amber when a dropped person is still owed an answer. Avatars in the overview grey out for people absent from every branch's latest reply, and gain a yellow dot when a question is waiting on them. When you reply, the composer warns if someone is waiting on an answer elsewhere and offers a one-click **Add to Cc**.

![Audience drift badges on replies](docs/screenshots/audience-drift.desktop.png)

### Keyboard-first velocity

| Key | Action | Key | Action |
|---|---|---|---|
| `j` / `k` | Next / previous message | `b` | Focus this branch (`Esc` to leave) |
| `o` | Open / close message | `f` | Fold / unfold replies |
| `r` | Reply inline | `x` | Resolve / reopen the message's item |
| `n` | Next unread, across branches | `Ctrl`/`⌘` + `Enter` | Send |

Also: a **catch-up banner** ("5 new replies since Sep 28 · 3 branches · 2 decisions"), a **minimap** whose ticks indent with reply depth and show which messages are on screen, and polite `aria-live` announcements for every state change.

---

## Design rationale & trade-offs

| Decision | Chosen | Over | Why |
|---|---|---|---|
| Layout | Vertical tree, indent capped at **3 levels on desktop, 2 on phones**, then a thin accent line plus a parent pill | Canvas graphs, multi-column split drawers | Keeps the reading direction email users already have and survives a 375px screen; graphs and columns don't. Tested with 120-deep chains. |
| Resolution | Deterministic, user-owned status derived from the thread, always overridable | Probabilistic, auto-generated summaries | A confident wrong summary is worse than none, and a reviewer needs to audit a decision. Every status names who closed it and links to the reply. |
| State updates | Optimistic UI: a sent reply, a resolution toggle or a queued send appears immediately | Waiting on a round trip | The prototype has no server, so the model is honest about it: drafts autosave every 1.5s, survive collapsing a message, closing the composer and reloading, and flush on unmount. |
| Offline | `Send` and `Ctrl+Enter` are blocked, with an explicit **Queue for later** that sends on reconnect | Silent auto-queue | Silently queueing text the user believes was sent is the worse failure. |
| "Dropped off" | Absent from the latest reply of *every* branch | Absent from the newest message | The naive rule flags nearly everyone in any forked thread, which teaches people to ignore the signal. |

Full write-up, research links and the iteration history: [docs/DESIGN.md](docs/DESIGN.md).

---

## Edge-case engineering & resilient graph handling

Real mail threads are messy. `buildThreadTree` in [`src/threading.js`](src/threading.js) guarantees that **every valid message appears exactly once, there are no cycles, and there is one root**, whatever it is given:

- **Cyclic replies** (A→B→A): the earliest message in each loop is re-parented to the root.
- **Orphaned parents / self-replies:** placed under the nearest surviving ancestor in the `References` chain (the JWZ threading idea), otherwise at the root, with an explanatory tooltip.
- **Duplicate ids, junk entries, mixed number/string ids:** first wins, the rest are skipped and reported.
- **Missing or out-of-order timestamps:** a message without a valid time inherits the previous one's, so it doesn't sort above its own parent.
- **Legacy clients with no threading headers:** appended chronologically and flagged.
- **Scale:** 5,000-deep and 10,000-wide trees are built without recursion; 300 messages render in under 100 ms.
- **Quoted history:** Gmail, Outlook and CRLF styles are split out; interleaved inline replies are left alone.
- **Hostile text:** rendered as text, never as markup; 600-character unbroken strings wrap instead of widening the page.
- **Storage unavailable, full or corrupt:** every read and write is guarded; the UI degrades instead of crashing.

### Zero-dependency test architecture
There is no test framework and no `node_modules`. Logic is tested with Node's built-in runner, including randomized property tests over malformed graphs. The browser suite is driven by a small script that launches headless Chrome and speaks the **Chrome DevTools Protocol** over Node's built-in `WebSocket`, running the same tests at **1440×900** and **375×812 (mobile emulation)**.

### Responsive safeguards
Nothing may cause horizontal scroll down to 375px: rows wrap instead of truncating the text that matters, the depth clamp tightens below the `sm` breakpoint (each indent costs about 24px of a ~340px column), and a test asserts that every feature active at once still fits the viewport.

---

## Local setup & automated tests

**Prerequisites:** Node.js **22 or newer** (the test driver uses the global `WebSocket`) and Google Chrome or Chromium. Nothing to install.

```bash
# Optional: serve on http://localhost:5173  (index.html also opens straight from disk)
npm start
```

The page loads React, Tailwind and fonts from public CDNs, so it needs a network connection.

```bash
# Run logic unit tests
node --test tests/threading.test.js

# Run headless browser suite via Chrome DevTools Protocol
node tests/run-ui.js
```

`npm test` runs both. Handy options for the browser suite: `UI_ONLY="focus" node tests/run-ui.js` runs matching tests, `UI_VIEWPORT=mobile` limits the width, and `CHROME=/path/to/chrome` picks a browser binary.

Current results: **94 logic tests** and **109 browser tests × 2 viewports**, all passing.

---

## Project structure

```
.
├── index.html               App shell and React components (JSX is compiled in the browser by Babel)
├── src/
│   ├── threading.js         Pure logic: tree building, ledger, unread, audience drift, lineage (no DOM)
│   ├── hooks.js             React hooks: read tracking, focus, disclosure, shortcuts, draft autosave, scroll tracking
│   ├── storage.js           Guarded localStorage helpers for drafts, read markers and resolutions
│   ├── sample-data.js       Demo conversations (dates are relative to today)
│   └── styles.css           Design tokens, buttons and motion
├── tests/
│   ├── threading.test.js    Logic tests for src/threading.js (Node built-in runner)
│   ├── ui-tests.js          Browser suite, loaded by index.html when opened with ?e2e
│   ├── run-ui.js            Runs that suite in headless Chrome at desktop and phone widths
│   ├── screenshots.js       Captures docs/screenshots at both widths
│   └── support/browser.js   Dependency-free Chrome DevTools Protocol driver
├── scripts/serve.js         Zero-dependency static server for `npm start`
├── docs/
│   ├── DESIGN.md            Persona, prioritised gaps, research, trade-offs, iteration history
│   ├── LOOM_SCRIPT.md       Talking points for the 5-minute walkthrough
│   └── screenshots/         Images used in this README
└── package.json             Scripts only; no dependencies
```
