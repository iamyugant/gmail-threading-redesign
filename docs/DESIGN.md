# Gmail Threading Redesign: design rationale

The brief suggested 2 to 3 hours. I built the three core features first, then went past the budget on edge cases and tests because I wanted the prototype to hold up with messy real-world threads.

The prototype is in [`index.html`](../index.html). Open it in a browser. It needs a network connection for the React, Tailwind and font CDNs.

Run the tests with `npm run test:unit` and `npm run test:ui`. The browser tests need Chrome. Run `npm run screenshots` to regenerate the images.

---

## 1. Who uses threading, and who I designed for

Gmail threading serves very different people. I looked at four groups and what they need from a thread.

| User | Typical thread | What they need | How well Gmail works today |
|---|---|---|---|
| Personal and family users | 2 to 4 people, a few replies | Read the latest reply and respond | Works fine. The list model fits. |
| Support and sales teams on shared inboxes | Customer plus several teammates | Know who owns the reply and what the customer was promised | Weak, but the core problem is ownership and assignment. That is a helpdesk problem, not a threading one. |
| Mobile-first triagers | Any size, read on a phone between tasks | Get the gist of a long thread fast on a small screen | Weak. Collapsed messages hide context and expanding them is slow. |
| Cross-functional operators | 10 to 15 people, several topics at once, runs for days | Know what was decided, what is still open and with whom, and whether they are on the hook | Breaks down. This is where decisions get lost and people fall off the thread. |

I designed for the cross-functional operator. They run a program across engineering, compliance and product. They live in threads of 10 to 15 people and check email many times a day between meetings. They need to answer three questions in under 30 seconds: what was decided, what is still open and with whom, and am I on the hook. They use the keyboard, they skim, and they are the person others forward things to, so being wrong about who knows what has a real cost.

I chose them because their threads are the largest, a missed decision there costs the most, and every problem the other groups have shows up in their threads too. The design still has to work on a phone, so the mobile triager shaped the layout constraints.

### Evidence this is a real problem

