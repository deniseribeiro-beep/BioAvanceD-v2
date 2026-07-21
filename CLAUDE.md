# BioAvanceD-v2

Biobank/lab management system: Node/Express backend (`api/backend/`),
React+Vite frontend (`frontend/`), Playwright e2e at the repo root,
MongoDB/Neo4j/Redis/InfluxDB via docker-compose.

## Where the knowledge lives

The durable conventions for this repo are skills under `.claude/skills/`,
installed from the `dyeallpies-skills-pack` (junctioned, gitignored — see
`.claude/.gitignore`; `.claude/agents/`, `.claude/hooks/`, and
`.claude/settings.json` are the accompanying committed harness assets).
They cross-reference each other — follow those links instead of relying
on memory:

- **Any work here starts with `bioavanced-v2-conventions`** — repo
  layout, git hygiene, the hard rules for working in Denise's repo (never
  open a PR or touch `main` without Dennis's explicit go), and the
  end-loaded Docker/CI gate order.
- **Any use of the Agent tool — any workflow, any skill — goes through
  `agent-delegation` first.** It is the one gate for agent-type choice,
  what a brief may delegate (never `gh issue create`, never PR/push/main),
  and verification, regardless of which workflow triggered the task; a
  mechanical hook backs it but does not replace reading it.
  `parallel-test-agents` covers the test-writing fan-out mechanics
  specifically (leaf workers launch as the `test-writer` agent type) and
  is the worked example `agent-delegation` points to.
- **`work-issue`** is the umbrella dispatcher for picking up a tracker
  issue or the backlog — it routes to the right workflow below.
  **`resolve-issue`** is the base workflow those loops extend (shared
  pre-pickup hygiene, deferral evaluation, split playbooks, close
  discipline); read it once, since the loops point back to it rather than
  restate it.
- Bug-fix work on filed issues → `fix-bugs` (one issue per iteration,
  reproduce-first; the counterpart to `test-loop`).
- Test work → `test-loop` (one iteration of the coverage push) with
  `bioavanced-v2-testing-conventions` for mechanics; parallel fan-out →
  `parallel-test-agents`. Legacy-code judgment calls →
  `bioavanced-v2-legacy`. Shipping → `ship-integration-branch`. Pulling
  Denise's `main`-branch updates into our feature branch →
  `merge-from-main`, or `verify-intent` for a single drifted file / for
  corroborating that a fix actually matches Denise's intent rather than
  just a local schema file's self-consistency.
- Writing or editing a Playwright spec (`tests/e2e/*.spec.ts`) →
  `playwright-specs` for selectors/mocked-auth/config quirks, alongside
  `docker-workflow` for the Docker/CI stack itself and
  `bioavanced-v2-testing-conventions` for what to run and when.
- Every non-trivial task ends with the `wrap-up` skill *before* the
  final summary is drafted — the workflow skills invoke it as a step;
  treat it as blocking, including once per iteration in loops and when
  resuming an interrupted session. `clean-up` runs at session end (hook-
  triggered) to sweep Docker/cargo/test-output artifacts left behind.
- Machine-local quirks (not repo conventions) live in the `dennis-windows`
  machine-profile skill.

Lessons learned belong in the relevant skill file in the pack (`skills/`
for generic ones, `projects/bioavanced-v2/` for this project's own), not
in chat transcripts, and not in user-profile memory — see the pack's own
`CONVENTIONS.md`/`README.md` for how to edit and re-sync.
