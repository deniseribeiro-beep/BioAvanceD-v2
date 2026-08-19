# HANDOFF

**Written:** 2026-08-19, same day as the prior three rotations. **Still
inside a rabbit hole** -- tracker **#642**. All 3 original seeds are
resolved, but a mid-run split (**#643**) is a live tracker member that
hasn't been worked yet -- the hole is not closed. Budget is close to
spent this sitting; resuming should ask Dennis whether to continue with
#643 now or in a fresh sitting, not assume either way.

## Rabbit-hole state (tracker #642)

Seeds: #641, #640, #586. Dennis's own instruction: at the end of the
hole, check on #331 (not a hole member -- a status check after exiting).

- **#640 -- closed.** `PatientIdentityService.js`'s
  `matchOrUpsertParticipant` encrypted-write fix. Merge commit `ca7bc317`
  on `feature/docker-e2e-backend-integration`. (Full detail in this
  issue's own closing comment and git history -- not re-derived here.)
- **#586 -- resolved as a case-5 deferral, left open.** Re-verified
  `toFhirPatient` still has zero live callers; posted a re-verification
  comment. Forward-looking design guardrail, not actionable today.
- **#641 -- closed against its narrowed slice-1 scope.** Added
  `AssayModel`/`DatasetModel` (dict-02 ELM-0286..0297, ELM-0416..0423)
  and mounted `/api/assays`/`/api/datasets` via the existing
  `createMasterDataRouter` factory (same one Study/Protocol/Collection
  use), `requireRole(3,4)`-gated for create. No scientific-file linkage
  -- `distributionFiles` defaults empty. 36 new tests (26 model unit +
  10 wiring integration), 110/110 targeted tests green on the merged
  tree. Slice commit `8f728ef9`, merge commit `516592bc` on
  `feature/docker-e2e-backend-integration`, pushed. Issue closed naming
  #643 as the scope carrier.
  - Two friction notes (both self-caught, no lost work): branched only
    *after* already writing 3 product files (should have branched
    first, per `build-loop`'s own instruction) -- fixed by branching
    from the dirty working tree, which carried the changes over
    cleanly. Also implemented the two models before writing their unit
    tests (test-first order followed for the routing/integration layer,
    not the model layer) -- low-risk since both models mirror
    established precedents (`Organization.js`, `Study.js`/`Protocol.js`)
    closely, but still a sequencing slip.
- **#643 -- NEW, filed this sitting, split off #641, NOT YET STARTED.**
  "RF007 AC#6 slice 2: generalize scientific-file linkage routing to
  assayId/datasetId." `Depends on:` #641 (now closed, so #643 is
  unblocked). **Needs a design decision before it's buildable**:
  dedicated routes per entity (`/api/assays/:assayId/files`,
  `/api/datasets/:datasetId/files`, mirroring the existing
  `/api/samples/:specimenId/files/...` nesting) vs. a single generic
  `/api/files` endpoint accepting whichever linkage id is provided. Full
  scope written up on the issue itself.

**Budget note** (rabbit-hole's complexity-weighted pacing, ~10 points/
sitting): #640 ~2-3, #586 ~1, #641 slice 1 ~3-5 -- roughly 7-9 of ~10
points already spent this sitting. #643 is itself estimated large
(~5 points, plus a real design decision to make before implementation
starts) -- picking it up now would push past budget. Per `rabbit-hole`'s
own Step 5, this is exactly the "surface and let the user decide"
checkpoint, not a case where finishing anyway is obviously right (#643
isn't small, and finishing it wouldn't close the hole outright without
its own separate design step first).

## After the hole closes

Once #643 is resolved (closed with code, or split further if its own
scope turns out too big) and tracker #642 is closed, **check on #331**
(Wave 2 e2e integration tracker) per Dennis's instruction -- read its
current blocking list (#322-330) fresh, report status, do not assume
anything about it from a prior sitting.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `516592bc`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
- No PR to `main` exists. Docker not brought up this sitting -- all
  three resolved seeds proved native-only (backend-internal slices, not
  the milestone's own e2e Playwright specs, per `build-loop`'s overlay).

## Recommended next steps

1. Ask Dennis whether to continue the rabbit hole with #643 this
   sitting, or pause here and resume in a fresh one -- budget is close
   to spent and #643 needs its own design decision first.
2. If continuing: #643's design decision (dedicated per-entity routes
   vs. generic `/api/files`) should be settled before writing code --
   check `docs/docs-7-31-2026/` for anything that already answers it,
   per this repo's docs-first convention, before treating it as an open
   call for Dennis.
3. After #643 closes and tracker #642 closes: check on #331 per
   Dennis's explicit instruction before ending the rabbit-hole thread.
