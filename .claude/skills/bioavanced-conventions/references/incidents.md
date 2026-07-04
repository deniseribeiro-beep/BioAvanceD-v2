# Incident archive — the stories behind the rules

Repo-wide archive of the incidents that produced the rules in the
`.claude/skills/` files. The rules themselves stay inline in their
skills with a one-line marker like `(incident: <slug>)` pointing here;
this file holds the full narrative — what happened, when, and why the
rule is worded the way it is. Read a specific entry when you're
questioning a rule, tempted to soften it, or writing it into a brief
and need the original context. Don't read this file front-to-back at
session start — that's exactly the cost the split avoids.

Maintenance: when a new lesson produces a rule, the rule (plus a
one-line marker with date and slug) goes in the relevant skill; the
multi-sentence story goes here under a stable kebab-case heading. If a
rule is later removed, remove its entry here in the same edit.

---

## dismissed-subagent-findings (2026-07-02)

Three parallel test-writing subagents each surfaced a real behavioral
observation in the file they were testing (inconsistent input escaping,
an ambiguous failure-mode in an aggregate return shape). The
orchestrating session treated "is this worth an issue" as a question to
decide, decided no for all three, and only mentioned them in the chat
summary — then had to be prompted ("don't you think you were a bit
dismissive?") before filing two as issues #16/#17. The blanket OK to
file exists so there is no question to decide: notice something wrong
with the product (yourself, or reported back by a subagent) →
`gh issue create` it right then, don't wait to collect findings, don't
weigh how likely it is to matter first, don't hold it to compare
against other findings. It costs Dennis seconds to close a non-issue;
it costs a rediscovery later if a real one only lives in a chat
transcript. Only skip filing if it's already covered by an open issue
you've actually checked for.

Rules in: `bioavanced-conventions` (Found a problem → file it),
`wrap-up` (A finding is not done until it has a destination).

## issues-migration (2026-07-02)

Earlier in the test-building push, findings were staged locally in
`.claude/issues/` before Dennis gave the blanket OK to file directly on
GitHub; that folder was removed 2026-07-02 once its contents were
migrated to GitHub Issues #6/#7 — #3/#5 already existed upstream.

Rules in: `bioavanced-conventions` (Issue tracking).

## root-vitest-spurious-failures (2026-07-02)

There is no vitest config at the repo root, so root `npx vitest run`
sweeps up `api/backend/tests/**` (143 files at the time) but without
backend's `vitest.setup.js` env — verified 2026-07-02: 23 spurious
failures (`secretOrPrivateKey must have a value` etc.) that pass when
run from `api/backend/` properly. Broken plumbing, not real failures —
it needs either a root vitest config scoping what it should test or
removal of the `test:browser:*` scripts (surfaced to Dennis; fits issue
#3's "fix broken test plumbing" scope).

Rules in: `testing-conventions` (Test tiers), `ship-to-main` (native
pre-flight warning).

## vi-mock-briefed-from-memory (2026-07-02)

Three fan-out agents were briefed from memory that "`vi.mock()`
reliably intercepts `require()`" — directly contradicting the project's
own documented finding (the opposite was true and already written
down), and all three agents burned time independently rediscovering the
correct answer before falling back to the documented workaround. Hence:
tooling quirks reach agents as the project's canonical text (a
reference-file path to Read, or a verbatim copy) — never a paraphrase
from memory.

Rules in: `parallel-test-agents` (briefing),
`testing-conventions/references/cjs-mocking.md`.

## wrapup-skipped-iteration-2 (2026-07-02)

In a multi-iteration loop, the wrap-up audit ran correctly after
iteration 1 and was then skipped after iteration 2 until the user
asked. Each iteration gets its own fresh wrap-up invocation before its
own summary — having run it earlier in the session does not cover later
iterations.

Rules in: `wrap-up` (When this runs), `test-loop` (Ending an
iteration).

## wrapup-abandoned-post-compact (2026-07-03)

A wrap-up audit was in progress when the session was compacted; after
the compact it was abandoned and a new slice started instead, and the
unfinished audit only surfaced when the user asked about it. A compact
is not a clean slate: finish the interrupted iteration's close-out
first.

Rules in: `wrap-up` (When this runs), `test-loop` (Before an
iteration).

## wrapup-faked-from-memory (2026-07-03)

Several consecutive iterations "ran" the wrap-up audit as prose
reconstructed from memory — the checklist text was in context from an
earlier invocation or a compact summary, and no Skill call ever
happened. Reconstruction silently degrades and can't be audited
afterward; the Skill tool call is the verifiable part. The committed
`push-wrapup-checkpoint.cjs` hook was added to reinforce this
mechanically on every `git push`.

Rules in: `wrap-up` (Invocation means a Skill tool call), `test-loop`
(Ending an iteration).

## bare-vitest-mid-loop (2026-07-03)

Mid-iteration, a bare `npx vitest run --reporter=basic` (whole suite,
no path) was run despite the targeted-only rule being in context at the
time — the instruction being present isn't enough on its own. Treat "am
I about to run vitest with no file path argument" as a question to ask
before every Bash vitest call during a loop iteration, not just a rule
to have read. (A guard now hard-blocks the bare form mid-loop; the full
suite is reserved for `ship-to-main`'s coverage-reconcile phase.)

Rules in: `test-loop` (Doing the work), `parallel-test-agents` (fan-in
step 2).

## brief-assumed-fresh-file (2026-07-03)

A fan-out brief assumed a fresh test file when a thinner,
already-committed test file was sitting at that exact path
(`security.routes.test.js`) — the agent had to notice the mismatch and
extend it instead. It handled it fine, but the brief was wrong going
in; a 30-second existence check (`git log --oneline -1 -- <path>` or a
directory listing) catches this before the agent has to improvise.

Rules in: `parallel-test-agents` (Before fanning out, step 4).

## test-filename-convention-miss (2026-07-04)

Follow-up to brief-assumed-fresh-file: the orchestrator's pre-check
grepped `tests/integration` for `logs.routes` and found nothing, but
the existing file was named `logs.api.test.js` — route files
consistently get `<name>.api.test.js` for integration tests, not
`<name>.routes.test.js`. The brief again claimed "confirmed no existing
file," and the agent again had to notice and extend the real one. Check
by the actual test-file naming convention, not the source file's
basename — list the `tests/integration/` directory itself rather than
constructing a filename to grep for.

Rules in: `parallel-test-agents` (Before fanning out, step 4).

## brief-wrong-destructure-claim (2026-07-03)

A fan-out brief stated as fact that `incident.controller.js` did "NOT
destructure `connectMongoDB` at module scope," which was wrong — it
does, on line 2. The agent's first draft (written to the brief's claim)
made real network/DB calls and failed before it noticed the mismatch
and applied the correct require-cache-clear workaround instead. No
lasting harm since the agent self-corrected, but it's a free check:
`grep -n "require(" <file>` before writing any claim about a file's
require/destructuring shape into a brief.

Rules in: `parallel-test-agents` (Before fanning out, step 5),
`testing-conventions/references/cjs-mocking.md`.
