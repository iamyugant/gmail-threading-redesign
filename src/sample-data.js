/*
 * Demo conversations for the prototype. Not used by the threading logic itself.
 */
window.SampleData = (function () {
  const T = window.Threading;
  const CURRENT_USER = "Maya Chen";

  // Dates are relative to today so the "new since your last visit" demo never goes stale.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const at = (daysAgo, h, m) => new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - daysAgo, h, m).toISOString();

  /** Builds a thread from tuples. Reply bodies quote their parent the way a real mail client would. */
  function buildThread(id, subject, defs) {
    const made = new Map();
    const messages = defs.map(([mid, parent, from, to, cc, ts, text, extra = {}]) => {
      const m = { id: mid, parent, from, to, cc, ts, date: T.formatDate(Date.parse(ts)), ...extra };
      const par = parent != null ? made.get(parent) : null;
      m.body = extra.raw ?? (par ? `${text}\n\n${T.quoteBlock(par)}` : text);
      made.set(mid, m);
      return m;
    });
    return { id, subject, messages };
  }

  const THREAD_Q4 = buildThread("t1", "Q4 Launch – readiness sync", [
    [1, null, "Maya Chen", ["Dev Patel", "Sara Kim", "Luis Ortega"], [], at(3, 9, 2), "Team – we need a go/no-go on the launch by Friday. Can each of you post status on your area?\nPlease include the final asset link when you have it."],
    [2, 1, "Dev Patel", ["Maya Chen"], ["Sara Kim", "Luis Ortega"], at(3, 10, 14), "Engineering is on track. One blocker: the payments SDK upgrade is waiting on a security review.",
      { actions: [{ type: "blocker", text: "Payments SDK upgrade waiting on security review" }] }],
    [3, 2, "Sara Kim", ["Dev Patel", "Maya Chen"], ["Luis Ortega"], at(3, 11, 40), "@Maya can you approve an exception to fast-track the review? I can loop in Security today.",
      { actions: [{ type: "question", text: "Approve a fast-track exception for the security review?" }] }],
    [4, 3, "Maya Chen", ["Sara Kim"], ["Dev Patel"], at(3, 12, 5), "Approved. Decision: fast-track review, target completion in 3 days.",
      { actions: [{ type: "decision", text: "Fast-track security review approved" }] }],
    [5, 4, "Dev Patel", ["Maya Chen", "Sara Kim"], [], at(2, 8, 30), "Thanks. Kicking it off with Security now."],
    [6, 5, "Security Team", ["Dev Patel"], ["Sara Kim"], at(1, 15, 12), "Review complete with two minor findings. Sign-off attached.",
      { raw: "Review complete with two minor findings. Sign-off attached.\n\n-----Original Message-----\nFrom: Dev Patel\nSent: Yesterday 8:30 AM\nSubject: Re: Q4 Launch\n\nThanks. Kicking it off with Security now." }],
    [7, 6, "Sara Kim", ["Security Team"], ["Maya Chen"], at(1, 16, 1), "Great, unblocking the release branch. Decision: SDK ships in the launch build.",
      { actions: [{ type: "decision", text: "Payments SDK ships in launch build" }] }],
    [8, 1, "Luis Ortega", ["Maya Chen"], [], at(3, 13, 20), "Marketing: landing page copy is final. Question – do we need legal sign-off on the pricing claim in the hero?",
      { actions: [{ type: "question", text: "Does the hero pricing claim need legal sign-off?" }] }],
    [9, 8, "Maya Chen", ["Luis Ortega"], [], at(3, 14, 0), "Yes please – loop in Priya from Legal."],
    [10, 9, "Luis Ortega", ["Maya Chen"], ["Priya Nair"], at(2, 9, 45), "Priya is reviewing."],
    [11, 10, "Priya Nair", ["Luis Ortega"], ["Maya Chen"], at(2, 14, 30), "Claim needs a footnote. Suggested wording in the doc."],
    [12, 11, "Luis Ortega", ["Priya Nair"], ["Maya Chen"], at(2, 15, 10), "Added. Final assets: drive.example.com/launch-assets-v7",
      { actions: [{ type: "decision", text: "Final asset link: drive.example.com/launch-assets-v7" }] }],
    [13, null, "Jordan Lee", ["Maya Chen"], [], at(1, 17, 47), "Sorry for the late reply – Finance confirms the launch budget is approved. @Sara can you confirm the launch headcount before Friday?",
      { missingHeaders: true, actions: [{ type: "question", text: "Can Sara confirm the launch headcount before Friday?" }] }],
  ]);
  THREAD_Q4.lastSeen = Date.parse(at(2, 12, 0)); // The reader last opened this thread two days ago at noon; everything after that is "new".
  const THREAD_LUNCH = buildThread("t2", "Lunch on Thursday?", [
    [1, null, "Dev Patel", ["Maya Chen"], [], at(1, 10, 0), "Want to grab lunch Thursday? New ramen place opened nearby."],
  ]);
  const teammates = ["Ana Ruiz", "Ben Cho", "Cleo Park", "Dana Wu"];
  const THREAD_DEEP = buildThread("t3", "Homepage redesign – copy review", Array.from({ length: 9 }, (_, i) => [
    i + 1, i === 0 ? null : i, i % 2 ? teammates[i % 4] : CURRENT_USER, [i % 2 ? CURRENT_USER : teammates[(i + 1) % 4]], [], at(2, 9, i * 7),
    ["Kicking off copy review for the new homepage.", "Hero headline feels long to me.", "Agreed – trimming to 6 words.", "Can we A/B test the two versions?",
     "Yes, running it Monday.", "Sharing variant B in the doc.", "Variant B reads better on mobile.", "Ship B, keep A as fallback?", "Approved – ship B."][i],
    i === 8 ? { actions: [{ type: "decision", text: "Ship variant B" }] } : {},
  ]));

  return { CURRENT_USER, threads: [THREAD_Q4, THREAD_LUNCH, THREAD_DEEP] };
})();
