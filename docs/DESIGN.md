# Gmail Threading Redesign — design rationale & run report

Prototype: [`index.html`](../index.html) (open it in a browser; needs network for React/Tailwind/fonts CDNs).
Tests: `npm run test:unit` · `npm run test:ui` (needs Chrome) · screenshots: `npm run screenshots`.

---

## 1. Who this is for

**The Cross-Functional Enterprise Operator.** Runs a program across engineering, compliance and product. Lives in 10–15-person threads, opens Gmail 100+ times a day between meetings, and must answer three questions in under 30 seconds: *What was decided? What is still open, and with whom? Am I on the hook?*

They are a keyboard user, they skim, and they are the person others forward things to — so being wrong about "who knows what" has a real cost.

## 2. The three gaps (prioritised)

| # | Gap | What it looks like in Gmail today | Why it ranks here |
|---|---|---|---|
| 1 | **Status amnesia** | A blocker raised in reply 2 is settled in reply 7. Nothing links them, so reply 11 asks again. | Highest cost: wrong or repeated decisions. Every reader hits it. |
| 2 | **Audience drift** | Someone replies to a subset. Two people silently fall off `To`/`Cc`; a back-channel forms; the person a question was aimed at never sees it. | Rare-ish but the most expensive when it happens; invisible in every client. |
| 3 | **Branching disorientation** | Concurrent topics (pricing, legal, scheduling) are interleaved in one linear accordion. | Highest frequency, moderate cost — the tree already helps; focus mode finishes the job. |

Fatal flaw underneath all three: Gmail treats a thread as a *list*. The real structure is a *tree with state and an audience that changes*.

## 3. Research → what I took from it

Web research (links below) fed three ideas; I list where I *deviated* too.