I did not run user sessions for this exercise, so my evidence is limited. The strongest signal is that Gmail ships a setting to turn conversation view off entirely, which Google documents on its [support page](https://support.google.com/mail/answer/5900). A product only offers an off switch for a core feature when enough people reject it. The rest of my understanding comes from how I and the people I work with use long cross-functional threads day to day. My first next step is five moderated sessions with people who run cross-functional programs, testing whether they can answer what was decided, what is open and who is waiting in under 30 seconds.

## 2. The three gaps, in priority order

I found three gaps and ranked them by cost.

| # | Gap | What it looks like in Gmail today | Why it ranks here |
|---|---|---|---|
| 1 | **Status amnesia** | A blocker raised in reply 2 is settled in reply 7. Nothing links them, so reply 11 asks again. | It costs the most, through wrong or repeated decisions, and every reader hits it. |
| 2 | **Audience drift** | Someone replies to a subset. Two people silently fall off `To` and `Cc`, a back-channel forms, and the person a question was aimed at never sees it. | It is rarer, but the most expensive when it happens, and it is invisible in every client. |
| 3 | **Branching disorientation** | Concurrent topics such as pricing, legal and scheduling are mixed together in one linear accordion. | It happens most often but costs a moderate amount. The tree already helps and focus mode finishes the job. |

All three come from the same cause. Gmail treats a thread as a list. The real structure is a tree with state and an audience that changes.

### What I chose not to solve

| Problem | Why it's out of scope |
|---|---|
| Ownership and assignment on shared inboxes | Real, but it needs assignees and states. That is a helpdesk feature, and it would double the scope. |
| Automatic AI summaries of a thread | A confident wrong summary is worse than none, and it can't be audited. The ledger could feed one later. |
| Search inside a thread | Useful, but Gmail search already covers most of it, and it doesn't fix any of the three gaps. |
| Attachment and link management | A separate problem from how replies relate to each other. |
| Notification noise from busy threads | Mostly a settings and inbox problem, not a thread-view problem. |

## 3. Research and what I took from it

These sources shaped the design. Each item says what I took and where I chose differently.

- **Superhuman and Shortwave.** Superhuman is keyboard-first, aims for every interaction to take under a second, and triages in batches. See its [split inbox write-up](https://blog.superhuman.com/how-to-split-your-inbox-in-superhuman/). I gave every new feature a key: `n` for next unread, `b` to focus a branch, `x` to resolve, `f` to fold, and `j` and `k` to move. None of them requires the mouse. I did not copy their automated triage, for the reasons in the trade-offs.
- **Linear.** Resolving a comment clarifies "when a question has been answered or a decision is made" and collapses the replies to the decision. See the [Linear changelog](https://linear.app/changelog/2023-11-08-resolve-comments). I took explicit resolution that the user owns, with an audit trail. I added a ledger that shows open items first and keeps resolved ones one click away.
- **Slack.** Once replies leave the main flow, "new" needs its own marker. Slack moved unread replies to a dedicated surface. See [Slack Design: threads](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-2-of-2/). I took a catch-up banner, a new dot on each message and `n`, which works across branches in time order.
- **JWZ threading.** The `References` header exists so a thread can be rebuilt "even if some replies in it are missing". See [jwz.org](https://www.jwz.org/doc/threading.html). When the direct parent is missing, I place a message under the nearest surviving ancestor in its `References` chain instead of at the root. The code calls this `partial-references`.
- **Alation.** Conversations, steward assignment, lineage and trust flags are all attributed and traceable. See the [Alation data catalog](https://www.alation.com/product/data-catalog/). I took the same idea, so nothing in the UI is a black box. Every status names who closed it and where, and you can click to jump there. Every drift badge has a tooltip with last-active information. Manual overrides are marked "Marked resolved".

## 4. The three improvements

1. **Focus branch.** Press `b`, use the focus button on any fork, or click a branch chip. It keeps the chain back to the root plus everything below the chosen message. Sibling branches dim with a 150 ms opacity transition and collapse to "+N unselected replies". `Esc` restores them. Jumping to a hidden message leaves focus mode automatically, so you never stare at nothing.
2. **Resolution ledger.** Every question, blocker and decision gets a status worked out from the thread. A question is resolved when someone it was aimed at replies below it. That means the people it `@mentions`, or else its `To` list. A blocker is resolved by the latest decision below it. Chips read `Awaiting Sara` and then `Resolved · Sara`. Clicking a chip jumps to the closing reply. `Mark resolved` and `Reopen` always win.
3. **Audience drift and participant stance.** Each reply gets a badge showing who was dropped and who was added compared with its parent. The badge is amber when a dropped person is still owed an answer. In the header, avatars grey out for people absent from every branch's latest reply, and they get a yellow dot when a question is waiting on them. The composer warns that Sara is waiting on an answer elsewhere and isn't on this reply, and offers "Add to Cc".

Supporting pieces are the catch-up banner with `n`, folding, a minimap with depth and a viewport band, a reply-only-to guard, and an offline queue.

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

## 6. Trade-offs and why

| Decision | Alternative | Why I chose this |
|---|---|---|
| **Vertical tree, indent capped at 3 levels and 2 on phones, then a 2px accent line and a parent pill** | Canvas or node graph, or side-by-side columns | Graphs are slow to read and useless at 375px. Columns collapse on small screens and hide order. A capped vertical tree keeps the reading direction email users already have and degrades gracefully. I tested chains 120 deep. |
| **Explicit resolution that the user owns, with a derived suggestion and a manual override** | Auto-generated summary of what was decided | Trust. A confident wrong summary is worse than none, and an enterprise reviewer needs to audit a decision. Derived statuses are deterministic and explainable, such as "answered by Maya in this reply", and the person can always overrule. An automatic summary can be added later on top of this ledger. |
| **Ledger shows open items first, with resolved items and decisions one click away** | Always show everything | Found in my screenshot review: six rows pushed the conversation below the fold. The ledger's job is to show what needs someone, so it leads with that. The audit trail stays reachable. A row you just toggled stays visible so you can undo it. |
| **Dropped means absent from the latest reply of every branch** | Not on the newest message | I defined dropped as absent from the latest reply of every branch. The simpler rule, not on the newest message, would flag almost everyone in a forked thread, which teaches people to ignore the signal. |
| **Send stays disabled when offline, as the PRD requires, and there is an explicit Queue for later** | Silent auto-queue on Send | Silent queueing on Ctrl+Enter would send text the user thinks is sent. Queueing is a visible, deliberate second action, and the banner says what will happen. |
| **Queued replies saved in the browser, with no outbox** | A real outbox | Queued replies persist in `localStorage` and send the next time the thread opens while online. They do not send in the background once the tab is closed. A real outbox needs retry, dedupe and auth, and a prototype can't show that honestly. |
| **React via CDN, no build step** | Vite project | Zero setup for reviewers. The logic lives in a pure `src/threading.js` that Node tests `require()` directly. Babel compiles the JSX in the browser, which is fine for a prototype and would give way to a real bundler in production. |

## 7. Iteration history

Every feature went through four passes. Each entry is what actually happened, including what the tests and screenshots caught.

### Resolution ledger
1. **Baseline.** I derive item statuses in a pure `analyzeThread()` function and add chips and a toggle.
2. **Ergonomic and visual critique.** In my screenshot review at 375px, the ledger pushed the conversation below the fold, and the question text truncated to *"Can Sa…"* because the status chip and the action link crowded it. The earlier amber text, `#b06000` on `#fef7e0`, measures 4.34:1, below the 4.5:1 AA minimum. I darkened it to `#a05600`, which measures 5.12:1. Keyboard parity was missing, so I added `x`.
3. **Responsive and edge stress.** I tried 0 items, 25 resolved items, and 300 messages with 100 questions. That led to progressive disclosure, with open items first and a "Show 6 resolved & decisions" link. It also led to an "All caught up" state, mobile rows that wrap with the text in its own block of up to two lines and the status below, and toggled rows that stay visible for undo.
4. **Hardening.** I added `role="status"` announcements such as "Marked resolved: …". Keyboard focus returns to the same control after the list re-sorts. A test asserts there are no nested buttons, and the app ignores corrupt stored state.

### Focus branch
1. **Baseline.** The focus set is the ancestors, the node and its descendants, computed by `resolveLineage`. Siblings are dimmed.
2. **Critique.** Dimmed siblings still showed their whole subtree, which was noise. I cut them at the head with "+N unselected replies". I added a 150 ms opacity transition, a banner that names the branch, and `Esc` and `b` to toggle.
3. **Stress.** `j` and `k` must skip hidden nodes. Jumping to a hidden message must leave focus mode. Replying inside focus must work. Fold and focus must work together. All of these have tests.
4. **Hardening.** Focus changes are announced politely, for example "Focused on branch: … Other branches are dimmed." The focus banner shares one sticky container with the offline banner. Focus buttons appear only on fork heads, so a straight chain has none.

### Audience drift
1. **Baseline.** I compare each reply with its parent using `calculateAudienceDrift`, and I grey out dropped avatars.
2. **Critique.** A stress test with 600-character names showed the badge overflowing the card, so it now wraps. Amber appears only when the dropped person is still owed an answer, so the colour carries meaning.
3. **Stress.** With 40 participants sharing initials, "Alex, Alex, Alex…" was useless. I added collision-aware short names that use the full name when a first name clashes. Lists are capped at 3 with "+N more", and the full list stays in the tooltip.
4. **Hardening.** The badge is focusable and has an `aria-label`. The composer nudge is `role="note"`. Time-placed messages get no drift badge, because a comparison against an arbitrary node would mislead.

### Core paths that were untested before
- **Send.** A new message attaches under the right parent, ids stay unique, and the fold count, branch count and ledger update. Focus lands on the new message. It used to drop to `<body>`, which I found while writing the test.
- **Offline.** The banner has `role="status"`. Send and Ctrl+Enter are blocked. There is a Queue for later action, automatic sending on reconnect and announcements. I found that the offline badge hid the "add a recipient" warning.
- **Minimap.** Ticks indent with depth, a grey band tracks what is on screen, and clicking scrolls. I found that folded-away messages stayed marked as in view because of stale IntersectionObserver state.
- **One-message thread.** There are no connectors, rail, overview, banners or "branch" wording. A reply turns it into a real thread.

## 8. Bugs found during the build

Some were caught by failing tests and some by code review. Every one is now covered by a test.

- A `//` comment swallowed the rest of a line and blanked the app.
- Indentation stopped one level late.
- `@@x` was parsed as a mention.
- One bad message crashed the whole inbox.
- The audience drift function crashed on a missing `cc`.
- The badge overflowed with long names.
- The offline badge hid a validation message.
- The minimap band went stale.
- Focus was lost after send.
- Amber chip text fell below the 4.5:1 contrast minimum.
- "Alex, Alex" was ambiguous.

## 9. Edge cases

I tested these groups.

- **Malformed graphs.** Orphans, self-parent, 2-cycles and 3-cycles, a cycle with a tail, no root, many roots, duplicate ids, junk entries, mixed string and number ids, clock skew, invalid timestamps, chains 5,000 deep, threads 10,000 wide, and 300 random graphs including `References` chains.
- **Quotes.** Gmail and Outlook styles, CRLF, nested quotes, inline replies, quote-only messages and wrapped attribution lines.
- **Mentions.** Real mentions versus email addresses.
- **Recipients.** My own message, empty To, duplicates and case.
- **Storage.** Unavailable, full and corrupt.
- **Text.** XSS-shaped text, 600-character unbroken strings, a 2,000-word essay and 1-character messages.
- **Data volume.** 0 and 25 tracked items, and 40 participants with the same initial.
- **Screen sizes.** 375px and 1,440px.

### How the main edge cases are handled

- **Drafts.** The composer saves every 1.5 seconds while you type and again when it closes. Collapsing a message mid-sentence doesn't lose words. Drafts also survive closing the composer and reloading the page.
- **State updates.** Sent replies, resolution toggles and queued sends show up immediately. There is no server, so this is local state written straight to `localStorage`.
- **Scale.** Trees are built without recursion. A chain 5,000 replies deep and a thread 10,000 replies wide both build without errors. 300 messages rendered in under 100 ms in my runs.
- **Hostile text.** Message text always renders as text and never as markup. A 600-character unbroken string wraps instead of widening the page.
- **Narrow screens.** One indent level costs about 24px. A phone column is close to 340px wide, which is why indentation stops at 2 levels there.
- **Test setup.** There is no test framework. Logic tests use Node's built-in runner. Browser tests drive headless Chrome over the Chrome DevTools Protocol using Node's built-in `WebSocket`.

## 10. Test report

| Suite | Count |
|---|---|
| `tests/threading.test.js` and `tests/mailbox.test.js`, pure logic, including 4 randomized property tests | 110 |
| `tests/run-ui.js`, headless Chrome, run at 1440px and 375px | 131 |

Earlier versions of the browser suite passed three full runs in a row with no flakes. Timing-dependent behaviour is asserted with polling `waitFor`, not fixed sleeps, except where "nothing should happen" is the assertion.

## 11. Known limits

- **No real users.** Iterations were driven by automated stress tests, screenshots and heuristics, not participant sessions. My first next step is five moderated sessions with people who run cross-functional programs, on the "what's open and who's waiting" task.
- **Screen readers were not run.** I verified ARIA structure, meaning roles, names, live-region text, no nested interactive elements and focus movement. I did not test VoiceOver or NVDA behaviour.
- **Statuses are heuristics.** A question is resolved when an addressed person replies, and a blocker is resolved by the latest downstream decision. They can be wrong, which is why every one is overridable and attributable.
- Queued replies are saved in this browser but only send when the thread is open. I tested in Chrome only. Sample data is made up and was shaped to demo the features.
- **Ledger items are tagged in the sample data.** The prototype does not detect questions, blockers or decisions from the text. Each one is tagged in `src/sample-data.js`. The status logic is real: it works out whether an item is resolved from the thread. In production, the sender or any reader would mark a message as a decision, question or blocker. A classifier could suggest tags, but a person would confirm them. That keeps the same user-owned model as the rest of the ledger.
- **The ledger only exists in this client.** People reading the thread in Outlook or another client won't see statuses or resolutions. A shared ledger would need a server. That is listed under next steps.
- **Prototype build setup.** JSX is compiled in the browser by Babel, and Tailwind runs from its Play CDN. Both log console warnings. A real build would use a bundler.

## 12. Next steps

1. User test the ledger default, which shows open items first, and the meaning of the amber badge.
2. Build a real outbox for queued sends, and sync resolutions across participants. A shared ledger with a steward per open item is the natural tie-in to Alation.
3. Collapse resolved branches to the decision, as Linear does.
4. Add an optional automatic summary on top of the ledger that always shows its evidence links.
