# HANDOFF

**Written:** 2026-08-21, after closing #678 and filing #677's 5-slice
breakdown (per `rabbit-hole`'s Step 4 -- every item gets its own
rotation). Continuing the Wave 3 rabbit hole (tracker **#646**) under
Dennis's "Docker is on, continue rabbit hole" instruction -- same
sitting as the #661 rotation (`a50a802e`), this rotation supersedes it
after landing two more items.

## Rabbit-hole state: STILL INSIDE, not exited -- ~6-9/10 spent this sitting

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
RF014-026 all `DONE` per `E2E_TRACEABILITY_PLAN.md`, but open follow-up/
gap issues filed while building them count as rabbit-hole queue members.
**RF029 has its own sub-tracker, #668** (5/6 slices done; #674, slice
6/6, still blocked on RF027/Wave 4, not started). **RF005's clinical-data
domain now has its own sub-tracker, #677** (5 slices filed this sitting,
none started).

## What landed this sitting

- **#661 CLOSED** -- see prior rotation's own entry (superseded here,
  not repeated). Filed #687 (Denise sign-off) and
  dyeallpies-skills-pack#367 (docs-first schema-shape lesson).
- **#678 CLOSED -- RF029-adjacent ThresholdProfile/temperaturePolicies
  dict-02 alignment**, merge on `feature/docker-e2e-backend-integration`
  (branch `fix/678-threshold-profile-alignment`, deleted after merge).
  - **Direction confirmed with Dennis first**: dict-02 categorizes
    `ThresholdProfile` under the same "Telemetria" domain as
    `temperaturePolicies` (RF009's existing stand-in), same conceptual
    role -- align, don't introduce a separate entity or declare
    divergence.
  - **Built:** added `metricType`/`ruleVersion`/`effectivePeriod`/
    `minimumDuration` to `TemperaturePolicy.schema.js` (no rename of the
    collection or its existing fields -- `minTemp`/`maxTemp`/`name`
    already satisfy `lowerLimit`/`upperLimit`/`profileName`
    semantically, documented in a comment). Updated
    `canonical.v1.telemetry`'s stale `thresholdProfileId` comment (the
    entity now genuinely exists; field stays optional per the same
    "optional, joinable" precedent `equipmentId` already uses).
  - **Verified two ways**: 18 new native unit tests
    (`schema-models.gaps.test.js`, 47/47 across affected files) *and*
    real-backend proof -- brought the Docker test stack up, updated
    `seedSensorWithPolicy`/`seedSensorWithFreezerSample` (raw-driver
    inserts, no Mongoose defaults apply) to seed the new fields, ran
    both e2e specs using those fixtures against real Mongo/Neo4j:
    `interop-monitoring.spec.ts` 26/26, `pipeline-continuity.spec.ts`
    46/46.
  - **Filed #688**: wiring `minimumDuration` into
    `TelemetryMonitor.findCriticalFreezers()`'s excursion detection
    (currently a single global `TELEMETRY_CRITICAL_DURATION_HOURS`
    threshold) is a distinct, riskier behavioral change than this
    slice's additive schema alignment -- deliberately left for a
    dedicated follow-up.
- **#677 -- RF005 clinical-data domain broken into 5 tracked slices**,
  per `divide-and-conquer`'s "design change" playbook, breakdown
  confirmed with Dennis before filing (grounded in dict-02's actual
  field/reference data, not guessed groupings -- all 10 entities'
  cross-references to each other are optional/joinable, no hard
  schema-level blockers, so the `Depends on:` lines below are about
  landing order for a clean reference story, not strict build gates):
  - **#689** slice 1/5: Encounter (foundational, no deps)
  - **#690** slice 2/5: Condition + PhenotypeObservation (AC4-6's core
    terminology-coded diagnostic path -- HPO/ORPHA/CID/MONDO/OMIM)
  - **#691** slice 3/5: ClinicalObservation + ClinicalOutcome +
    DerivedScore
  - **#692** slice 4/5: AllergyIntolerance + FamilyHistory +
    MedicationExposure + Procedure
  - **#693** slice 5/5: wire intake-wizard into the new entities + real-
    backend e2e proof + `E2E_TRACEABILITY_PLAN.md` RF005 row fix
  - #677 stays open as the tracking issue. **None of the 5 slices
    started this sitting** -- Dennis confirmed "file the split, don't
    start Slice 1 yet" given the sitting's size already.
