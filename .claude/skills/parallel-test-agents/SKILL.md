---
name: parallel-test-agents
description: Fan out test-writing across several parallel subagents to cover more ground per iteration, then verify their combined output yourself before committing. Use when a test-coverage push has multiple independent gaps (modules/routes/files with no shared state) and the user wants to speed up writing tests via parallel agents — not for a single small gap, and not as a substitute for personally verifying results.
---

# Parallel test-writing agents

Speeds up a test-coverage push by writing several independent test
slices at once instead of one at a time. The speedup is in authoring;
verification stays serial and stays with you — this skill does not
change who is responsible for confirming the tests are real and green.

This skill covers the fan-out/fan-in mechanics. Project-specific rules
(tiering, honest-test rules, where issues get filed, git hygiene) live
in this repo's own conventions skills (`bioavanced-conventions`,
`testing-conventions`, `test-loop`) — read those first and pass their
relevant rules into every agent's brief.

## When this is worth it

Only fan out when you have genuinely independent slices:

- Each slice targets a distinct file/module/route with no shared
  fixtures, shared mutable state, or overlapping edits.
- Each slice is scoped small enough that one agent finishing wrong
  doesn't block the others.
- There are enough real gaps to justify it — don't invent 3 slices out
  of one small gap just to parallelize.

If the work is one coherent gap (one file, one flow), do it directly
instead — coordination overhead isn't worth it for a single slice.

## Before fanning out

1. Identify candidate slices from real signal (coverage report, an open
   tracking issue's checklist, known-thin modules) — not guesses.
2. Check for overlap between candidate slices (shared files, shared
   fixtures/setup, shared mocks) and drop or merge any that collide.
3. Decide how many agents (usually 2-4 — more than that gets hard to
   review honestly). Pick a number you can actually verify afterward;
   the bottleneck is your review capacity, not agent capacity.
4. **Check whether each slice's target test file already exists**
   (`git log --oneline -1 -- <path>` or just look) before telling the
   agent to "write a new file at X." Confirmed 2026-07-03
   (BioAvanceD-v2, `security.routes.test.js`): a brief assumed a fresh
   file when a thinner, already-committed test file was sitting at that
   exact path — the agent had to notice the mismatch and extend it
   instead. It handled it fine, but the brief was wrong going in; a
   30-second check catches this before the agent has to improvise.
   **Check by the actual test-file naming convention, not the source
   file's basename** — confirmed again 2026-07-04 (`logs.routes.js`):
   the orchestrator's pre-check grepped `tests/integration` for
   `logs.routes` and found nothing, but the existing file was named
   `logs.api.test.js` (route files consistently get `<name>.api.test.js`
   for integration tests, not `<name>.routes.test.js`) — the brief again
   claimed "confirmed no existing file," and the agent again had to
   notice and extend the real one. Grep the `tests/integration/`
   directory listing itself (`ls tests/integration` or a broad
   glob) rather than constructing a filename to grep for.
5. **Don't assert a file's specific structural details (which imports it
   destructures, whether a value is module-scope-cached) from earlier
   general reading — re-check the exact lines before writing them into
   a brief as fact.** Confirmed 2026-07-03 (BioAvanceD-v2,
   `incident.controller.js`): a brief stated as fact that the file did
   "NOT destructure `connectMongoDB` at module scope," which was wrong —
   it does, on line 2. The agent's first draft (written to the brief's
   claim) made real network/DB calls and failed before it noticed the
   mismatch and applied the correct require-cache-clear workaround
   instead. No lasting harm since the agent self-corrected, but it's a
   free check: `grep -n "require(" <file>` before writing any claim
   about a file's require/destructuring shape into a brief.

## Launching and briefing each agent

