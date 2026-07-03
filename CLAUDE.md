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
- Test work → `test-loop` (one iteration of the coverage push) with
  `testing-conventions` for mechanics; parallel fan-out →
  `parallel-test-agents` (leaf workers launch as the `test-writer` agent
  type). Legacy-code judgment calls → `legacy`. Shipping → `ship-to-main`.
- Every non-trivial task ends with the `wrap-up` skill *before* the
  final summary is drafted — the workflow skills invoke it as a step;
  treat it as blocking, including once per iteration in loops and when
  resuming an interrupted session.
- Machine-local quirks (not repo conventions) live in the gitignored
  `local-env` skill, if present on this machine.

Lessons learned belong in the relevant skill file, updated in the same
session they're learned — not in chat transcripts, and not in
user-profile memory.
