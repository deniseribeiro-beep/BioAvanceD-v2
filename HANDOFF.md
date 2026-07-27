# HANDOFF

**Written:** 2026-07-27, end of a planning/docs session (session 25) —
not a `test-loop`/`fix-bugs` iteration; this session extracted the new
doc drop, planned a new milestone, and set up the tracking/branch for
its first implementation phase. No product code touched.

**Branch:** `test/e2e-real-backend-foundation`, branched off
`feature/docker-e2e-backend-integration`. Not yet pushed as of this
writing — see "Repo state" below for exactly what's staged to go.

## What happened this session

1. **Extracted the new `docs/docs-7-27-2026/` doc drop** (Requisitos
   v3.0.0, Plano Integrado Foundation Data Pipeline v2.1.0, Dicionário
   Consolidado v1.3.0 xlsx, `DENISE_VALIDATION_STATUS.md`, 5 architecture
   diagrams) into clean, grep-friendly markdown under
   `docs/docs-7-27-2026/extracted/` — docx/xlsx are expensive for an AI
   session to read directly; the extraction makes future sessions cheap.
   Caught and documented two real defects in the source docs themselves
   while doing it (not extraction bugs): the Lucidchart diagrams' RF
   numbering runs one behind the doc's own table from RF014 onward, and
   the doc's own intro/matrix prose references an "RF030" that was never
   actually added to the table (table stops at RF029) — both noted
   in-place in `diagrams-index.md`/`requisitos-index.md`, and the RF030
   one filed as issue #282 for Denise.
2. **Wrote `E2E_TRACEABILITY_PLAN.md`** (repo root): the new milestone —
   translate all 29 RF (+ RNF where applicable) into real Playwright e2e
   tests — with a full RF traceability matrix, RNF classification, and
   wave sequencing. Verified thoroughly on a second pass at the user's
   request (row counts cross-checked against the source xlsx three
   independent ways, every RF/RNF confirmed to appear exactly once across
   the matrix/waves/groups) — found and fixed 6 real defects in the plan
   itself (wrong RF count, two rows silently missing from the wave
   sequencing, a mislabeled priority, two RNF misclassifications).
3. **Plan-mode session → `E2E_IMPLEMENTATION_PLAN.md`** (repo root): the
   *how*, grounded in direct code exploration rather than the dated
   (2026-07-22) gap-analysis docs alone. Confirmed the backend is more
   built-out in places than the docs suggested (rich `sample.routes.js`,
   real `reference-imports/` script, RFC3161/witness audit infra) and
   less in others that matter here — no CI job runs Playwright today, and
   the real-backend e2e login path (`PLAYWRIGHT_USE_REAL_LOGIN`,
   `TEST_USER`/`TEST_PASS` in `compose.test.yml`) is dead scaffolding.
   User made three scope calls: rebuild legacy/testid-less frontend pages
   fresh rather than patch them; build real backend+frontend integration
   from scratch rather than retrofit mocking; CI wiring and the Docker
   milestone are explicitly *later*, separate milestones.
4. **Checked whether the seed/login gap was a fresh bug — it wasn't.**
   Issues #144 and #5 (closed 2026-07-10) already covered this exact
   territory; Denise's own closing comment on both says she'd "remodel
   the data again... rebuild a clean Playwright test suite from scratch"
   — this session's whole plan is that rebuild, now scoped against the
   new v1.3.0 docs. Confirmed the old `seed.js`/`seeders` mechanism she
   was replacing is genuinely gone from current `main` (its branch is an
   ancestor of HEAD, but those scripts aren't in current `package.json`),
   so no duplicate issue was filed for that specific gap.
5. **Filed 3 new issues** (searched for duplicates first, including the
   #144/#5 near-miss above): #282 (RF030 doc defect, for Denise), #283
   (`docs/architecture/canonical-data-contract-v1.md` stale vs the new
   dictionary — missing `ParticipantIdentity` segregation), #284 (no CI
   job runs Playwright today).
6. **Created 2 GitHub milestones**: #2 "Playwright E2E Tests (Docker,
   Real Backend) — All Requirements & Use Cases" (#282/#283 attached),
   #3 "CI Integration for E2E Tests" (#284 attached, explicitly
   sequenced after #2). Existing milestone #1 (90% coverage) untouched.
