# Gmail Threading Redesign — design rationale & run report

The brief suggested 2 to 3 hours. I built the three core features first, then went past the budget on edge cases and tests because I wanted the prototype to hold up with messy real-world threads.

Prototype: [`index.html`](../index.html) (open it in a browser; needs network for React/Tailwind/fonts CDNs).
Tests: `npm run test:unit` · `npm run test:ui` (needs Chrome) · screenshots: `npm run screenshots`.

---

## 1. Who uses threading, and who I designed for

Gmail threading serves very different people. I looked at four groups and what they need from a thread.

| User | Typical thread | What they need | How well Gmail works today |
|---|---|---|---|
| Personal and family users | 2 to 4 people, a few replies | Read the latest reply and respond | Works fine. The list model fits. |
| Support and sales teams on shared inboxes | Customer plus several teammates | Know who owns the reply and what the customer was promised | Weak, but the core problem is ownership and assignment. That is a helpdesk problem, not a threading one. |
| Mobile-first triagers | Any size, read on a phone between tasks | Get the gist of a long thread fast on a small screen | Weak. Collapsed messages hide context and expanding them is slow. |
| Cross-functional operators | 10 to 15 people, several topics at once, runs for days | Know what was decided, what is still open and with whom, and whether they are on the hook | Breaks down. This is where decisions get lost and people fall off the thread. |

`TODO(Yugant): optional one line on seeing the shared-inbox ownership problem in my own work at Salesforce, if I want to include it.`

I designed for the cross-functional operator. Their threads are the largest, a missed decision there costs the most, and every problem the other groups have shows up in their threads too. The design still has to work on a phone, so the mobile triager shaped the layout constraints.

**The Cross-Functional Enterprise Operator.** Runs a program across engineering, compliance and product. Lives in 10–15-person threads, opens Gmail 100+ times a day between meetings, and must answer three questions in under 30 seconds: *What was decided? What is still open, and with whom? Am I on the hook?*

They are a keyboard user, they skim, and they are the person others forward things to — so being wrong about "who knows what" has a real cost.

### Evidence this is a real problem

I did not run user sessions for this exercise. These are the signals I used instead.

