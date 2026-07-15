# BioAvanceD-v2

Biobank/lab management system: Node/Express backend (`api/backend/`),
React+Vite frontend (`frontend/`), Playwright e2e at the repo root,
MongoDB/Neo4j/Redis/InfluxDB via docker-compose.

## Where the knowledge lives

The durable conventions for this repo are skills under `.claude/skills/`,
and they cross-reference each other — follow those links instead of
relying on memory:

- **Any work here starts with `bioavanced-conventions`** — repo layout,
  git hygiene, the hard rules for working in Denise's repo (never open a
  PR or touch `main` without Dennis's explicit go), and the end-loaded
  Docker/CI gate order.
- **Any use of the Agent tool — any workflow, any skill — goes through
  `agent-delegation` first.** It is the one gate for agent-type choice,
  what a brief may delegate (never `gh issue create`, never PR/push/main),
  and verification, regardless of which workflow triggered the task; a
  mechanical hook backs it but does not replace reading it.
  `parallel-test-agents` covers the test-writing fan-out mechanics
  specifically (leaf workers launch as the `test-writer` agent type) and
  is the worked example `agent-delegation` points to.
- Bug-fix work on filed issues → `fix-bugs` (one issue per iteration,
  reproduce-first; the counterpart to `test-loop`).
- Test work → `test-loop` (one iteration of the coverage push) with
  `testing-conventions` for mechanics; parallel fan-out →
  `parallel-test-agents`. Legacy-code judgment calls → `legacy`.
  Shipping → `ship-to-main`. Pulling Denise's `main`-branch updates into
  our feature branch → `merge-from-main`, or `verify-against-main` for
  a single drifted file / for corroborating that a fix actually matches
  Denise's intent rather than just a local schema file's self-
  consistency.
- Writing or editing a Playwright spec (`tests/e2e/*.spec.ts`) →
  `playwright-specs` for selectors/mocked-auth/config quirks, alongside
  `e2e-docker-workflow` for the Docker/CI stack itself and
  `testing-conventions` for what to run and when.
- Every non-trivial task ends with the `wrap-up` skill *before* the
  final summary is drafted — the workflow skills invoke it as a step;
  treat it as blocking, including once per iteration in loops and when
  resuming an interrupted session.
- Machine-local quirks (not repo conventions) live in the gitignored
  `local-env` skill, if present on this machine.

Lessons learned belong in the relevant skill file, updated in the same
session they're learned — not in chat transcripts, and not in
user-profile memory.
