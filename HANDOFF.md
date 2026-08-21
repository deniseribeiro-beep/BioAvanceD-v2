# HANDOFF

**Written:** 2026-08-21. Docker is on (inherited stack from an earlier session, left running -- see "Repo state" below).

## Exited the rabbit hole: #646 -> #668 -> #674 chain is done; #646 itself stays open on a separate, unrelated item

**#668 (RF029's own tracking issue) is closed -- all 6/6 slices landed.**
This sitting picked up exactly where the last one left off (#674, the
final slice, was the only remaining item once RF027/#716 unblocked it
last sitting) and finished it. Re-derived the chain fresh from the issue
threads themselves rather than trusting the prior handoff's summary, per
`rabbit-hole`'s own discipline -- and that paid off directly: the prior
handoff claimed "#646 has no other open items beyond the #668/#674
chain," which turned out to be **stale/wrong**. #646 (Wave 3 tracker)
has a second, unrelated open descendant, **#697** (RF005's remaining 6
clinical entities), self-scoped months ago as "marker, not urgent,
pending a product call on new intake-wizard UI scope." Not picked up
this sitting -- it needs Dennis's steer on that UI-scope question, not
just implementation effort. **#646 stays open on #697 alone.**

## What landed this sitting

**#674 (RF029 slice 6/6) closed**, merged to
`feature/docker-e2e-backend-integration` (not yet pushed -- see below):

- Added `canonical.v1.workflow` / `canonical.v1.omicsQualification` /
  `canonical.v1.omicsRun` to `api/backend/src/contracts/canonical/v1/index.js`,
  mirroring RF027's (#716) `WorkflowRunModel`/`OmicsQualificationModel`/
  `OmicsRunModel.validate()` field-for-field.
- Wired all 3 through RF029 slice 1's ingestion gateway (#669), same
  probe-only pattern slices 2-5 established -- **no new production
  ingestion routes**; `/api/workflow-runs`, `/api/omics-qualifications`,
  `/api/omics-runs` stay untouched.
- `OmicsQualification.targetAssay` is this slice's one FK-checked
  reference (against the real `assays` collection, via a new
  `seedAssay()` fixture in `tests/e2e/helpers/seedParticipant.ts`) --
  same "one cheaply-seedable reference" scope #673 applied to Assay's
  own `studyId`. Workflow has no referenceable collection of its own;
  OmicsRun's `fileLinks` stays unreferenced for the same
  cross-collection-file-resolution reason `canonical.v1.file`'s own
  `specimenId`-only check already applies.
- 15 new unit tests (`api/backend/tests/unit/ingestion/workflowOmicsSchema.test.js`)
  + 7 new real-backend e2e tests (new block in `pipeline-continuity.spec.ts`),
  all green on the first run against a rebuilt `backend-app-test`.
- Also fixed `E2E_TRACEABILITY_PLAN.md`'s **RF027 row**, which was still
  stale (said MISSING) from before #716 actually landed last sitting --
  fixed in the same pass as RF029's own row going to DONE (6/6).

Merges: `ae5aaaf8`/`74f42d4d` (the slice itself), `d13dc971`/`81baed03`
(the doc fix), all on `feature/docker-e2e-backend-integration`.

**Filed #722** (bug, playwright): running the *full*
`pipeline-continuity.spec.ts` file (not just this slice's own new
block) surfaced 2 pre-existing failures, unrelated to #674's own
change -- RF029 slices 1/6 and 2/6's own "real active code" tests
depend on the `reference-data-bootstrap-hpo-test` chain having actually
run against the stack (for a real, non-fabricated `HP:0000001` concept).
This stack instance never ran that chain (confirmed: zero such
containers ever created, zero active HPO releases in Mongo) -- the
documented bring-up recipe only covers the core service list, not the
16-source reference-data-bootstrap chain. Not a code regression; a
test-design fragility (depends on operational history of the stack
instance, not on the code under test). Not fixed this sitting -- out of
#674's own scope, touches earlier foundation-slice (#669/#670) test
design.

## Repo state

- On `feature/docker-e2e-backend-integration`, **4 commits ahead of
  origin, not pushed** (this repo's convention: work locally, push only
  on Dennis's explicit say-so). No PR to `main` exists; `main` stays
  frozen per convention.
- **Docker: UP**, same inherited stack, still running (12/12 containers
  healthy as of this sitting's end). `backend-app-test` was rebuilt this
  sitting (`--build`) to pick up the new contract-schema source and is
  healthy as of the e2e run above. Confirm it's still healthy
  (`docker ps`) before trusting it in a future session, and rebuild
  again before any further e2e run if more backend source has changed
  since.
- Two untracked paths present all sitting, not touched: `.claude/skills/`
  and `api/backend/storage/assays/` -- pre-existing, not created by this
  session.

## Recommended next steps

Dennis didn't name a specific next issue. None queued. Options surfaced
this sitting, not picked:
- **#697** (RF005's remaining 6 clinical entities, #646's own last open
  descendant) -- needs Dennis's product-scope call on new intake-wizard
  UI first, not just build effort. Ask before picking this up.
- **#722** (the reference-data-bootstrap-chain test fragility just
  filed) -- self-contained, no product decision needed, could be picked
  up directly.
- **#721** (imaging entities carve-out from RF027/OmicsRun) -- smaller,
  well-scoped, not urgent, still open from an earlier sitting.
- **#664** (Assay's own link fields are format-only, no referential
  integrity on the real route) -- still open, flagged again by #673 and
  #674's own gateway-only reference checks; bigger than one slice per
  its own scope note.
