---
name: agent-delegation
description: Mandatory pre-check before any Agent tool call in this repo — which agent type to use, what a brief may and may not delegate, and how findings get verified and filed. Read this before launching a subagent, every time, regardless of which workflow skill (test-loop, fix-bugs, parallel-test-agents, ship-to-main) is driving the task.
---

# Agent delegation — read this before every Agent tool call

This is not one option among several delegation approaches — it is the
single gate every Agent tool call in this repo goes through, no matter
which workflow skill triggered the task. `test-loop`, `fix-bugs`,
`parallel-test-agents`, and `ship-to-main` each describe *when* fanning
out helps their own workflow; this skill is the one place that governs
*how* any of them may actually do it. If a task's own skill is silent
on delegation, that is not permission to improvise — it means this
skill is still the answer.

A mechanical backstop exists too
(`.claude/hooks/agent-delegation-guard.cjs`, wired as a PreToolUse hook
on the Agent tool) and will hard-block the two failure modes below
outright. But the hook is a backstop for when this gets missed, not a
substitute for reading it — its regexes catch the shapes of the known
incident, not every variant of the same mistake.

## The decision, in order

1. **Is this actually independent, parallelizable work** (multiple
   distinct files/modules/routes, no shared state, each slice
   verifiable on its own)? If not — one coherent gap, one flow, a
   single investigation — do it directly. Delegation has coordination
   and review overhead; don't pay it for one slice.

2. **If it is parallelizable: what shape of task is it?**
   - *Writing/extending tests across independent files* →
     `parallel-test-agents`'s fan-out, `subagent_type: test-writer`
     for every leaf worker, no exceptions. `test-writer` is
     mechanically contained (`.claude/agents/test-writer.md`): no
     `Agent` tool (cannot spawn further sub-agents), and its Bash runs
     through `.claude/hooks/test-writer-bash-guard.cjs`, which blocks
     `gh`, git mutations, docker, and dependency changes.
   - *Read-only research/investigation* (locating code, answering
     "where is X", surveying a codebase) → `Explore` or
     `general-purpose` is fine — these have no write/mutate surface to
     misuse.
   - *Anything that could conclude "file an issue" or "make a change"*
     (bug triage, failing-test triage, code review with fixes) → the
     subagent's job ends at reporting findings back in its final
     message. It never calls `gh issue create`, never opens a PR, never
     pushes, never edits `api/backend/src` or `frontend/src` on your
     behalf. The primary session reviews the report and takes those
     actions itself.

3. **Never pick `general-purpose` (or any agent with full tool access,
   including its own `Agent` tool) for a large batch of independent
   items** (many failing tests, many files, many issues) **as a
   shortcut around building the `test-writer` fan-out.** A
   `general-purpose` agent can spawn its own sub-agents with no
   containment at all — one hop further from oversight than the
   orchestrator itself, and the hop the mechanical hook exists to
   catch. If the batch doesn't cleanly split into `test-writer`-shaped
   slices, that's a sign to do the triage directly rather than reach
   for the bigger hammer.

## What a brief may never contain

- An instruction to run `gh issue create`, `gh issue edit`, `gh issue
  close`, or `gh issue comment`. Findings are reported back in the
  agent's final message; the primary session files them after review.
  This holds even though `bioavanced-conventions` gives the *primary
  session* a blanket OK to file issues without per-issue sign-off —
  that OK was never extended to subagents, and delegating the filing
  step defeats the review it assumes happens first.
- An instruction (or `isolation: "worktree"` + broad-access agent type)
  that lets the agent open a PR, push a branch, or touch `main`.
- Any assumption the brief-writer hasn't verified firsthand this
  session — see `parallel-test-agents`'s briefing rules for the
  from-memory-claim incidents this produces.

## After every delegated task, regardless of shape

Verification is never delegated. Re-run what the agent claims to have
run, yourself, before acting on its report — a subagent's "tests pass"
or "found no issues" is a claim, not a result. See
`parallel-test-agents`'s "After they report back" section for the
specific mechanics (re-run individually, run slices together, triage
findings yourself, commit per slice).

## Maintaining this skill

If a new delegation shape shows up that this skill's decision tree
doesn't cover, add it here — this is the one place all delegation
judgment calls should route through, not a new note bolted onto
whichever workflow skill happened to be running. If the mechanical hook
needs a new pattern to catch a variant of an old mistake, update
`.claude/hooks/agent-delegation-guard.cjs` in the same session and note
why in `bioavanced-conventions/references/incidents.md`.
