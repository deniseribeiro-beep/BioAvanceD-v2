# HANDOFF

**Written:** 2026-08-19, later same day as the prior rotation (docs-first
sweep of the open backlog, prompted by Dennis's steer to check whether
the `docs/docs-7-31-2026/` batch resolves any old issues). **#282, #359,
and #379 all closed** -- one pure docs-confirmation close, one real
security-relevant code fix upgraded from "ask Dennis" to "the docs
already answer it," and one direct decision from Dennis acted on
immediately.

## What landed this sitting

- **#282** (RF030 referenced but never defined in the RF table): closed,
  no code/doc change needed. `docs/docs-7-31-2026/1-Requisitos-...md`
  (v3.0.1) already fixes the prose bug upstream -- explicitly states "não
  existe RF030" and corrects the Fase-3 matrix to say RF029. Confirmed
  this is the newest doc batch (no `docs-8-*` folder exists yet).
- **#359** (authLimiter's `isDev`-gated 100/min budget, filed after #350
  as "record a decision"): turned out **not** to need Dennis's sign-off
  -- `docs/docs-7-31-2026/1-Requisitos-...md`'s RNF008 point 6 (Crítica
  priority, present unchanged since the 7-27 batch) explicitly forbids
  relaxing rate limits/auth controls via NODE_ENV or a generic
  environment indicator. The old `isDev ? 100 : 10` gate
  (`isDev = NODE_ENV !== "production"`) violated this directly, since
  `NODE_ENV` defaults to `'development'` whenever unset at all
  (`api/backend/src/config/env.js`) -- any deploy that simply omitted
  `NODE_ENV`, not just the real Docker dev stack, got the relaxed
  budget. Fixed: replaced the gate with an explicit
  `AUTH_RATE_LIMIT_RELAXED` opt-in that only `compose.dev.yml`'s
  `.env.docker` sets (added to both `.env.docker.example` and the local
  `.env.docker`), locked out entirely in production regardless of the
  flag. Rewrote the pinned `#350` regression tests
  (`api/backend/tests/integration/auth-rate-limiter.test.js`) to cover
  all three cases -- `NODE_ENV=development` alone now stays strict (new
  regression test), the explicit opt-in restores the relaxed behavior,
  production stays strict even with the opt-in set. 3/3 green, plus
  `test:architecture` 60/60 green, run on both the fix branch and the
  merged integration branch. Branch `fix/359-authlimiter-node-env-gate`,
  commit `44e54687`.
- **#379** (whether the 7-31 manuscript/supplementary PDF revisions
  should supersede the submitted CMPB copies): Dennis's explicit call
  this sitting was **yes, supersede**. Replaced
  `docs/research/cmpb-submission/manuscript/Manuscript.pdf` and
  `supplementary/Supplementary File {1,2}...pdf` with the
  SHA-256-confirmed-different revisions from
  `docs/docs-7-31-2026/manuscript/`. Deliberately left untouched:
  `submission/CMPB-S-26-05153.pdf` (the actual journal-submitted
  package -- a historical record, not a working copy), `Supplementary
  File 3...pdf` (no 7-31 revision exists for it), and the `.tex` sources
  (no revised LaTeX was in the 7-31 drop, only compiled PDFs -- so the
  `.tex` sources and their PDFs are now out of sync; not treated as a
  gap needing its own issue since there's nothing to reconcile against
  until a revised `.tex` shows up). Branch
  `test/379-cmpb-submission-supersede`, commit `dba26d8c`.

All three merge commits landed on `feature/docker-e2e-backend-integration`
(pushed through `919f6ecf`), both source branches deleted locally (never
pushed remotely). All three issues closed with comments citing the
evidence/decision and commit/test results.

## Docs sweep -- what's still genuinely open (checked, not resolvable now)

- **#567** (Administrador-only role scope for `reidentifyParticipant`):
  checked RNF007 -- it only says "authorized, audited, tied to legitimate
  purpose," no role-granularity guidance. Still genuinely Dennis/Denise's
  call; no new information from this sweep, so no new comment posted
  (nothing changed since the issue's last comment).
- **#283** (`canonical-data-contract-v1.md` stale against the
  segregated `ParticipantIdentity` model): the new manuscript spec
  (`docs/docs-7-31-2026/manuscript/2.2-...Polyglot_Persistence_Data_Model.docx`)
  is a strong source to finally fix this, but the target file is 1142
  lines against a 26-domain/79-entity spec -- scoped out of this sitting
  as a dedicated-session task, not a quick-group item. Worth picking up
  next if continuing the docs-driven thread.
- **#115** (`syncFromOrphadata` partial-coverage risk): re-confirmed
  still correctly deferred to the canonical terminology data-modeling
  phase per Denise's own prior comment on the issue -- not re-touched
  this sitting, no new information.

## Other findings this sitting

- **Filed `dyeallpies-skills-pack#341`**: `resolve-issue`'s local-env/
  step has no `bioavanced-v2.md` overlay, so nothing in its own flow
  points a session at `bioavanced-v2-conventions`' branch-before-edit
  rule before the first edit. Concretely bit this sitting -- used `cp`
  (Bash, not caught by the `edit-branch-guard` hook, which only watches
  Edit/Write/NotebookEdit) to modify `docs/research/cmpb-submission/`
  files directly on `feature/docker-e2e-backend-integration` for #379,
  before ever loading `bioavanced-v2-conventions` and discovering the
  branch-per-issue rule. Caught before committing (`git stash` + branch
  + `stash pop`), no bad outcome, but it's the same near-miss shape
  `bioavanced-v2-conventions` already documents from 2026-07-09 (issue
  #125). Suggested fix filed on the pack issue: add the missing
  local-env overlay file.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `919f6ecf`
  (the #359 and #379 merges) plus this HANDOFF rotation still to commit.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
- **Only targeted native tests run this sitting** -- #359's fix got
  `auth-rate-limiter.test.js` (3/3) + `test:architecture` (60/60), run
  twice (fix branch, then merged integration branch); #282 and #379 were
  docs/binary-file changes with no applicable native test. Per the
  conventions skill's gate order, this is the correct per-iteration
  tier, not a shortcut.
  - **The full native suite (`--coverage` backend run, frontend
    `typecheck:full`, etc.) has NOT been re-run since two HANDOFFs ago**
    -- now three small-to-medium commits stale on top of that last
    confirmed-green full-suite run.
- **Docker/CI gate not run this sitting** -- same as always, that's
  `ship-integration-branch`'s job, not asked for yet. No PR to `main`
  exists.
- **#628's migration script (`backfillResultSpecimenIds.js`) still has
  not been run against any real environment** -- older than this
  sitting, still outstanding, unrelated to this sitting's work.
- Stale local+remote branch `fix/599-ci-trigger-integration-branch`
  (unrelated, still-open issue #599) still noted in passing, never
  touched.

## Recommended next steps

None queued -- Dennis didn't name a next issue this sitting. If picking
this repo back up:
1. Re-check the open backlog fresh (`gh issue list --state open`) --
   #567/#283/#115 above are the ones already triaged and confirmed
   still-blocked/deferred; everything else hasn't been re-looked-at
   this sitting.
2. #283 (`canonical-data-contract-v1.md` staleness) is the most
   concretely scoped next docs-driven task if continuing that thread --
   the source manuscript doc is already identified, just needs the
   dedicated-session time.
3. Consider a full native-suite re-run before treating the branch as
   verified-green end-to-end, since only targeted tests ran on top of
   the last full-suite confirmation two HANDOFFs ago.
