# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
"Continue rabbit hole" instruction this sitting. Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -- #697 resolved into a concrete 6-slice plan (#707-713), none started yet

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
This sitting made **no product-code changes** -- it was entirely
tracker bookkeeping + one design decision from Dennis:

1. Caught #646 up on last sitting's unposted #706/#698/#696 resolution
   (comment posted).
2. Re-derived #646's live queue from scratch. Found both remaining open
   descendants non-actionable without Dennis: **#674** (RF029 slice 6/6,
   blocked on RF027 -- confirmed no RF027 issue exists anywhere, still
   `MISSING`/Wave-4/"lowest urgency" per `E2E_TRACEABILITY_PLAN.md:338-
   339`) and **#697** (RF005's 6 remaining clinical entities, self-
   scoped as "marker, not picked up" pending a UI/product call, per
   `canonical-data-contract-v1.md:1295-1298`).
3. Asked Dennis how to proceed on both. He chose: **leave RF027/#674
   alone for now**; **make the #697 UI call now** -- build real
   intake-wizard UI for all 5 UI-gap entities (ClinicalObservation/
   ClinicalOutcome/AllergyIntolerance/FamilyHistory/Procedure) and
   implement a real Charlson Comorbidity Index (CCI) algorithm for
   `DerivedScore`, rather than leaving them schema-only.
4. That's real, multi-slice build work -- ran `divide-and-conquer`'s
   filing playbook. Filed **#707** as the tracking issue with 6
   independent sub-slices (no cross-dependencies, all 6 entities'
   models/services already exist per #691/#692):
   - **#708** AllergyIntolerance intake-wizard UI + wiring
   - **#709** FamilyHistory intake-wizard UI + wiring
   - **#710** Procedure intake-wizard UI + wiring
   - **#711** ClinicalObservation intake-wizard UI + wiring (genuinely
     new UI, no existing field to repurpose)
   - **#712** ClinicalOutcome intake-wizard UI + wiring (genuinely new
     UI)
   - **#713** real CCI algorithm + `DerivedScore` wiring
   Closed **#697** as superseded by #707's concrete plan.
5. Asked Dennis whether to start slice 1 this sitting given the rabbit
   hole's budget was already well past its advisory limit before this
   sitting even started -- he chose **file and stop**. None of #708-713
   started.

## What landed this sitting

- Tracker bookkeeping only: 1 catch-up comment + 1 final queue-update
  comment on #646; #697 closed; #707 opened as tracking issue; #708-713
  opened as its 6 sub-slices. No code, no branch, no merge.
- **Friction found and filed:** `gh issue create` doesn't support
  `--json`/`-q` (unlike `view`/`list`) -- a capture attempt
  (`n1=$(gh issue create ... --json number -q .number | tail -1)`)
  silently no-op'd on 3 issues before being caught via a sanity-check
  `gh issue list --search`. No data lost, but worth knowing: capture the
  printed URL instead. Filed as
  [dyeallpies-skills-pack#376](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/376).
- Docker stack (inherited, not started/used this sitting): confirmed
  still up via `docker ps` at session start; Dennis chose to leave it
  running for the next #646/#707 pickup.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `dd70afc0` (one docs-only commit this sitting: the mid-sitting
  HANDOFF.md rotation -- this file supersedes it). No product-code
  branch created or needed.
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** Same stack, not rebuilt (no source changed this
  sitting). Deliberately left running per Dennis's check-in.

## Recommended next steps

**#707's 6 sub-slices (#708-713) are the live, unblocked queue** --
each independent, each `build-loop` shaped (real intake-wizard UI +
backend wiring + real-backend Playwright proof, same pattern as #693).
No slice depends on another; pick any. #711/#712 (ClinicalObservation/
ClinicalOutcome) are the two needing genuinely new UI fields rather than
repurposing an existing one -- likely the larger two.

#674 stays parked on RF027 (Wave 4, not started, out of scope for now)
-- Dennis explicitly chose not to pull that forward this sitting.

Rabbit-hole budget: this sitting spent ~2pts (investigation + design
decision + filing 7 issues, no code). Cumulative total from prior
sittings was already well past the ~10pt advisory budget before this
one started. Six new unstarted slices (#708-713) now sit in the queue
on top of that -- worth a explicit gut-check with Dennis at the start of
the next sitting on whether to keep descending on #646/#707 or treat
this as a natural point to close out the rabbit hole and revisit #707
as ordinary backlog.
