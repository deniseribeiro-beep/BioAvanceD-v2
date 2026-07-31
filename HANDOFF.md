# HANDOFF

**Written:** 2026-07-31, a `build-loop` session closing out **#329**
(RF022 Foundation Data Pipeline, Wave 2 red-first prerequisite) on
`feature/docker-e2e-backend-integration`, picked up directly from Dennis
after the prior #328 close-out — Docker was already on (dev stack, not
the test stack) for this session.

## What happened this session

1. Routed via `work-issue` → `build-loop`: #329 asks for the first
   honest e2e test against the real backend for RF022, expected to fail
   — file the actual bootstrap rework as a separate follow-up once the
   red test shows what's missing.
2. Scoped the gap against `dict-07_ALINHAMENTO_CODIGO.md` /
   `dict-08_MAIN_GAPS.md` ("Gap crítico"): confirmed in code that
   `essential/manifest.js` (3 entries) +
   `scripts/seed-essential-reference-data.js` is a manual CLI script —
   `current-state:ci` only ever `--dry-run`s it, `compose.test.yml`
   never invokes it at all, and nothing in `src` wires it to
   startup/healthchecks. No API surface exists for reference data or
   run-tracking either.
3. Added a new `test.describe` block to
   `tests/e2e/pipeline-continuity.spec.ts` ("Foundation Data Pipeline
   bootstrap (RF022) — real backend"), plus a new helper
   `tests/e2e/helpers/queryFoundationData.ts` (same direct-Mongo pattern
   as `seedParticipant.ts`/`queryNeo4j.ts`, since there's no API to
   assert against): AC "reference data populated automatically" and AC
   "bootstrap records an idempotent run" both **confirmed red** against
   the real (already-up) dev-stack backend — 0 docs in
   `sampleTypes`/`terminologies`, 0 docs in `referenceSeedRuns`.
4. Caught my own process slip mid-iteration: edited the spec/helper
   files directly on `feature/docker-e2e-backend-integration` before
   creating the `test/<slug>` branch build-loop calls for. Fixed via
   `git stash -u` → new branch → `git stash pop`, before any commit —
   no lasting harm, flagged in `wrap-up`.
5. Committed on `test/rf022-foundation-pipeline-red-first`, merged
   `--no-ff` into `feature/docker-e2e-backend-integration` (`08e48b3e`),
   pushed.
6. Filed **#366** (build the actual one-shot bootstrap + `FoundationDataRun`
   tracking, replace the manual seed script) as a separate follow-up,
   flagged as likely needing `divide-and-conquer` and as the RF029/Wave 3
   sequencing blocker per the plan.
7. Closed **#329** with a comment summarizing both red assertions and
   linking #366.
8. `wrap-up` audit: no product source touched (`git diff --stat` against
   `api/backend/src`/`frontend/src` empty). Only friction: the
   branch-order slip in step 4 above (self-caught, no issue needed — it's
   already the documented failure mode build-loop's own steps guard
   against, not a skill gap).

## Repo state

- `feature/docker-e2e-backend-integration`: at `08e48b3e`, working tree
  clean, pushed. Carries the new RF022 red-first spec + helper.
- **#329 closed**, referencing follow-up **#366** (open, not started —
  scope explicitly flagged as possibly needing `divide-and-conquer`).
- Dev stack (`compose.yml`, not `compose.test.yml`) was already up this
  session (per #327/#328's precedent) and left running — not torn down.

## Recommended next steps

None queued explicitly by Dennis beyond "prereqs of Wave 2." Remaining
Wave 2 red-first prerequisite per `E2E_TRACEABILITY_PLAN.md`: **#330**
(RF028 Fase 2 importers, same `pipeline-continuity.spec.ts`, also blocks
RF029). **#363** (ParticipantIdentity model/migration, from #327),
**#364**/**#365** (from #328), and now **#366** (from this session) are
separate, smaller build-loop/fix-bugs candidates once someone picks them
up.

## Which skills to use

`work-issue` → `build-loop` for #330 (same red-first shape as
#327/#328/#329). `fix-bugs` or a small `build-loop` pass for
#363/#364/#365/#366 once picked up — all are narrow, already-scoped gaps,
not full-requirement builds; #366 in particular should open with a
`divide-and-conquer` pass rather than assume one iteration. Another
`ship-integration-branch` pass once Wave 2's red-first prerequisites and
any build-loop follow-ups are done.