- **Superhuman / Shortwave** — keyboard-first, "every interaction under a second", triage in batches ([Superhuman split-inbox](https://blog.superhuman.com/how-to-split-your-inbox-in-superhuman/)). → Every new feature has a key (`n` next unread, `b` focus branch, `x` resolve, `f` fold, `j/k`), and none *requires* the mouse. I did **not** copy their automated triage (see trade-offs).
- **Linear** — resolving a comment clarifies "when a question has been answered or a decision is made" and collapses the replies to the decision ([Linear changelog](https://linear.app/changelog/2023-11-08-resolve-comments)). → Explicit, user-owned resolution with an audit trail, plus my progressive-disclosure ledger (open first, resolved one click away).
- **Slack** — once replies leave the main flow, "new" needs its own affordance; their team moved unread replies to a dedicated surface ([Slack Design: threads](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-2-of-2/)). → Catch-up banner + per-message new dot + `n`, working *across* branches in time order.
- **JWZ threading** — `References` exists so a thread can be rebuilt "even if some replies are missing" ([jwz.org](https://www.jwz.org/doc/threading.html)). → When the direct parent is missing I place a message under the nearest surviving ancestor in its `References` chain instead of dumping it at the root (`partial-references`).
- **Alation** — conversations, steward assignment, lineage, trust flags: everything is *attributed and traceable* ([Alation data catalog](https://www.alation.com/product/data-catalog/)). → Nothing in the UI is a black box: every status names *who* closed it and *where* (click to jump); every drift badge has a tooltip with last-active info; manual overrides are marked "Marked resolved".

## 4. The three improvements (+ what they map to in the build)

1. **Focus Branch (lineage & topic isolation)** — `b`, the focus button on any fork, or the *Branches* chips. Keeps the causal chain to the root plus everything below the chosen message; siblings dim (150 ms opacity transition) and collapse to "+N unselected replies". `Esc` restores. A jump to a hidden message leaves focus automatically so you're never staring at nothing.
2. **Resolution ledger (actionable state)** — every question/blocker/decision gets a live status derived from the thread: a question is *resolved* when someone it was aimed at (`@mentions`, else `To`) replies below it; a blocker is resolved by the **latest decision below it**. Chips read `Awaiting Sara` → `Resolved · Sara`, click to jump to the closing reply. Manual `Mark resolved` / `Reopen` always wins.
3. **Audience drift & participant stance** — per reply, a badge shows who was *dropped* and *added* vs its parent (amber when a dropped person is still owed an answer). In the header, avatars grey out for people absent from every branch's latest reply, and get a yellow dot when a question is waiting on them. The composer warns: *"Sara is waiting on an answer elsewhere and isn't on this reply · Add to Cc."*

Supporting pieces: catch-up (`n`), fold, minimap with depth + viewport band, reply-only-to guard, offline queue.

## 5. Trade-offs (and why)

| Decision | Alternative | Why I chose this |
|---|---|---|
| **Vertical tree, indent capped at 3 (2 on phones), then a 2 px accent line + parent pill** | Canvas/node graph; side-by-side columns | Graphs are slow to read and useless at 375 px; columns collapse on small screens and hide order. A capped vertical tree keeps the *reading direction* email users already have, and degrades gracefully (I tested 120-deep chains). |
| **Explicit, user-owned resolution (derived suggestion + manual override)** | Auto-generated summary of "what was decided" | Trust. A confident wrong summary is worse than none, and an enterprise reviewer needs to *audit* a decision. Derived statuses are deterministic and explainable ("answered by Maya in this reply"); the human can always overrule. An automatic summary can always be added later *on top of* this ledger. |
| **Ledger shows open items first; resolved & decisions one click away** | Always show everything | Found in the critique loop: six rows pushed the conversation to 60 % down the screen. The ledger's job is "what needs someone", so it leads with that; the audit trail stays reachable. A row you just toggled stays visible so you can undo it. |
| **"Dropped" = absent from *every* branch's latest reply** | "Not on the newest message" | The naive rule flags almost everyone in any forked thread. Measured against all branch tips it flags only people who are truly out of the loop. |
| **Offline: Send stays disabled (per PRD) *and* there's an explicit "Queue for later"** | Silent auto-queue on Send | Silent queueing on Ctrl+Enter would send text the user thinks is sent. Queueing is a visible, deliberate second action; the banner says what will happen. |
| **Queued state kept in page memory** | Persist in `localStorage` | Drafts are persisted; a *queued send* is a promise. Persisting it correctly needs a real outbox (retry, dedupe, auth) that a prototype can't fake honestly. Listed under limitations. |
| **React via CDN, no build step** | Vite project | Zero setup for reviewers; the logic lives in a pure `src/threading.js` that Node tests `require()` directly. Babel compiles the JSX in the browser, which is fine for a prototype and would give way to a real bundler in production. |

## 6. Iteration history (every feature went through four passes)

Each row is what *actually* happened — including what the tests and screenshots caught.

### Resolution ledger
1. **Baseline** — derive item statuses in a pure `analyzeThread()`; chips + toggle.
2. **Ergonomic/visual critique** (screenshots at 1440 and 375) — the ledger took ~380 px and pushed messages below the fold; on a phone the question text truncated to *"Can Sa…"* because chip + action crowded it. An in-browser contrast check measured the amber "open" chip at **4.34 : 1** (AA needs 4.5) → text darkened to `#a05600` (5.12). Keyboard parity gap → added `x`.
3. **Responsive/edge stress** — 0 items, 25 resolved items, 300 messages/100 questions. → progressive disclosure (open first, "Show 6 resolved & decisions"), "All caught up" state, mobile rows wrap (text on its own 2-line block, status below), toggled rows stay for undo.
4. **Hardening** — `role="status"` announcements (*"Marked resolved: …"*), keyboard focus restored to the same control after the list re-sorts, no nested buttons (asserted), corrupt stored state ignored.

### Focus branch
1. **Baseline** — `focusSet` = ancestors ∪ node ∪ descendants; siblings dimmed.
2. **Critique** — dimmed siblings still showed their whole subtree (noise) → cut at the head with "+N unselected replies"; 150 ms opacity transition; banner names the branch; `Esc`/`b` toggle.
3. **Stress** — `j/k` must skip hidden nodes; jumping to a hidden message must leave focus; reply inside focus must work; fold+focus interplay. All have tests.
4. **Hardening** — announced politely ("Focused on branch: … Other branches are dimmed."), banner stacked with the offline banner in one sticky container, focus buttons only on fork heads so a straight chain has none.

### Audience drift
1. **Baseline** — `recipientDelta(reply, parent)`, "dropped" avatars.
2. **Critique** — first definition flagged nearly everyone (see trade-offs). Stress test with 600-character names found the badge **overflowed the card** → wraps. Amber only when the dropped person is still owed an answer, so colour carries meaning.
3. **Stress** — 40 participants sharing initials: `"Alex, Alex, Alex…"` was useless → collision-aware short names (full name when a first name clashes) and lists capped at 3 (+N more; full list stays in the tooltip).
4. **Hardening** — badge is focusable with an `aria-label`; composer nudge is `role="note"`; time-placed messages get no delta (a delta against an arbitrary node would mislead).

### Core paths that were untested before
- **Send** — new message attaches under the right parent, ids stay unique, fold count / branch count / ledger update, focus lands on the new message (it used to drop to `<body>` — found while writing the test).
- **Offline** — banner (`role=status`), Send and Ctrl+Enter blocked, *Queue for later*, auto-send on reconnect, announcements. Found: the offline badge hid the "add a recipient" warning.
- **Minimap** — ticks indent with depth; a grey band tracks what's on screen; click scrolls. Found: folded-away messages stayed "in view" (stale IntersectionObserver state).
- **1-message thread** — no connectors, rail, overview, banners or "branch" language; reply promotes it to a real thread.

## 7. Bugs the test suites caught (not cosmetic)

A `//` comment that swallowed the rest of a line and blanked the app · indentation stopping one level late · `@@x` parsed as a mention · one bad message crashing the whole inbox · `recipientDelta` crashing on a missing `cc` · badge overflow with long names · offline hiding a validation message · stale minimap band · focus lost after send · 4.34 : 1 contrast · `"Alex, Alex"` ambiguity.

## 8. Edge-case matrix

Malformed graphs (orphans, self-parent, 2/3-cycles, cycle with a tail, no root, many roots, duplicate ids, junk entries, string/number id mix, clock skew, invalid timestamps, 5 000-deep, 10 000-wide, 300 random graphs incl. `References` chains) · quotes (Gmail/Outlook/CRLF/nested/inline/only-quote/wrapped attribution) · mentions vs emails · recipients (own message, empty To, dupes, case) · storage (unavailable, full, corrupt) · XSS-shaped text · 600-char unbroken strings · 2 000-word essay · 1-char messages · 0 / 25 tracked items · 40 same-initial participants · 375 px and 1 440 px.

## 9. Test report

| Suite | Count | Result |
|---|---|---|
| `tests/threading.test.js` (pure logic, incl. 4 randomized property tests) | 94 | all pass |
| `tests/run-ui.js` — real Chrome via DevTools protocol, run at **1440×900** and **375×812 (mobile emulation)** | 109 × 2 = 218 | all pass |

Three consecutive full runs produced identical results (no flakes). Timing-dependent behaviour is asserted with polling `waitFor`, never fixed sleeps, except where "nothing should happen" is the assertion.

## 10. Known limits (honest)

- **No real users.** Iterations were driven by automated stress tests, screenshots and heuristics — not participant sessions. First next step: 5 moderated sessions with cross-functional PMs on the "what's open / who's waiting" task.
- **Screen readers** were not run; I verified ARIA *structure* (roles, names, live-region text, no nested interactives, focus movement) but not VoiceOver/NVDA behaviour.
- Statuses are **heuristics** (addressed person replies / latest downstream decision). They can be wrong — which is why every one is overridable and attributable.
- Queued replies live in memory only. Chrome only. Sample data is made up and was shaped to demo the features.

## 11. Next steps

1. User test the ledger default (open-first) and the meaning of the amber badge.
2. Real outbox for queued sends; sync resolutions across participants (shared ledger — the natural Alation tie-in: a *steward* per open item).
3. Linear-style "collapse resolved branches to the decision".
4. Optional automatic summary *layered on* the ledger, always showing its evidence links.