7. **Filed 2 skills-pack issues** (Rule 0 — can't edit junctioned skills
   directly): #128 (point `bioavanced-v2-conventions` at the new doc set
   + `E2E_TRACEABILITY_PLAN.md`), #129 (neither `test-loop` nor
   `fix-bugs` fits "build a not-yet-implemented requirement + its
   real-backend e2e test together"; also a smaller branch-naming-prose
   vs. hook-enforcement mismatch found while setting up this session's
   branch).

## Repo state

- `test/e2e-real-backend-foundation`, branched off
  `feature/docker-e2e-backend-integration`. **Not pushed yet** — this
  handoff is being written and committed in the same step as the first
  push of this branch, so by the time this is read the branch should be
  pushed and clean.
- Untracked → about to be committed: `E2E_TRACEABILITY_PLAN.md`,
  `E2E_IMPLEMENTATION_PLAN.md`, `docs/docs-7-27-2026/` (raw docs +
  `extracted/`), this `HANDOFF.md` rotation.
- No product code touched this session — docs, planning, and GitHub
  tracking artifacts only.
- `feature/docker-e2e-backend-integration` itself unchanged this session.

## Milestones (as of this session)

- **#1 "90% Test Coverage"** (existing, set 2026-07-22 by Dennis, still
  current): Statements/Functions/Lines already past 90%; Branches at
  88.74% is the sole remaining laggard (per issue #228's 2026-07-27
  reconcile — no new reconcile run this session).
- **#2 "Playwright E2E Tests (Docker, Real Backend)"** (new): the RF/RNF
  e2e milestone — see `E2E_TRACEABILITY_PLAN.md`/`E2E_IMPLEMENTATION_PLAN.md`.
- **#3 "CI Integration for E2E Tests"** (new): deferred until #2 closes.

## Recommended next steps

Explicitly named by Dennis this session: unit-test coverage (#1, nearly
done) → Playwright e2e tests (#2) → Docker hardening → CI (#3), in that
order. Concretely, next session should start **Phase 0** of
`E2E_IMPLEMENTATION_PLAN.md` on this branch:

1. Wire `BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_TEMP_PASSWORD` into
   `compose.test.yml`'s `&test-env` anchor to match `TEST_USER`/
   `TEST_PASS`, and add a step running `npm run admin:create-first`
   against `backend-app-test` before Playwright runs.
2. Fix `compose.test.yml`'s `playwright-runner` service (wrong working
   dir/command — see `E2E_IMPLEMENTATION_PLAN.md` Phase 0 step 2 for the
   exact fix).
3. Build `tests/e2e/helpers/realAuth.ts` and
   `tests/e2e/helpers/assertAuditEvent.ts` (patterns and reference files
   already identified in the plan).
4. Start Wave 1 of the spec build once Phase 0 is verified.

## Which skills to use

Neither `test-loop` nor `fix-bugs` cleanly covers this milestone's shape
(flagged as skills-pack issue #129) — until a pack session resolves that,
treat Phase 0/wave work as its own thing: branch per logical unit
(`test/<slug>`, since that's what the deployed hook actually accepts —
see #129's branch-naming note), commit per verified slice, `wrap-up`
still applies every session, Docker is effectively opt-in-for-the-whole-
milestone rather than per-session for this specific initiative (user's
explicit direction), CI still stays untouched until milestone #3.

## Dependency notes

Phase 0 blocks all of Phase 1+ (waves can't prove anything real without
a working seeded login). RF022/RF028 waves each need their own focused
design pass when they start — intentionally not pre-designed in
`E2E_IMPLEMENTATION_PLAN.md`. `dyeallpies-skills-pack#122`/`#123`/`#124`/
`#125`/`#126`/`#127`/`#128`/`#129` are pack-repo items, not BioAvanceD-v2
blockers.

## Session note

Two mid-session process catches worth naming: (1) started editing/writing
files while still on a branch left over from a prior, already-completed
slice — caught and fixed by branching properly before the first commit;
(2) nearly filed a duplicate issue for the seed/login gap before checking
history and finding #144/#5 already covered it with a clear "rebuilding
from scratch" closure — searching before filing held up. No scope creep
otherwise (verified via `git status`); this was planning/docs/tracking
work only, no product code.
