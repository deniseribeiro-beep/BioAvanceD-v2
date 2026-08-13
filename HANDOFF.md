# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Pick #551".

## What happened this session

Ran `work-issue` on #551 (RF028 AC7 full lifecycle: checkpoint/resume,
quarantine recovery, rollback), routed to `build-loop` per the repo's
own overlay (a capability spec'd in RF028/AC7 but not yet built, not a
bug or coverage gap). #551 bundles three roughly-equal-but-not-actually-
equal sub-items; checked the spec docs for an explicit build order first
(per `build-loop`'s own rule) and concluded AC7's own listing — "dry
run, checkpoint, retomada, idempotência, quarentena, verificação e
rollback" — isn't a real sequence (it interleaves two already-built
items, dry run and idempotência, so it's a feature enumeration, not a
build order). Picked by sizing/risk instead and did **one of the three
pieces** this session:

- **Quarantine recovery** (`resolveImportIssue()`,
  `api/backend/src/reference-data/reference-imports/quarantine.js`):
  transitions a quarantined `ReferenceImportIssue`
  (`resolutionStatus: 'open'`) to a terminal status
  (`accepted`/`corrected`/`ignored_with_justification`/`reprocessed`/
  `closed`), recording `resolvedAt`/`resolvedBy`/`resolutionNotes`.
  Refuses to resolve back to `open`, refuses to double-resolve an
  already-resolved issue, requires `resolvedBy`. Purely additive — no
  existing code touched. Test: `quarantine.test.js`, 6/6 green, same
  "real query-matching fake collection" bar `pipeline.test.js` already
  set for this directory (this repo has no live-Mongo tier; that fake
  *is* the "real backend" proof for a backend-internal slice per the
  `build-loop` overlay). Branch `test/551-quarantine-issue-resolution`,
  commit `de01f3f1`, merged `5bd6cb1e`, pushed. Progress comment posted
  on #551 naming the two remaining pieces.

**Not done this session — still open under #551, same issue number**
(following the #549 nine-source precedent: multiple slices, one tracked
issue, close only when all pieces land):

- **Checkpoint/resume**: the bigger of the two remaining pieces.
  `runImport()` currently reads the whole fixture into memory in one
  pass and only persists staged *concepts* to the `referenceImportStaging`
  collection at the very end (one `insertMany`) — staged **relations**
  aren't persisted anywhere, only held in an in-memory array. A real
  checkpoint/resume needs: batched read/stage/checkpoint-write cycles
  (so a crash mid-run leaves a resumable `checkpoint: {offset: N}` on
  the `ReferenceImportRun` doc), staging relations too (not just
  concepts, or a resumed run silently loses batch-1 relations — a
  §7.3 "no silent loss" violation), and resume-reload logic that
  distinguishes "existing run is `running` with a checkpoint → resume
  from it" from the current idempotent-short-circuit ("existing run in
  a terminal status → return it unchanged"). This is a real
  restructuring of `runImport`'s core loop, not just a new sibling
  function — expect it to need its own full iteration, not a quick
  follow-on to quarantine recovery.
- **Rollback**: reactivate the previous `ReferenceDatasetRelease` for a
  `datasetCode` (flip it back to `active`, flip the current active one
  back to `superseded`, preserve history per §7.2 step 12/§7.3 — no
  physical deletion), and write a `ReferenceImportRun` with
  `importMode: 'rollback'`, `runStatus: 'rolled_back'`. Looked smaller
  and purely additive (a new sibling function next to `promote()` in
  `pipeline.js`, same shape as quarantine recovery) but wasn't started
  this session — go here next if picking up #551, since it's likely the
  faster of the two remaining pieces.

### Closed this session

None. #551 stays open — one of three sub-items done.

### Filed this session