- Gmail offers a setting to turn conversation view off entirely. Google documents it on its help page, [Turn conversation view on or off](https://support.google.com/mail/answer/5900). A product only ships an off switch for a core feature when enough people reject it.
- `TODO(Yugant): 1 to 2 links to Gmail Help Community or Reddit threads about losing track of replies in long threads, or not noticing someone was dropped from a reply.`
- `TODO(Yugant): 2 to 3 one-line quotes from colleagues about their worst long-thread moment, with first name and role only.`

## 2. The three gaps (prioritised)

| # | Gap | What it looks like in Gmail today | Why it ranks here |
|---|---|---|---|
| 1 | **Status amnesia** | A blocker raised in reply 2 is settled in reply 7. Nothing links them, so reply 11 asks again. | Highest cost: wrong or repeated decisions. Every reader hits it. |
| 2 | **Audience drift** | Someone replies to a subset. Two people silently fall off `To`/`Cc`; a back-channel forms; the person a question was aimed at never sees it. | Rare-ish but the most expensive when it happens; invisible in every client. |
| 3 | **Branching disorientation** | Concurrent topics (pricing, legal, scheduling) are interleaved in one linear accordion. | Highest frequency, moderate cost — the tree already helps; focus mode finishes the job. |

Fatal flaw underneath all three: Gmail treats a thread as a *list*. The real structure is a *tree with state and an audience that changes*.

### What I chose not to solve

| Problem | Why it's out of scope |
|---|---|
| Ownership and assignment on shared inboxes | Real, but it needs assignees and states. That is a helpdesk feature, and it would double the scope. |
| Automatic AI summaries of a thread | A confident wrong summary is worse than none, and it can't be audited. The ledger could feed one later. |
| Search inside a thread | Useful, but Gmail search already covers most of it, and it doesn't fix any of the three gaps. |
| Attachment and link management | A separate problem from how replies relate to each other. |
| Notification noise from busy threads | Mostly a settings and inbox problem, not a thread-view problem. |

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

## 5. The design system behind the features

The features share a small set of patterns so the thread reads as one system.

**Shared pill shape.** Ledger status chips, audience drift badges, the "Queued" chip and branch chips are all rounded pills in small text. Status chips and drift badges also share the same horizontal padding and a 20px minimum height. Branch chips are taller, 28px, and outlined, because they are buttons you aim at and not labels.

Components: `StatusChip`, `AudienceDriftBadges`, `BranchChips`.

**Color carries one meaning each.**
- Amber means something is waiting or needs attention. It appears on open ledger items, the dot on the avatar of someone who owes an answer, drift badges where a dropped person still owes an answer, the composer nudge, and the offline and queued states.
- Blue means new, about you, or selected. It marks unread messages, mentions of you, the catch-up banner, the focused branch and the current tick in the minimap. Links and the primary button are blue too.
- Grey means inactive. It marks dimmed branches in focus mode, people who dropped off every branch, and resolved rows in the ledger.
- Green means resolved or decided.

Components: `CatchUpBanner`, `PeopleAvatars`, `PeopleStatusLine`, `WaitingNudge`, `Ledger`, `Minimap`.

**Interaction rules.** Focus branch, the ledger and catch-up each have a keyboard shortcut, a tooltip or visible label that explains the signal, and an `aria-live` announcement when their state changes. The shortcuts are `b`, `x` and `n`. Drift badges are read-only signals. They can be focused from the keyboard and their tooltip lists each person's last activity, but they have no shortcut because they never change state. Every ledger status can be overridden by a person, and the override is labeled "Marked resolved".

Components: `useThreadShortcuts` and `useAnnouncer` in `src/hooks.js`, `Ledger`, `AudienceDriftBadges`.

**One layout rule.** Indentation stops at 3 levels on desktop and 2 on phones. Deeper replies use a thin accent line and a parent pill, so nothing scrolls sideways at 375px.

Components: `MessageNode`, `MessageHeader`.

## 6. Trade-offs (and why)

| Decision | Alternative | Why I chose this |
|---|---|---|
| **Vertical tree, indent capped at 3 (2 on phones), then a 2 px accent line + parent pill** | Canvas/node graph; side-by-side columns | Graphs are slow to read and useless at 375 px; columns collapse on small screens and hide order. A capped vertical tree keeps the *reading direction* email users already have, and degrades gracefully (I tested 120-deep chains). |
| **Explicit, user-owned resolution (derived suggestion + manual override)** | Auto-generated summary of "what was decided" | Trust. A confident wrong summary is worse than none, and an enterprise reviewer needs to *audit* a decision. Derived statuses are deterministic and explainable ("answered by Maya in this reply"); the human can always overrule. An automatic summary can always be added later *on top of* this ledger. |
| **Ledger shows open items first; resolved & decisions one click away** | Always show everything | Found in the critique loop: six rows pushed the conversation to 60 % down the screen. The ledger's job is "what needs someone", so it leads with that; the audit trail stays reachable. A row you just toggled stays visible so you can undo it. |
| **"Dropped" = absent from *every* branch's latest reply** | "Not on the newest message" | The naive rule flags almost everyone in any forked thread. Measured against all branch tips it flags only people who are truly out of the loop. |
| **Offline: Send stays disabled (per PRD) *and* there's an explicit "Queue for later"** | Silent auto-queue on Send | Silent queueing on Ctrl+Enter would send text the user thinks is sent. Queueing is a visible, deliberate second action; the banner says what will happen. |
| **Queued replies saved in the browser, with no outbox** | A real outbox | Queued replies persist in `localStorage` and send the next time the thread opens while online. They do not send in the background once the tab is closed. A real outbox needs retry, dedupe and auth, and a prototype can't show that honestly. |
| **React via CDN, no build step** | Vite project | Zero setup for reviewers; the logic lives in a pure `src/threading.js` that Node tests `require()` directly. Babel compiles the JSX in the browser, which is fine for a prototype and would give way to a real bundler in production. |

## 7. Iteration history (every feature went through four passes)

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

## 8. Bugs the test suites caught (not cosmetic)

A `//` comment that swallowed the rest of a line and blanked the app · indentation stopping one level late · `@@x` parsed as a mention · one bad message crashing the whole inbox · `recipientDelta` crashing on a missing `cc` · badge overflow with long names · offline hiding a validation message · stale minimap band · focus lost after send · 4.34 : 1 contrast · `"Alex, Alex"` ambiguity.

## 9. Edge-case matrix

Malformed graphs (orphans, self-parent, 2/3-cycles, cycle with a tail, no root, many roots, duplicate ids, junk entries, string/number id mix, clock skew, invalid timestamps, 5 000-deep, 10 000-wide, 300 random graphs incl. `References` chains) · quotes (Gmail/Outlook/CRLF/nested/inline/only-quote/wrapped attribution) · mentions vs emails · recipients (own message, empty To, dupes, case) · storage (unavailable, full, corrupt) · XSS-shaped text · 600-char unbroken strings · 2 000-word essay · 1-char messages · 0 / 25 tracked items · 40 same-initial participants · 375 px and 1 440 px.

## 10. Test report

| Suite | Count |
|---|---|
| `tests/threading.test.js` and `tests/mailbox.test.js`, pure logic, including 4 randomized property tests | 110 |
| `tests/run-ui.js`, headless Chrome, run at 1440x900 and at 375x812 with mobile emulation | 133 at each width |

Earlier versions of the browser suite passed three full runs in a row with no flakes. Timing-dependent behaviour is asserted with polling `waitFor`, not fixed sleeps, except where "nothing should happen" is the assertion.

`TODO(Yugant): run npm test on your machine after the last changes and confirm the final pass counts here.`

## 11. Known limits

- **No real users.** Iterations were driven by automated stress tests, screenshots and heuristics — not participant sessions. First next step: 5 moderated sessions with cross-functional PMs on the "what's open / who's waiting" task.
- **Screen readers** were not run; I verified ARIA *structure* (roles, names, live-region text, no nested interactives, focus movement) but not VoiceOver/NVDA behaviour.
- Statuses are **heuristics** (addressed person replies / latest downstream decision). They can be wrong — which is why every one is overridable and attributable.
- Queued replies are saved in this browser but only send when the thread is open. I tested in Chrome only. Sample data is made up and was shaped to demo the features.
- **Ledger items are tagged in the sample data.** The prototype does not detect questions, blockers or decisions from the text. Each one is tagged in `src/sample-data.js`. The status logic is real: it works out whether an item is resolved from the thread. In production, the sender or any reader would mark a message as a decision, question or blocker. A classifier could suggest tags, but a person would confirm them. That keeps the same user-owned model as the rest of the ledger.
- **The ledger only exists in this client.** People reading the thread in Outlook or another client won't see statuses or resolutions. A shared ledger would need a server. That is listed under next steps.
- **Prototype build setup.** JSX is compiled in the browser by Babel, and Tailwind runs from its Play CDN. Both log console warnings. A real build would use a bundler.

## 12. Next steps

1. User test the ledger default (open-first) and the meaning of the amber badge.
2. Real outbox for queued sends; sync resolutions across participants (shared ledger — the natural Alation tie-in: a *steward* per open item).
3. Linear-style "collapse resolved branches to the decision".
4. Optional automatic summary *layered on* the ledger, always showing its evidence links.