**Launch every leaf worker as `subagent_type: test-writer`** (defined in
`.claude/agents/test-writer.md`), all in one message (parallel `Agent`
tool calls). Containment is mechanical, not verbal: the agent type has
no `Agent` tool (it cannot delegate or spawn sub-subagents), and its
Bash runs through `.claude/hooks/test-writer-bash-guard.cjs`, which
blocks `gh`, git mutations, docker, and dependency changes with a
redirect message. This design exists because long "do not X" lists in
briefs are unreliable on smaller models — some will do exactly the
negated thing — and because a brief full of restrictions has been
misread by the permission classifier as binding the *main* agent too
(see the `local-env` skill). The agent definition carries the
boundaries; the brief carries the work.

Each brief must be self-contained, positively framed (say what the
agent owns and delivers, not a litany of prohibitions), and include:

- The exact file/module/route it owns and the exact path its test file
  goes to — its scope stated as its whole world, not as a fence.
- The project's test-tier placement rules and honest-test rules (no
  tautological assertions, name real invariants, don't weaken
  assertions to get green) — copy these in, don't assume the agent will
  find the project's conventions unprompted.
- Any project-specific tooling quirk you assert (a mocking gotcha, a
  runner trap, a framework behavior) must be quoted verbatim from that
  project's own conventions skill, not stated from memory. Confirmed
  2026-07-02 (BioAvanceD-v2): briefing three agents from memory that
  "`vi.mock()` reliably intercepts `require()`" directly contradicted
  the project's own documented finding (the opposite was true and
  already written down), and all three agents burned time independently
  rediscovering the correct answer before falling back to the
  documented workaround. If you're not currently looking at the
  project skill's exact wording, don't paraphrase it into a brief —
  open the file and copy the relevant lines in.
- Instruction to run its own targeted test command and report the
  actual output, not a paraphrase — but make clear this is a sanity
  check, not the verification of record.
- The deliverable, stated as the agent's publishing channel: a final
  report with files added, tests added/passing/failing, and a plain
  description of any product behavior that looks wrong. Frame issue
  handling affirmatively — "findings described in your report are
  triaged and filed by me after review" — rather than as a prohibition.

**Findings reported back are yours to triage and file.** The subagent's
report is where a finding *starts*; `gh issue create` after your own
review is your job as orchestrator (authorized per
`bioavanced-conventions`), and nothing about the leaf agent's
containment restricts you.

## After they report back

Verification is never delegated — a subagent's "tests pass" is a claim,
not a result:

1. Re-run each new test file individually yourself. Confirm it's
   actually discovered by the runner (watch for fixed-list/allowlist
   runners that silently skip new files — a green run that never loaded
   the file is a false positive).
2. Run all the slices' new/touched test files together in one command
   (not the full backend suite) to catch cross-slice interaction the
   parallel authoring couldn't see — e.g. `npx vitest run <file1>
   <file2> <file3>`. Confirmed 2026-07-04: a bare full-suite `npx
   vitest run` with no path is hard-blocked mid-loop by
   `test-loop`'s own guard (full suite is reserved for the
   `ship-to-main` coverage-reconcile phase); this repo's "run the full
   relevant suite" step means the slices together, not literally
   everything.
3. Triage any real bug a test surfaced per the project's rule for
   in-scope-fix vs. file-as-finding — do this yourself, don't ask the
   agent that found it to also fix it blind.
4. Commit slices separately (one commit per slice) unless the project's
   convention says otherwise — keeps the diff reviewable and keeps a
   bad slice revertable without taking the good ones with it.

## If a slice comes back wrong or incomplete

Resume that same agent with the full-context message tool (not a fresh
`Agent` call) so it has its own prior work in context. Only re-scope or
drop a slice entirely if the gap it targeted turned out not to exist or
collided with another slice after all.

## Maintaining this skill

This skill lives in this repo now but its mechanics are
project-agnostic — keep project-specific detail (runner quirks, CI
gates, issue-filing rules) in the other conventions skills and
reference them from the briefs, rather than inlining them here. If a
lesson about the fan-out/fan-in mechanics themselves surfaces, update
this file directly.
