# HANDOFF

**Written:** 2026-08-20, mid-sitting (not the sitting's end -- rotating
per-item per `rabbit-hole`'s Step 4). Picked up right after the prior
rotation's close (RF029 slices 3/6-5/6 landed, #671/#672/#673). Dennis
said "continue rabbit hole, Docker is on, we're only out when we finish
Wave 3, though we will probably not finish this session." Landed **#657**
this item. Still inside the rabbit hole -- more queue items pending this
same sitting.

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
RF014-026 are all `DONE` per `E2E_TRACEABILITY_PLAN.md`'s own status
table, but each left open follow-up/gap issues filed while building
them -- those count as rabbit-hole queue members (direct descendants of
the tracker, per the skill's scope rule), not separately-deferred debt.
**RF029 has its own sub-tracker, #668** (5/6 slices done; #674, slice
6/6 workflows/omics, stays blocked on RF027/Wave 4, which has **no issue
filed anywhere** as of this check -- confirmed still not started, so
#674 is genuinely out of reach this sitting, matching Dennis's own
expectation).

**Queue members remaining after #657's close (18 open issues, plus #674
blocked):**

| # | RF | One-line |
|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset |
| #649 | RF014 | AC#8: policy changes don't revoke sessions |
| #650 | RF015 | notification engine only wired to 1 of 5 domains |
| #652 | RF016 | AC#3: no printer-layout validation |
| #656 | RF017-adjacent | dead-code `allocateSampleToPosition` bypasses AC#7 if ever wired |
| #660 | RF024 | AC#4: Shipment entity not built |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent |
| #662 | RF024 | manageAccessRequests permission may be too broad |
| #663 | RF024 | AC#2: no AccessPolicy entity, proxied via Study.studyStatus |
| #664 | RF025 | Assay's entity links are format-only, not referential |
| #665 | RF025 | Técnico (RF's own primary actor) can't create Assay/ReagentLot |
| #666 | RF025 | AC#3: dict-02 Device entity richer than code's Equipment |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow |
| #675 | RF029 | test-support probe route: attacker-controlled payload write, audit before deploy |
| #676 | RF029 | activeCodeValidator tie-break default needs confirming |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt |
| #678 | RF029 | no ThresholdProfile entity |
| #679 | RF029 | file vocab mismatch (fileFormat/fileRole) |

Recommended pickup order: smallest/most-independent first (matches this
sitting's own approach -- #657 was picked first as the cheapest, most
self-contained item). No hard dependency order among these 18; RF024's
four (#660-663) and RF025's three (#664-666) each cluster around the
same files and may be worth picking together.

**Budget (rabbit-hole Step 5):** ~10-point sitting budget. #657 was 1
point (small, self-contained bug fix). Running total: **1/10**. Most of
the budget remains -- expect several more items to land before this
sitting's own stop-and-report checkpoint fires.

## What landed this sitting (so far)

- **#657 (MongoStorageRepository path:'N/A' fix) -- shipped, merge
  `759fa9b0`** (fix commit `9eeef825`) on
  `feature/docker-e2e-backend-integration`. `getSampleStorageLocation`
  and `resolveStorageLocationsForSamples` now reuse #654's
  `resolveAncestorContainersLive` (via a new `resolveLiveStoragePath`
  helper) when `storagePaths` has no matching document -- which is
  every real box today, since nothing writes that collection. Same
  live parent_id walk, same path-string/`fullHierarchy` shape
  `StoragePath.createFromBox` would have produced. Batched form dedupes
  by `boxId` so samples sharing a box trigger only one live resolution.
  6 new unit tests (3 written first, confirmed failing against the
  unfixed code, then passing). 114/114 green across
  `MongoStorageRepository.test.js`, `GetSampleStorageLocationUseCase.test.js`,
  `storage-query.controller.test.js` on the merged tree. No friction
  this iteration (`wrap-up` core audit ran clean).

## Repo state

- On `feature/docker-e2e-backend-integration`, 12 commits ahead of
  `origin/feature/docker-e2e-backend-integration` (10 from before this
  sitting + #657's fix commit + merge commit) -- not yet pushed; pushing
  is a `ship-integration-branch`-gate decision, not a per-item one.
  Working tree clean except the pre-existing untracked
  `.claude/skills/` and `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists.
- **Docker**: not brought up for #657 -- native unit tests were
  sufficient to prove the fix (no route/e2e surface touched). Docker
  stays "on" for this sitting per Dennis's instruction; later queue
  items (especially the RF029-adjacent #675/#676/#678/#679, which touch
  the real-backend ingestion gateway) will likely need it.
- `fix/657-storage-location-live-fallback` was merged and deleted
  locally; never pushed remotely.

## Recommended next steps

Still inside the rabbit hole. Next: pop another item from the 18-issue
queue above (smallest/most-independent first), work it via the normal
`work-issue` routing, rotate this file again per Step 4 after each
close, and stop only at the sitting's own budget checkpoint (~10
points) or when Dennis says stop -- not before. #674 stays out of reach
until RF027 exists.
