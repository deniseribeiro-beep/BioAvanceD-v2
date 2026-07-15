---
name: wrap-up
description: Final step for any task in this repo — actively hunt for and surface workflow friction (anything that didn't go smoothly) before reporting completion, without waiting to be asked. This is a friction audit, not a balanced wrap-up; the default expectation per finding is negative, and positives are the exception. Skills in this project (e2e-docker-workflow, etc.) should reference this in their own "wrapping up" sections rather than duplicating these instructions.
---

# Wrap up

The problem this exists to fix: friction accumulates over a session (a startup crash that
was silently patched instead of tracked, a skip-flag added to avoid a real bug, a lazy fix
that hid a symptom without addressing the root cause) and gets *noticed* in the moment but
doesn't make it into the final report unless the user happens to ask "anything worth
flagging?" afterward. By then it's a reconstruction from memory instead of a live observation.
This skill exists so the question gets asked every time, by the workflow itself, not the user.

## When this runs

At the end of any non-trivial task, before reporting it as done. Don't wait for the user
to ask "how did that go?" — run this unprompted. Every task gets this audit, including when
the answer turns out to be "nothing to report" (but treat that as the rare outcome, not the
default reach-for phrase to skip it).

Two confirmed recurrence patterns, both of which count as their own trigger (stories:
incidents `wrapup-skipped-iteration-2` and `wrapup-abandoned-post-compact` in
`bioavanced-conventions/references/incidents.md`):
- **Each iteration of a multi-iteration loop** gets its own wrap-up before its own
  summary (skipped after iteration 2 once, 2026-07-02). Having run it earlier in the
  session does not cover later iterations.
- **Resuming after a compact/interruption**: if a wrap-up audit was in progress when the
  session was cut, finish it before starting anything new (abandoned post-compact once,
  2026-07-03).

## Invocation means a Skill tool call — not recalling this text

"Running wrap-up" means invoking this skill via the Skill tool, fresh, at each trigger.
Two things that do NOT count (both observed across several consecutive iterations on
2026-07-03 — incident `wrapup-faked-from-memory`,
`bioavanced-conventions/references/incidents.md`):

- **Having this file's text in context** — from an earlier invocation, or carried
  forward in a compact summary — is not an invocation. The post-compact reminder that
  says "do not re-execute skills listed above" does not apply here: that reminder
  guards one-time setup actions, and this skill has none. A completed wrap-up is not
  "still running"; re-invoking it for a new trigger is always correct.
- **Writing out the checklist from memory** — however faithful — is not an invocation.
  The tool call is the verifiable part; reconstruction silently degrades and can't be
  audited afterward.

A committed PostToolUse hook (`.claude/hooks/push-wrapup-checkpoint.cjs`) reinforces
this mechanically: every `git push` injects a reminder to make the Skill call before
any summary. If you see that reminder at an end-of-task push, the next action is the
Skill tool call, not the summary.

## What to do

This is an audit for friction, not a status checklist. Go in assuming something rubbed wrong
somewhere. Before writing the final summary, reconstruct the session step by step and
interrogate each of the following — don't settle for whatever surfaces in the first second:

1. **Did you edit any file under `api/backend/src` or `frontend/src` this session?**
   Run `git diff --stat <session-start-commit>..HEAD -- api/backend/src frontend/src` (or check
   `git status` if uncommitted) — don't rely on memory of what you touched. If a test-loop/
   test-writer session shows anything here, that's a hard stop, not a judgment call: this
   workflow's objective is solely writing tests, and product source code is never an
   in-scope edit, including "fixing the bug my own test just found" (confirmed once,
   2026-07-04 — incident `inline-fix-of-found-bug`,
   `bioavanced-conventions/references/incidents.md`, since removed as an exception from
   `test-loop`). If you find such an edit, revert it, confirm the revert with `git diff`,
   file the underlying bug as its own issue, and say so plainly in the report — don't fold
   it quietly into the slice's commit.

2. **Did you apply a lazy fix or workaround to avoid a real bug?**
   Adding a skip-flag, silencing a crash, or working around a missing env var without raising
   a proper issue is exactly what this audit exists to catch. If the backend crashes at startup
   because of a missing required secret (`RESEND_API_KEY`, `CONSENT_SECRET`), that's a real
   bug to track — not a "just lazy-init it" situation. Ask: *would the next developer stumble
   on this same crash?* If yes, file an issue.

3. **Did anything in the expected workflow not match what actually happened?**
   A file/branch/state that didn't exist, a command that needed different syntax, a step that
   had to be reordered, a tool that errored and needed a workaround.

4. **Did a permission or tool denial block something that should have been frictionless?**
   If a step required explicit sign-off that the workflow didn't anticipate, that's worth
   surfacing so it doesn't recur as a surprise.

5. **Did you have to guess or make a judgment call the workflow didn't cover?**
   If the gap is likely to recur, it belongs in the skill file or as a tracked issue.

5a. **Did you label any sub-point "ambiguous / needs the project owner's call" and then close
   the issue it lived on?** That combination is exactly how a real, trackable problem goes
   quiet: the issue is gone from the open backlog and the only record of the leftover point is
   a comment on a closed thread (near-miss, 2026-07-08, issue #77 → #105 — caught only because
   the user asked about it directly, not because this audit surfaced it first). Before finishing
   the wrap-up, re-list every sub-point of every issue touched this iteration and confirm each
   one that wasn't fixed still has its own *open* issue, not just a mention in a closed one. And
   don't take your own earlier "needs maintainer input" label at face value here either — a
   design-fork label deserves the same reachability check as a fresh pick (see the corresponding
   note in `fix-bugs`), since what looked ambiguous mid-iteration may turn out to be a safe,
   unambiguous fix once you trace the actual callers.

6. **Was any documented instruction stale** (referenced a file, branch, command, or state
   that's since changed)?

7. **Did you retry, reorder, or work around a flaky command or tool?**
   Retries are friction even when they succeed — the retry is the cost.

8. **Did the user have to correct you, redirect you, or step in with a decision?**
   Specifically watch for: auto-opening a PR without review, auto-raising an issue without
   checking if the user already handled it, pushing to Denise's repo without explicit approval,
   or applying a lazy fix instead of raising a real bug — including editing product source
   code during a test-only workflow (item 1). These have already come up — if they recur,
   update the relevant skill or memory rather than treating each one as a one-off.

9. **Did any commit, PR description, or comment contain deferral language without a matching
   tracking issue?** Re-read your own write-ups for "out of scope," "future issue," "deferred
   to," "revisit when" — then check whether an issue actually exists for each one.

10. **Did the session waste context it didn't need to spend?** Skill text is engineered
   (rules inline, narratives and deep detail in `references/` files) but the *spending*
   happens at runtime — audit it: a full test/coverage run streamed into the conversation
   instead of redirected to a file and grepped (`testing-conventions`' context-economy
   section); a file Read in full twice, or re-Read right after editing it; an archive or
   reference file (`COVERAGE_HISTORY.md`, `references/incidents.md`) read front-to-back
   when only one entry was needed; convention text copied verbatim into a subagent brief
   when a file path to Read would have carried it. If the waste came from following a
   skill as written, the skill's structure is the finding — split the heavy detail into a
   reference the way `cjs-mocking.md` and `incidents.md` were, and leave a one-line
   pointer inline. If a needed rule was *missed* because it sat unread in a reference
   file, that's the same finding from the other side: the inline pointer wasn't
   load-bearing enough — fix the pointer, don't re-inline the whole text.

Only after exhausting the above: did anything work unusually smoothly enough that it's worth
confirming as the right approach going forward? This is the exception slot, not a second
checklist of equal weight — don't pad the report with routine successes to balance the negatives.

## A finding is not done until it has a destination

Every finding falls into one of two buckets — "I mentioned it in the wrap-up text" is not valid:

- **The skill's own text is wrong or missing something** → fix the skill file directly.
- **The finding is about the codebase/product** — a real bug, a missing capability, a startup
  crash that will bite the next developer — **file it with `gh issue create`** on
  `deniseribeiro-beep/BioAvanceD-v2` (see `bioavanced-conventions` — Dennis gave blanket OK for
  this as of 2026-07-02, no per-issue sign-off needed). A sentence in the chat transcript is not
  discoverable next session; a GitHub issue is. This applies even when you already patched it
  inline — "I fixed it" and "the next session can find out this was a gap" are different things.

**Found a problem → file it. That's the whole rule, not a judgment call.** The moment
you notice something wrong with the product — whether you found it yourself or a subagent
reported it to you — run `gh issue create` for it before doing anything else, in the same
turn you noticed it. Don't hold it to compare against other findings, don't wait for
wrap-up to collect it, don't privately weigh how likely it is to matter — "is this worth
filing" is not a question to answer at all. Filing is cheap; Dennis closes what doesn't
matter. Only skip filing if it's already covered by an open issue you've actually checked
for. (Confirmed 2026-07-02, three subagent findings dismissed until the user pushed back —
incident `dismissed-subagent-findings`,
`bioavanced-conventions/references/incidents.md`.)

**"Actually checked for" means running a search before `gh issue create`, not after.**
`gh issue list --state all --search "<key file/symbol>"` on the finding's file name or
the failing property/function name, every time, before filing — not just before *picking*
a bug to fix. Confirmed 2026-07-15: a wrap-up audit found `workers.unit.test.js`'s
SampleWorker FHIR-conversion gap and filed it as #223 without searching first; it turned
out #212 (filed the day before, broader scope — PatientWorker/TemperatureWorker/
SampleWorker together) already covered it, caught only because the user asked "did no
other issue already address this?" after the fact. Closing a same-session duplicate is
cheap, but the search that would have prevented it takes one command and should run
before the `gh issue create`, not be reconstructed afterward when asked.

## How to report it

State findings plainly in the final response to the user — don't bury them in a footnote or
wait for a follow-up question. A short paragraph or a few bullets is enough; not a separate
document. For each finding, report both what you found *and* where it now lives (issue number,
or the skill edit you made). A finding without a destination is an incomplete report.

If a finding points at a concrete, durable fix (a skill step is wrong, a workaround was applied
instead of a real fix), say that explicitly and offer to make the edit — don't just describe the
problem and leave it for later.

## What this is not

- Not a place to re-litigate decisions the user already made in this session.
- Not a request for permission to do more work — if the fix is small (editing the skill file),
  just do it and say so; if it's bigger, flag it and ask.
- Not a substitute for the task's own summary (changed files, tests, issue status). This is an
  addendum after that, not a replacement.

## Maintaining this skill

If this skill starts producing noise (flagging trivial things) or silence (drift not being caught),
fix this file directly — it's meant to stay sharp, not become a rubber-stamp step.
