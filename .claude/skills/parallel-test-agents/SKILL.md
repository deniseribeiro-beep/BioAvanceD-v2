---
name: parallel-test-agents
description: Fan out test-writing across several parallel subagents to cover more ground per iteration, then verify their combined output yourself before committing. Use when a test-coverage push has multiple independent gaps (modules/routes/files with no shared state) and the user wants to speed up writing tests via parallel agents — not for a single small gap, and not as a substitute for personally verifying results.
---

# Parallel test-writing agents

Speeds up a test-coverage push by writing several independent test
slices at once instead of one at a time. The speedup is in authoring;
verification stays serial and stays with you — this skill does not
change who is responsible for confirming the tests are real and green.

This is the worked example for `agent-delegation`, which is the
mandatory pre-check for *any* Agent tool call in this repo, not just
test-writing fan-out — read that first if you haven't already this
session. This skill covers the fan-out/fan-in mechanics. Project-specific rules
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
   before telling the agent to "write a new file at X" — list the
   target `tests/` directory itself rather than guessing a filename to
   grep for. `testing-conventions`' "Test tiers" section has the actual
   naming convention that trips this up (route integration tests) and
   the incident history.
5. **Don't assert a file's specific structural details (which imports it
   destructures, whether a value is module-scope-cached) from earlier
   general reading — re-check the exact lines
   (`grep -n "require(" <file>`) before writing them into a brief as
   fact.** A confidently wrong destructuring claim sent an agent's
   first draft against real network/DB (confirmed 2026-07-03 — incident
   `brief-wrong-destructure-claim`,
   `bioavanced-conventions/references/incidents.md`).

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
- The project's test-tier placement rules and honest-test rules — copy
  `testing-conventions`' "Test tiers" and "Tests are honest or they're
  worthless" sections into the brief verbatim, don't assume the agent
  will find the project's conventions unprompted.
- Project-specific tooling quirks (mocking gotchas, runner traps,
  framework behavior) must reach the agent as the project's own
  documented wording, never your paraphrase from memory — a from-memory
  claim that contradicted the project's own documented finding cost
  three agents independent rediscovery time (confirmed 2026-07-02 —
  incident `vi-mock-briefed-from-memory`,
  `bioavanced-conventions/references/incidents.md`). **The
  context-cheap way to do this:
  when the quirks live in a standalone reference file, put that file's
  path in the brief with an instruction to Read it in full before
  writing the relevant code** (test-writer has the Read tool) — in this
  repo that's `.claude/skills/testing-conventions/references/cjs-mocking.md`
  for anything that mocks/spies/stubs. That's one path per brief instead
  of ~90 quoted lines per agent, and the agent gets the canonical text
  either way. Only quote verbatim inline when the quirk has no file to
  point at — and then open the file and copy, don't paraphrase.
- Instruction to run its own targeted test command and report the
  actual output, not a paraphrase — but make clear this is a sanity
  check, not the verification of record.
- The deliverable, stated as the agent's publishing channel: a final
  report with files added, tests added/passing/failing, and a plain
  description of any product behavior that looks wrong. Frame issue
  handling affirmatively — "findings described in your report are
  triaged and filed by me after review" — rather than as a prohibition.

**Findings reported back are yours to triage and file** — see
`agent-delegation` for the full rule (never the leaf agent's job,
regardless of containment).

## After they report back

Verification is never delegated — a subagent's "tests pass" is a claim,
not a result:

1. Re-run each new test file individually yourself. `testing-conventions`'
   "fixed-list runner trap" section covers the specific failure mode to
   watch for (a runner that silently skips new files — a green run that
   never loaded the file is a false positive).
2. Run all the slices' new/touched test files together in one command
   (not the full backend suite) to catch cross-slice interaction the
   parallel authoring couldn't see — `testing-conventions`' "context
   economy" section has the exact invocation and output-handling rules,
   and `bioavanced-conventions` covers why a bare full-suite run is
   blocked mid-loop.
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
