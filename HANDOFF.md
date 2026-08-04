# HANDOFF

**Written:** 2026-08-04, after picking up #399 (Sample.js status-field
consolidation implementation) on `feature/docker-e2e-backend-integration`
and re-scoping it into a four-issue plan.

## What happened this session

Dennis said to pick up #399 (the implementation of #398's design
decision). Invoked `resolve-issue` via the Skill tool, then
`bioavanced-v2-conventions` and `build-loop` (since #399 looked like a
spec'd-but-missing capability at first) — no stale branches found, repo
was clean and in sync with origin.

**Before touching any code**, grepped the real footprint of the four
fields (`lifecycleStatus`/`availabilityStatus`/`quarantineStatus`/
`quarantineReason`) across the repo: **~40 files, ~284 occurrences** —
16 backend src files (~140), 15 backend test files (~90), 7 frontend
files (~33, none of which #399's own text mentioned at all), 2 e2e specs
(~21). This is roughly 7x what #399's "touches at minimum" list implied.

Loaded `divide-and-conquer` to judge whether this is a chunking candidate
or a stop-and-flag atomic change. A straight field rename that frontend/
e2e read directly off API responses can't be safely half-migrated (the
skill's own "rename family" example) — but presented Dennis a 3-way
choice (full atomic cutover now / backend-only now with a temporary
regression / stop and re-plan first). **Dennis chose to stop and
re-plan.**

Designed a 4-phase breakdown using an **expand → migrate → contract**
sequence — each phase keeps the legacy fields correctly *derived* from
the new canonical field until the last phase removes them, so no phase
ever ships a half-migrated state (this is what makes chunking safe here
despite #399's own "not incrementally" language: the dual-write bridge,
not the commit size, is what prevents drift). Presented the breakdown to
Dennis, got "File them," then filed it as four issues via
`gh issue create`, each with `Originating issue: #399` and an explicit
`Depends on:` line to the previous phase, per `divide-and-conquer`'s
design-split playbook:

- **#405** — `specimenStatus` core field + dual-write bridge (`Sample.js`,
  `sample.service.js`, `SampleModel.computeStatus()`). Depends on #398
  (done). **Foundational — this is the natural next pickup.**
- **#406** — `QuarantineAction` entity + quarantine write-site migration
  (`equipment-sensor-quarantine.service.js`, `intakeWizard.js`/
  `.routes.js`, `eConsent.js`, `fhir-import-staging.service.js`). Depends
  on #405. **Also where #404 (governance-block lifecycleStatus-sync bug)
  actually gets fixed** — collapsing to one write path removes that drift
  class.
- **#407** — frontend + e2e migration to `specimenStatus` (7 frontend
  files, 2 e2e specs). Depends on #406.
- **#408** — remove the legacy fields, update
  `canonical-data-contract-v1.md`'s prohibited-fields list, **closes
  #399**. Depends on #407.

Commented on #399 with the full breakdown and left it open as the
tracking issue (not closed — closing happens at #408, per the playbook).

**Also filed** (skill/hook orchestration, not a BioAvanceD-v2 product
finding): `DyeAllPies/dyeallpies-skills-pack#203` —
`push-wrapup-checkpoint.cjs` fired immediately after the first of four
sequential `gh issue create` calls in this session's filing playbook,
forcing an empty/premature `wrap-up` audit before the playbook had
gotten anywhere. Didn't visibly re-fire for the remaining three
`gh issue create` calls or the `gh issue comment` call — net effect was
one premature empty run, not four repeats — but worth fixing at the
hook-granularity level since it'll recur for any future multi-issue
filing playbook.

**No code was touched this session** — pure research + issue filing.
`git status`/`git diff` confirmed clean before wrap-up.

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged from before
  this session (still at `56d1245e`), clean, in sync with origin. No
  branches created, merged, or deleted.
- Issues: **#399 still open**, now the tracking issue for a 4-issue
  chain (#405→#406→#407→#408) instead of a single implementation task.
  **#405, #406, #407, #408 newly filed this session**, all open, all
  `enhancement`, dependency-chained. **#404** still open, unfixed —
  now explicitly tied to land as part of #406, not #399 directly.
  **#389** (parent tracking issue) still open, unchanged. **#401, #402**
  still open, unstarted, unchanged.

## Blocking next step

None. Nothing queued as blocking.

## Recommended next steps

Dennis didn't name a specific next pick this session (only said "pick
#399," which turned into the re-scoping above). Candidates, most natural
first:

- **#405** — the foundational phase of the #399 chain, now the natural
  next pick: `specimenStatus` core field + dual-write bridge in
  `Sample.js`/`sample.service.js`. Everything else in the chain (#406,
  #407, #408) is blocked on it.
- **#401** — no dependency, likely near-trivial.
- **#402** — no dependency, low priority (`StorageAssignment`
  placement-history feature gap).
- Older backlog, unchanged: **#384–#387**, `#371`/`#373`/`#374`/`#378`/
  `#379`.

## Which skills to use

- **Whichever of #405/#401/#402 is picked up next: invoke `resolve-issue`
  via the Skill tool explicitly before acting** — standing rule, still
  holding. **#405 specifically is `build-loop`-shaped** (a canonical
  field that doesn't exist in the code yet) — invoke that too, and read
  its "prove, then build" section before writing the dual-write logic:
  the failing test should assert `specimenStatus` behavior against the
  strongest native-only proof bar this repo's overlay allows (mocked
  Mongo with real query-matching semantics), not literal Docker, since
  this is a backend-internal slice, not one of the RF-milestone's own
  e2e specs.
- **#405 (and every phase after it)**: re-read #399's breakdown comment
  and `docs/architecture/canonical-data-contract-v1.md`'s `### Specimen`/
  `### QuarantineAction` sections before touching code — the dual-write
  bridge design (why legacy fields stay derived until #408) is the whole
  reason chunking this was safe; skipping it in #405 would recreate the
  exact half-migration risk #399's own text warned about.
- **#390** (multi-consumer migration once RCS/SPREC/storage-custody
  entities land): still blocked on #401 and now indirectly on the full
  #405→#408 chain.
- Backlog unchanged otherwise: **#384–#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session.