- **Filed dyeallpies-skills-pack#368**: a BuildKit "parent snapshot ...
  does not exist" cache-corruption error during the Docker bring-up
  (unrelated to this session's code) -- fixed by `docker builder prune
  -af` + retry, one data point, suggested as a new gotcha entry.
- **Filed dyeallpies-skills-pack#369**: the "branch before first Edit"
  rule got skipped twice in this one sitting (once for #661, once for
  #678) -- both self-caught before committing, `git checkout -b` carried
  uncommitted edits forward cleanly both times, zero lasting harm, but
  recurring twice despite reading the warning both times suggests the
  prose isn't prominent enough. Suggested moving it to an explicit
  first-step callout rather than a bulleted-list item.

## Queue members remaining (18 open issues across #646/#677/#668, plus #674/#687 pending sign-off)

| # | RF | One-line | Note |
|---|---|---|---|
| #649 | RF014 | AC#8: policy changes don't revoke sessions | needs Denise's product call -- not a quick fix, don't pick without her input |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico can't create Assay/ReagentLot | **re-triaged: genuine RBAC/access-control policy call -- skip unless Dennis weighs in** |
| #666 | RF025 | AC#3: dict-08's Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #680 | RF029-adjacent | canonical contracts version-requirement policy call | design call, skip |
| #681 | RF029-adjacent | canonical.v1.file comment stale + no real caller populates it | marker for a future slice, skip unless picking it up directly |
| #682 | RF029-adjacent | pre-deployment checklist: NODE_ENV/ENABLE_TEST_SUPPORT_ROUTES verification | marker, not actionable until a real deployment exists |
| #683 | RF003 (RF015-adjacent) | mfaLocked flag never enforced | security-sensitive, **outside this rabbit hole's scope** (RF003, not a #646 descendant) -- dedicated `resolve-issue` look, not a rabbit-hole pick |
| #684 | RF010/RF021-adjacent | consent revocation endpoint has no role/ownership gate | security-sensitive, not sized/triaged -- needs a product call first. **Same outside-scope note as #683** |
| #687 | RF014-adjacent (not a #646 descendant) | Denise sign-off on #661's two policy calls | **not a rabbit-hole pick** -- sign-off request, close once Denise responds |
| #688 | RF029-adjacent (not a #646 descendant) | wire minimumDuration into TelemetryMonitor | real follow-up from #678, not itself a #646 descendant -- ordinary `resolve-issue` pick if taken up |
| #689 | RF005 (#677 slice 1/5) | Encounter entity | **smallest genuine next candidate, no deps** |
| #690 | RF005 (#677 slice 2/5) | Condition + PhenotypeObservation | depends on #689 landing first for clean encounterId reference (not a hard blocker) |
| #691 | RF005 (#677 slice 3/5) | ClinicalObservation + ClinicalOutcome + DerivedScore | same soft dependency on #689 |
| #692 | RF005 (#677 slice 4/5) | AllergyIntolerance + FamilyHistory + MedicationExposure + Procedure | soft dependency on #690 (MedicationExposure.indication -> Condition) |
| #693 | RF005 (#677 slice 5/5) | wire intake-wizard + e2e proof + traceability-doc fix | depends on #689-#692 all landing first |

**Real unstarted candidates for the next pick (genuine #646 descendants):
#689** is the smallest and cleanest (no deps, 6 fields, foundational).
**#690-#693 in order after it.** Everything else stays parked for
Dennis/Denise's input or isn't actionable yet. **#683/#684 are real and
security-sensitive but are NOT rabbit-hole queue members.** **#687/#688
are sign-off/follow-up items, not rabbit-hole picks either.**

## Budget (rabbit-hole Step 5)

**~6-9/10 spent this sitting** -- #661 medium (~2-3pt), #678 medium-
large (~3-4pt, real Docker/e2e verification included), #677's split-
filing small (~1pt, no implementation landed). Getting close to the
~10pt ceiling -- next natural checkpoint to ask Dennis whether to
continue (picking up #689) or stop here.

## Friction this sitting (wrap-up audit)

- **Docs-first check needed a second, deeper pass for #661** -- see
  prior rotation's entry (dyeallpies-skills-pack#367), not repeated here.
- **Branch-before-edit slip recurred twice** (#661 and #678, both
  self-caught, zero lasting harm) -- filed dyeallpies-skills-pack#369.
- **BuildKit cache corruption during Docker bring-up** (`parent
  snapshot ... does not exist`) -- unrelated to this session's code,
  fixed by `docker builder prune -af` + retry. Filed
  dyeallpies-skills-pack#368.
- **No other friction**: both #678's merge scope (4 files, matching the
  plan exactly) and #677's filing (5 issues + 1 tracking comment, no
  code touched) stayed within their intended scope, confirmed via
  `git diff --stat` on each merge.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's two
  merge commits). Working tree clean except the pre-existing untracked
  `.claude/skills/` and `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention.
- **Docker: DOWN.** Brought up this sitting (12 core services +
  `admin-bootstrap-test`, all healthy/exited-0 as expected) to verify
  #678 against real Mongo/Neo4j, then torn down at Dennis's explicit
  request once the sitting's checkpoint question was answered
  (`docker compose --env-file .env.test.example -f compose.test.yml
  down`, no `-v` -- confirmed clean via `docker ps -a`, zero
  `bioavanced-test-*` containers left). Named volumes preserved, so the
  next bring-up starts from this sitting's already-aligned
  `temperaturePolicies` schema. `playwright-runner`/full-suite container
  was never started this sitting (not included in the service list
  used), so no teardown concern there.

## Recommended next steps

**Dennis chose to stop this sitting rather than continue into #689** --
this is a clean checkpoint, not a forced stop (budget was close to the
~10pt ceiling but not over it). Next sitting: **#689** (Encounter,
smallest genuine #646/#677 descendant, no deps) is the natural pick,
then #690-#693 in order. Everything else in the queue table stays parked
as an explicit design/policy call, a marker, or outside this rabbit
hole's own scope (#683/#684) -- don't resolve any of those unilaterally.
Invoke the routed skill (`work-issue` -> classified loop) for whichever
issue is picked next, right before editing -- and **create the per-issue
branch as the literal first action**, before any Read/Edit call, given
this sitting's own recurring slip on that exact point (dyeallpies-
skills-pack#369). Bring Docker back up per `docker-workflow`'s
bioavanced-v2 overlay recipe when next needed -- #690-#693 will likely
need it for real-backend proof, same as #678 did.
