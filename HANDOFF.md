# HANDOFF

**Written:** 2026-08-20, mid-sitting (not the sitting's end -- rotating
per-item per `rabbit-hole`'s Step 4). Continuing the Wave 3 rabbit hole
under Dennis's "continue, Docker is on, we're only out when we finish
Wave 3, though we will probably not finish this session" instruction.
Landed **#657**, **#676**, and **#656** this sitting so far, plus a
follow-up (**#680**) and a skills-pack finding (**dyeallpies-skills-pack#358**).
Still inside the rabbit hole -- more queue items pending this same
sitting.

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
RF014-026 are all `DONE` per `E2E_TRACEABILITY_PLAN.md`'s own status
table, but each left open follow-up/gap issues filed while building
them -- those count as rabbit-hole queue members (direct descendants of
the tracker, per the skill's scope rule). **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, stays blocked on
RF027/Wave 4, which still has no issue filed anywhere -- confirmed not
started).

**Queue members remaining (16 open issues, plus #674 blocked):**

| # | RF | One-line |
|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset |
| #649 | RF014 | AC#8: policy changes don't revoke sessions |
| #650 | RF015 | notification engine only wired to 1 of 5 domains |
| #652 | RF016 | AC#3: no printer-layout validation |
| #660 | RF024 | AC#4: Shipment entity not built |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent |
| #662 | RF024 | manageAccessRequests permission may be too broad |
| #663 | RF024 | AC#2: no AccessPolicy entity, proxied via Study.studyStatus |
| #664 | RF025 | Assay's entity links are format-only, not referential |
| #665 | RF025 | Técnico (RF's own primary actor) can't create Assay/ReagentLot |
| #666 | RF025 | AC#3: dict-02 Device entity richer than code's Equipment |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow -- **explicitly needs Dennis/Denise's call per the issue's own text, don't resolve unilaterally** |
| #675 | RF029 | test-support probe route: attacker-controlled payload write, audit before deploy |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt |
| #678 | RF029 | no ThresholdProfile entity |
| #679 | RF029 | file vocab mismatch (fileFormat/fileRole) |
| #680 | RF029-adjacent (filed this sitting) | canonical contracts version-requirement policy call, split off #676 |

No hard dependency order among these except #667 (design-call, skip
unless Dennis weighs in). RF024's cluster (#660-663) and RF025's cluster
(#664-666) each touch the same files and may be worth picking together.

**Budget (rabbit-hole Step 5):** ~10-point sitting budget. #657=1pt,
#676=~1-2pt, #656=1pt. Running total: **~4/10**. Budget remains for
several more items.

## What landed this sitting (so far)

- **#657** -- MongoStorageRepository path:'N/A' fix, merge `759fa9b0`.
- **#676** -- activeCodeValidator unversioned-lookup ambiguity fix,
  merge commit `ad05ec81`. Split off **#680** (canonical-contracts
  version-requirement policy call, left open).
- **#656** -- removed dead `StorageService.allocateSampleToPosition`/
  `validatePositionAvailability`/`_isPositionOccupied` (zero live
  callers, matched #480's own precedent for this file's other 3 dead
  methods; #484 already confirmed the underlying occupancyGrid
  divergence is latent/safe). Fix commit `c24a90eb`. `storageService.test.js`:
  122 -> 63 (via #480) -> 36 tests. 80/80 across all four files that
  import `storageService.js`, green on the merged tree.

All three merged into `feature/docker-e2e-backend-integration`, all
three issues closed with merge-commit-bearing comments.

## Friction this sitting (wrap-up audit)

- **#676's slip (documented in the prior rotation of this file)**: skipped
  invoking the routed skill before starting work, hit `routing-gate.cjs`'s
  block retroactively at close time. Matches dyeallpies-skills-pack#211's
  already-fixed, already-documented "retroactive invocation" shape --
  no new issue, just a reminder to invoke proactively.
- **#656's variant**: invoked `resolve-issue` for #656 correctly
  *before* starting this time, but then read `gh issue view 480`/`484`
  for precedent-checking, which reset the gate's per-issue scope (per
  #355's fix -- the gate scopes to the *last-viewed* issue, not a
  lifetime presence check). Had to re-invoke `resolve-issue` naming
  #656 explicitly before the edit landed. This is the gate working
  exactly as #355 documented it should (confirmed by re-reading #355's
  own text and the block message's own explanation) -- not a new bug,
  no new issue filed. Lesson for the rest of this sitting: if precedent
  research means viewing other issues mid-work, re-invoke the routed
  skill for the *current* issue right before the edit, every time.
- **dyeallpies-skills-pack#358** (filed in the prior rotation): identical
  `npx vitest run tests/unit/ingestion` blocked on the second run with
  no directory-content change -- distinct from the known #259 pattern
  (directory growing). Still open, not yet addressed (out of this
  session's control -- it's the pack repo's own fix).

## Repo state

- On `feature/docker-e2e-backend-integration`, 16 commits ahead of
  `origin/feature/docker-e2e-backend-integration` -- not yet pushed;
  pushing is a `ship-integration-branch`-gate decision. Working tree
  clean except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **Docker**: not brought up yet this sitting -- #657, #676, and #656
  were all provable with native unit tests alone. Stays "on" per
  Dennis's instruction; later queue items (especially #675/#677/#678/#679,
  which touch the real-backend ingestion gateway) will likely need it.
- All three fix branches from this sitting were merged and deleted
  locally; none were ever pushed remotely.

## Recommended next steps

Still inside the rabbit hole. Next: pop another item from the 16-issue
queue above (skip #667 -- it explicitly needs Dennis/Denise's call).
Invoke the routed skill for the *current* issue right before editing,
every time -- including after any precedent-research reads of other
issues. Rotate this file again per Step 4 after each close, stop only
at the sitting's own budget checkpoint (~10 points) or when Dennis says
stop. #674 stays out of reach until RF027 exists.
