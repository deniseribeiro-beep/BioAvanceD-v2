# HANDOFF

**Written:** 2026-08-06, end of session on `feature/docker-e2e-backend-integration`,
after landing #453.

## What happened this session

Dennis said "Pick #453". Routed via `work-issue` -> `resolve-issue`.
#453 asked whether the legacy `locationId`/`location`/`locationID`
numeric field group (distinct from the already-migrated `storageLocation`
box/position group) was a second real storage/location system needing
its own repository, or dead legacy predating the current model.

First pass got this **wrong**: cited `docs/docs-7-27-2026/extracted/`
and `docs/architecture/canonical-data-contract-v1.md` (which lists
storage/custody, including `locationId`, as an unresolved follow-up
under #389) and concluded "real system, build a repository" — backed by
code evidence too (`sample.service.js` requires/validates `locationID`
against a live `locations` collection, cross-checks equipment/sensors).
Dennis corrected this: "that is old docs... compare against up to date
docs." Checking `docs/docs-7-31-2026/manuscript/2.2-Additional_file_2_
Polyglot_Persistence_Data_Model.docx` (flagged by that batch's own
CHANGELOG as the fix for `canonical-data-contract-v1.md`'s known
staleness) reversed the conclusion: the canonical target model defines
only **one** physical/inventory entity pair — `StorageLocation` +
`StorageAssignment` — matching what's already built. The legacy
`Location` model (`api/backend/src/models/Location.js`:
`equipmentType`/`equipmentID`/`block`/`rack`/`drawer`/`box`/
`wellPosition`, all numeric) is a pre-normalization encoding of that
same hierarchy, not a second system. Filed
`dyeallpies-skills-pack#223` on this: `resolve-issue`'s "check docs/
first" step doesn't say to check for a newer dated doc batch before
trusting an older one, even though this repo has an explicit dated-batch
convention (`docs-7-27-2026/` -> `docs-7-31-2026/`, each batch's own
CHANGELOG stating it's a delta against the prior).

Migrating the legacy `Location` fields onto the canonical hierarchy
turned out much bigger than #453's own file list (5 consumers) — also
touches a dedicated `location.routes.js` API surface,
`locationIDGenerator.js`, `import.controller.js`, and
`audit.middleware.js`. Ran `divide-and-conquer`'s design-split playbook,
confirmed the breakdown with Dennis, filed:

- **#457** (foundational, no dependencies): design the field mapping
  from legacy numeric `Location` onto `storageContainers`/`rooms`/
  `storagePaths`/`StorageBox`/`StorageAssignment`.
- **#458** (depends on #457): migrate service-layer consumers
  (`sample.service.js`, `intakeWizard.js`,
  `equipment-sensor-quarantine.service.js` — confirmed its
  `locationId`/`locationID` hits ARE Sample's field, not sensor/IoT
  telemetry false positives, contrary to #450's own note that some
  matches there were unrelated).
- **#459** (depends on #457): migrate import-path consumers
  (`import.service.js`, `import-lgpd.service.js`,
  `import.controller.js`, `import-worker.js`).
- **#460** (depends on #458, #459): retire the legacy API surface
  (`location.routes.js`, `locationIDGenerator.js`, `Location.js`, the
  `locations` collection itself — explicitly flagged as needing Dennis's
  call before any destructive drop).

Recorded the resolved finding directly in
`docs/architecture/canonical-data-contract-v1.md` (new paragraph after
the existing storage/custody note) on branch
`test/453-locationid-legacy-finding` (doc-only change, `test/` prefix
per the branch-prefix convention), merged `--no-ff` into
`feature/docker-e2e-backend-integration` (commit `edd18e8f`), pushed.
Closed #453 with a comment explaining the reversal, the doc citation,
and the four follow-up numbers. Deleted
`test/453-locationid-legacy-finding` (local + remote).

Ran `wrap-up`: one finding — the doc-recency gap above, filed as
`dyeallpies-skills-pack#223` (not editable in-repo per Rule 0, this
session isn't in the skills-pack repo). No scope violations (only the
architecture doc touched), no lazy fixes, no security-relevant surface,
no sub-point closed as "needs owner call" without a matching open issue
— all four follow-ups filed with `Depends on:` lines before closing
#453.

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, pushed through
  `edd18e8f` (merge commit recording the #453 finding). Untracked
  `api/backend/out.txt` still present, still not investigated — carried
  forward again (now several sessions running).
- **`fix/450-storageservice-repository-migration`**: still merged, still
  not deleted — carried forward again, still safe to delete.
- Issues: **#453 closed** (this session, reversed conclusion from first
  pass — see above). **New this session: #457, #458, #459, #460** (all
  open, `enhancement`, chained `Depends on:` starting at #457). **#450
  still open** (umbrella tracker, by design). **#451, #454 still open.**
- Backlog otherwise unchanged from last handoff:
  - **#451** (status consolidation + custody/storage entity design
    question) — still open, still a real design question. Worth
    re-checking against the same July-31 manuscript doc that resolved
    #453 — it may settle #451 too.
  - **#454** — depends on #450/#452/#453/#455 landing first; #453 now
    done, but #454's own body should be re-read against the #457-#460
    split before assuming it's unblocked, since #453 didn't land the
    way #454 may have expected (design-answered + split, not a direct
    migration).
  - **#390** — still blocked (waiting on #450's follow-ups; #453 done,
    #454 remains, plus the new #457-#460 chain now also feeds into this
    area).
  - Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
    grep sweep (still not done), `test/440-retention-policy-model` and
    `test/441-retention-sweep-job` branches (merged, still not deleted),
    `fix/444-retention-period-iso8601` branch housekeeping (still carried
    forward, not re-checked).
  - dyeallpies-skills-pack#216, #210, #218, #220, #222 still open, not
    yet applied. **New this session: dyeallpies-skills-pack#223**
    (doc-recency gap in resolve-issue's doc-check step).

## Dev stack state

Untouched this session — no Docker involved (docs-only change). Last
known dev-stack state unchanged from prior handoffs (dev stack torn
down, named volumes kept, RBAC catalog seeded, 0 real users).

## Blocking next step

None. #457 is the natural next pick if continuing this thread (it's the
foundational, dependency-free piece unblocking #458/#459/#460). Small
cleanup items carried forward (not blocking): deleting
`fix/450-storageservice-repository-migration`, finally looking at
`api/backend/out.txt` instead of re-noting it.

## Recommended next steps

None explicitly queued by Dennis beyond "pick #453" (done, resolved via
split). Candidates, in likely priority order:

1. **#457** — foundational mapping design for the #453 legacy-location
   migration; unblocks #458/#459/#460.
2. **#451** (status consolidation + custody/storage entity decision) —
   check against the July-31 manuscript doc first, same source that
   resolved #453.
3. **#454** — re-read against the #457-#460 split before assuming
   unblocked.
4. **#390** — blocked until the #450 family (now including #457-#460)
   closes out.
5. Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
   grep sweep, `test/440-*`/`test/441-*` branch deletion,
   `fix/444-retention-period-iso8601` housekeeping, stray
   `api/backend/out.txt`, deleting `fix/450-storageservice-repository-migration`.

## Which skills to use

- **Doc recency matters as much as doc existence.** This session's first
  answer to #453 was wrong not because it skipped `docs/` but because it
  stopped at the first plausible doc without checking for a newer dated
  batch. This repo's docs are organized in dated batches
  (`docs-7-27-2026/`, `docs-7-31-2026/`, ...), each with its own
  CHANGELOG describing deltas from the prior batch — check for a newer
  batch's CHANGELOG before treating an older doc as settling a design
  question. Filed as `dyeallpies-skills-pack#223` since this is a
  workflow-skill gap, not a project-local one.
- `divide-and-conquer`'s design-split playbook (confirm breakdown with
  the user before filing, `Depends on:` lines, close the original against
  the narrowed deliverable) worked cleanly once the design question
  itself was actually settled — the split was really about the
  *migration's* size, not the design call.
- `AskUserQuestion` caught the wrong initial conclusion before any code
  was written — worth continuing to ask before starting implementation
  on a "design question resolved" finding, not just before starting
  implementation on an open one.
