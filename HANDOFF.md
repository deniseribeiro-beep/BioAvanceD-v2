# HANDOFF

**Written:** 2026-08-20, mid-sitting (not the sitting's end -- rotating
per-item per `rabbit-hole`'s Step 4). Continuing the Wave 3 rabbit hole
under Dennis's "continue, Docker is on, we're only out when we finish
Wave 3, though we will probably not finish this session" instruction.
Landed **#657**, **#676**, **#656**, and **#664** this sitting, plus
follow-ups **#680** and two skills-pack findings
(**dyeallpies-skills-pack#358**, **#359**). Still inside the rabbit
hole -- more queue items pending this same sitting.

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
RF014-026 are all `DONE` per `E2E_TRACEABILITY_PLAN.md`'s own status
table, but each left open follow-up/gap issues filed while building
them -- those count as rabbit-hole queue members (direct descendants of
the tracker, per the skill's scope rule). **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, stays blocked on
RF027/Wave 4, which still has no issue filed anywhere -- confirmed not
started).

**Queue members remaining (15 open issues, plus #674 blocked):**

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | mechanical, build-loop shape |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | mechanical, build-loop shape |
| #650 | RF015 | notification engine only wired to 1 of 5 domains | larger, may need divide-and-conquer |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent | borderline design call (is de-identified-by-design an explicit policy?) -- read closely before picking |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico (RF's own primary actor) can't create Assay/ReagentLot | mechanical -- matches nonconformances route's own precedent in the same slice |
| #666 | RF025 | AC#3: dict-02 Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #675 | RF029 | test-support probe route: attacker-controlled payload write, audit before deploy | security-flavored, needs Docker |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer |
| #678 | RF029 | no ThresholdProfile entity | needs Docker |
| #679 | RF029 | file vocab mismatch (fileFormat/fileRole) | needs Docker |
| #680 | RF029-adjacent (filed this sitting) | canonical contracts version-requirement policy call | design call, skip |

Recommended next pick: **#665** (mechanical, small, same file area as
#664 so context is warm) or **#648/#649** (RF014, independent,
build-loop shape, no Docker needed for #648; #649 touches the
`sessions` collection, check if native mock suffices before reaching
for Docker).

**Budget (rabbit-hole Step 5):** ~10-point sitting budget. #657=1pt,
#676=~1-2pt, #656=1pt, #664=~3pt (build-loop, Docker, multi-file,
touched a shared route factory). Running total: **~7/10**. Getting
close to the sitting's own stop-and-report checkpoint -- one, maybe two
more small/medium items before surfacing per Step 5, unless the next
pick is small enough to finish cheaply first.

## What landed this sitting (so far)

- **#657** -- MongoStorageRepository path:'N/A' fix, merge `759fa9b0`.
- **#676** -- activeCodeValidator unversioned-lookup ambiguity fix,
  merge commit `ad05ec81`. Split off **#680** (left open).
- **#656** -- removed dead `StorageService.allocateSampleToPosition`/
  `validatePositionAvailability`/`_isPositionOccupied`. Fix commit
  `c24a90eb`.
- **#664** -- RF025 AC#1: Assay's specimenIds/protocolId/operatorId/
  laboratoryId/reagentLotIds/equipmentIds now referential-integrity
  checked against their real collections (samples/protocols/users/
  organizations/reagentLots/equipment) before create. New optional
  `validateReferences` hook on the shared `createMasterDataRouter`
  (opt-in per entity, only `/api/assays` uses it so far) +
  `assayReferenceValidator.js`. Fix commit `4eb2cc8e`. Fixed 3 existing
  e2e tests that used placeholder IDs predating this check. Verified on
  the real Docker backend: 9 new unit tests, 2 new e2e negative tests,
  59/59 native, 43/43 in `specimen-quality-inventory.spec.ts`
  (RF016/017/025/026 all still green -- no regression from the shared
  router's error-handling change).

All four merged into `feature/docker-e2e-backend-integration`, all four
issues closed with merge-commit-bearing comments.

## Friction this sitting (wrap-up audit)

- **#676's slip** (documented in an earlier rotation): skipped invoking
  the routed skill before starting, hit the retroactive-routing gate.
  Matches dyeallpies-skills-pack#211's already-fixed, already-documented
  shape -- no new issue.
- **#656's variant** (documented in an earlier rotation): the routing
  gate's per-issue scope reset after reading `gh issue view` on two
  *other* issues (#480/#484) for precedent-checking -- had to re-invoke
  the routed skill naming the current issue right before editing. This
  is the gate working exactly as #355 documented -- not a new bug.
- **dyeallpies-skills-pack#358** (filed earlier this sitting, still
  open): identical `npx vitest run tests/unit/ingestion` blocked on a
  second run with no directory-content change -- distinct from the
  known #259 pattern.
- **dyeallpies-skills-pack#359** (filed this rotation, new): mid-#664,
  a `session-cleanup-checkpoint.cjs` Stop hook fired while a Docker
  bring-up was still running in the background, triggered by a turn
  that ended with a *blocked* `Agent` tool call (an unnecessary
  placeholder call, my own mistake) rather than the expected
  `ScheduleWakeup`/`Read`/etc. Same root-cause class as #250/#293/#295/
  #308/#315 (a Stop event firing mid-legitimate-background-wait), but
  `Agent` specifically isn't in `isInertFollowUp`'s allow-list the way
  #315 added `ToolSearch`. Handled correctly in-session: invoked
  `clean-up`, explicitly declined to tear down the in-progress stack,
  explained why, only deleted a genuinely-stale scratch file. No repo
  damage, just the filed process finding.

## Repo state

- On `feature/docker-e2e-backend-integration`, 20 commits ahead of
  `origin/feature/docker-e2e-backend-integration` -- not yet pushed;
  pushing is a `ship-integration-branch`-gate decision. Working tree
  clean except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **Docker: the full test stack is UP and healthy right now**
  (`bioavanced-test-*` containers, brought up fresh this sitting since
  it had been fully torn down since last time -- `backend-app-test`/
  `frontend-app-test` rebuilt from current source, `admin-bootstrap-test`
  ran successfully, `playwright-runner`'s auto-start was stopped before
  the manual host-side Playwright runs). **Do not tear this down** if
  picking up #675/#677/#678/#679 next (all RF029-adjacent, all likely
  need the real backend) -- reuse the running stack, rebuilding
  `backend-app-test`/`frontend-app-test` first if backend/frontend
  source changed since this stack's last bring-up (build-not-mount
  gotcha, `docker-workflow`'s BioAvanceD-v2 overlay).
- Fix branches from this sitting (`fix/657-...`, `fix/676-...`,
  `fix/656-...`, `test/664-...`) were all merged and deleted locally;
  none were ever pushed remotely.

## Recommended next steps

Still inside the rabbit hole, approaching this sitting's own budget
checkpoint (~7/10). Next: pop **#665** or **#648/#649** (mechanical,
independent of the design-call items). Invoke the routed skill for the
*current* issue right before editing, every time. The Docker stack is
up -- reuse it for any RF029-adjacent pick rather than tearing down and
rebuilding. Rotate this file again per Step 4 after each close; stop at
the budget checkpoint or when Dennis says stop. #674 stays out of reach
until RF027 exists; #660/#663/#666/#667/#680 stay parked as explicit
design calls for Dennis/Denise, not to be resolved unilaterally.
