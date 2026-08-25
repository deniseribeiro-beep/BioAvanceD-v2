# HANDOFF

**Written:** 2026-08-25 (end of sitting). **Still inside a rabbit hole**
(tracker **#725**). This sitting closed **#737** and **#742** (both split
off #723 mid-work), landed and merged **#723's** RF008/RF013 real-backend
specs, ran #723's full-suite gate twice, and stopped at the pacing
budget (~12 points spent of ~10) with **#723 left open pending Dennis's
call** on its Definition of Done -- see below.

## Rabbit-hole state

Tracker: **#725**, open. Members closed across all sittings: #724, #726,
#727, #728, #730, #737, #742. Remaining members:

- **#723** -- specs done and merged (`d0e6d1ec`), traceability rows
  DONE. Gate: **193/200 green** single-worker on the full
  `compose.test.yml` stack (core + admin bootstrap + foundation +
  16-source reference chain). The 7 failures are pre-existing, test-only,
  unrelated to RF008/RF013, each filed with root cause: **#744** (×4,
  `inline-storage-movement.spec.ts` missing a mock for
  `GET /samples/:id/files`), **#745** (×2, `seedActiveTerminologyConcept`
  supersedes the real HPO/ORPHA/ICD10/OMIM releases and never restores
  them), **#746** (×1, intake-wizard's fixed CPF → 409). **Decision
  needed from Dennis:** close #723 as "green modulo filed pre-existing
  failures" (my recommendation), or land #744/#745/#746 first. Comment
  with the full triage table is on #723.
- **#743** -- Wave 4 showcase reel (RF008 `/reports` → export, RF013
  `/backup`), split off #723's DoD. Not started; needs Docker.

Once both resolve, run #725's upward-cascade check and close it naming
every member above.

## Findings filed this sitting (not queue members)

BioAvanceD-v2: #738 (no mongodump/mongorestore in the Docker image →
lossy JSON fallback always), #739 (RF008 AC#1: only `status` of six
filter dimensions wired), #740 (BackupPage doesn't render
status/checksum), #741 (patient-list narrowing only when the sample
filter matched something), #744/#745/#746 (above). Skills-pack: #398
(Rule-0 hook false positives), #399 (where a new seed belongs), #400
(playwright-specs overlay gotchas), #401 (long heredocs fail in the Bash
tool), #402 (handoff-checkpoint misses Bash-written rotations), #403
(docker-workflow overlay recipe omits the bootstrap chain; `--workers=1`;
known gate failures).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, up to date with
  origin as of `7e97cbe0` (#742 merge) plus this rotation. No fix/test
  branches left; none were ever pushed as remotes.
- **Docker is DOWN** -- `compose.test.yml` torn down at end of sitting
  (`compose down`, no `-v`; `bioavanced-test_*` named volumes intact;
  `docker builder prune -af` reclaimed 1.45GB). The volume's reference
  releases were repaired by hand after the last run (#745 poisons them
  on every `intake-wizard.spec.ts` run -- repair recipe is in #745 and
  pack #403). Next bring-up: the overlay recipe **plus** the bootstrap
  chain (`foundation-bootstrap-test` + all `reference-data-bootstrap-*-test`)
  if a full gate is intended, and `--build` for backend/frontend if
  source changed.
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward again.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

1. Dennis decides #723's close (see above); close it with the gate
   numbers if yes.
2. Optionally work #744/#745/#746 as ordinary `test-branch` items --
   all three are small, test-only, and together make the gate literally
   green (#745 first: it's the one that corrupts shared data).
3. #743 (showcase reel) when Docker is on again.
4. Then close #725.