- **skills-pack#278** — `build-loop`'s "check spec docs for a
  recommended sequence" step (from skills-pack#167) doesn't say what to
  do when an AC's own item list interleaves already-built items with
  the remaining ones (this session's exact situation) — proposed text
  to distinguish a real recommended-order doc (like §7.4's own sequence)
  from a mere feature enumeration, plus proposed text for the
  same-issue-multiple-slices-across-sessions pattern (#549's precedent)
  vs. an actual `divide-and-conquer` issue split. Not applied — no
  write access to the pack from this session (Rule 0).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `5bd6cb1e`, clean,
  pushed, up to date with origin. Carries #551's quarantine-recovery
  slice on top of everything the prior handoff described (#553's
  doc-count fix, #558's test un-weakening, and the full RF028 Fase 2
  live-verify cluster from before that).
- Docker: not used this session — this slice's proof bar (per the
  `build-loop` overlay, backend-internal slice, not one of the
  milestone's own e2e Playwright specs) is the native in-memory fake-
  collection tier, not literal Docker/live-Mongo. Dev stack untouched,
  same as it was left: torn down, named volumes intact, images cached.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged — `fix/476-...`, `fix/477-...`,
  `fix/481-...`, `fix/485-...`, `fix/513-...`, `test/377-...`,
  `test/428-...`, `test/431-...`, `test/440-...`, `test/441-...`,
  `test/486-...`, `test/507-...` through `test/511-...`, the nine
  `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch — not re-verified against the integration
  branch this session either; see earlier handoffs or run the
  `resolve-issue` dangling-branch sweep before trusting this list).

## Which issue is next

**#551, continuing it** — pick rollback first (smaller, purely
additive, same shape as this session's quarantine-recovery slice), then
checkpoint/resume (the restructuring one, see above). This is Dennis's
own pick from this session, still in progress, not a guess off the
backlog.

Candidates carried forward from the prior handoff, unchanged, still
queued behind #551:

- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed this session.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#267/#268/#269/#270/#271/#278**
  — pack-repo only, low priority, unchanged this session (adds #278,
  filed this session). (#266 is resolved by #267; #267/#268/#269/#270/
  #271 are the pack maintainer's call, not this repo's.)

## Dev stack state

Not brought up this session — this slice's proof bar was native-only
(see "Repo state" above). Same state as the prior handoff left it: torn
down, named volumes (mongodb/neo4j data) untouched, images cached.

## Which skills to use

- **`work-issue` → `build-loop` routing was correct and clean** — the
  `bioavanced-v2.md` overlay's route-4 mapping (spec'd-but-unbuilt
  capability → `build-loop`) matched #551 exactly, no misroute.
- **When a `build-loop` requirement's scope spans multiple roughly-equal
  sub-items and the spec doc's own text lists them, check whether that
  list is genuinely a *build order* or just a *feature enumeration*
  before treating it as skills-pack#167's "explicit recommended
  sequence" signal** — an AC that interleaves already-implemented items
  with remaining ones (this session's RF028 AC7: "dry run, checkpoint,
  retomada, idempotência, quarentena, verificação e rollback," where
  dry run/idempotência are done) is the enumeration case, not the
  sequence case. Fall back to sizing/risk (smallest, most
  self-contained, lowest-risk-to-existing-code first) instead — filed as
  skills-pack#278 with proposed skill text, not yet applied.
- **For a multi-piece `build-loop` requirement worked across sessions,
  default to keeping every piece under the same tracked issue** (progress
  comment per landed piece, close only once every piece is done) **rather
  than splitting into a new issue number per piece** — followed the
  precedent BioAvanceD-v2#549 set (nine sources, nine branches, one
  issue) for #551 this session. Also proposed in skills-pack#278 as
  explicit skill text, not yet applied.
- Nothing else new to report — see prior handoffs for the accumulated
  repo-wide lessons (`.claude/skills/build-loop/local-env/` junctions,
  `test-loop`'s full-suite-guard hook inconsistency, the Bash/Glob
  skill-junction read-block quirk which is known and already closed
  upstream as skills-pack#126/#177/#204 — recurred again this session,
  worked around with the `Read`/`Grep` tools each time, not re-filed),
  all still believed current.
