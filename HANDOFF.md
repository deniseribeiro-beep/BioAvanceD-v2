# HANDOFF

**Written:** 2026-08-21, after closing #661 (per `rabbit-hole`'s Step 4 --
every item gets its own rotation, including a clean close). Continuing
the Wave 3 rabbit hole (tracker **#646**) under Dennis's "Docker is on,
continue rabbit hole" instruction -- a fresh sitting, budget reset from
the prior rotation's checkpoint (`10e6964d`/`dfbe0aa1`, which stopped at
~10-12/10 after #648).

## Rabbit-hole state: STILL INSIDE, not exited -- fresh sitting, ~2-3/10 spent

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting

- **#661 CLOSED -- RF024 AC#2 dataset/file consent-scope gap fixed**,
  merge on `feature/docker-e2e-backend-integration` (branch
  `fix/661-access-request-file-consent`, deleted after merge).
  - **Docs-first check initially came back empty** (an Explore agent
    swept `docs/`, dict-02/07/08, requisitos-index, GitHub Milestones,
    and the Dataset/SampleFile models/service code for keyword matches
    on "de-identified"/"consent scope" and found nothing conclusive).
    Dennis pushed back on the resulting `AskUserQuestion` ("don't docs
    have an answer... or that we can infer") rather than picking an
    option -- a second, closer pass (reading dict-02's actual `Dataset`
    field rows instead of keyword-searching) found the real answer:
    `Dataset` (ELM-0416-0423) is categorized under "FAIR e publicação"
    -- datasetId/title/version/creators/doi/license/distributionFiles/
    roCrateManifest, a DataCite/RO-Crate-aligned citable-publication
    shape with **no participant-linkage field at all**. That's the
    repo's own data model declaring datasets de-identified/aggregate by
    design, not an oversight.
  - **Built:** `file` items (SampleFile, which already carries
    `specimenId`) now resolve to participant/consent exactly like
    `specimen` items -- no schema change. `dataset` items are now
    explicitly documented as exempt-by-design (code comment citing the
    dict-02 evidence above) instead of an implicit non-blocking null.
  - Proven via 5 new unit tests in `accessRequest.service.test.js`
    (file-compatible, file-incompatible-no-consent, file-unresolvable,
    file-malformed-itemId, dataset-exempt). 44/44 green on the merged
    integration branch (native vitest, no Docker needed for this fix --
    pure service-layer logic over existing collections).
  - **Filed #687**: sign-off request for Denise on both policy calls
    (file-item consent-resolution scope; dataset-exemption reasoning),
    same shape as the prior rotation's #686 -- resting on the dict-02
    evidence, not asking her to re-derive from scratch.
  - **Filed dyeallpies-skills-pack#367**: `resolve-issue`'s docs-first
    check is framed around keyword search, which can miss an answer
    that's only encoded structurally (an entity's field-list/category
    in the dictionary, not a prose statement). Suggests adding
    "inspect the entity's own modeled shape" alongside the existing
    #234 "trace data flow, don't just grep the string" guidance.
  - **Process note (self-caught, no lasting effect):** started editing
    before creating the per-issue branch (violated resolve-issue's
    "branch before first Edit" rule -- easy to slip on mid-triage, per
    the skill's own text). Caught before committing; `git checkout -b`
    carried the uncommitted edits onto a fresh `fix/661-*` branch
    cleanly, so no rework was needed. Not filed as a new lesson since
    the skill already documents this exact risk.
- Also self-corrected: git branch `fix/661-access-request-file-consent`
  created *after* edits started, then the uncommitted changes were
  carried onto it via `git checkout -b` before the commit -- see above.

## Queue members remaining (15 open issues, plus #674 blocked, plus #687 new)

| # | RF | One-line | Note |
|---|---|---|---|
| #649 | RF014 | AC#8: policy changes don't revoke sessions | needs Denise's product call (which changes require revocation) -- not a quick fix, don't pick without her input |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico can't create Assay/ReagentLot | **re-triaged in a prior sitting: genuine RBAC/access-control policy call -- skip unless Dennis weighs in** |
| #666 | RF025 | AC#3: dict-08's Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer -- **Dennis explicitly asked to defer opening this as a new multi-session effort during this sitting's AskUserQuestion round** (his answer addressed the #661 docs-check instead; #677's own question in that round wasn't separately confirmed) -- re-confirm scope with him before starting |
| #678 | RF029 | no ThresholdProfile entity | needs Docker, but itself unsized/presents 3 design options -- read closely, may need a scope decision before code -- **same as #677, not separately confirmed this round** |
| #680 | RF029-adjacent | canonical contracts version-requirement policy call | design call, skip |
| #681 | RF029-adjacent | canonical.v1.file comment stale + no real caller populates it | marker for a future slice, skip unless picking it up directly |
| #682 | RF029-adjacent | pre-deployment checklist: NODE_ENV/ENABLE_TEST_SUPPORT_ROUTES verification | marker, not actionable until a real deployment exists |
| #683 | RF003 (RF015-adjacent) | mfaLocked flag never enforced -- lockout doesn't actually block logins | security-sensitive, not sized/triaged. **Outside this rabbit hole's own scope** (RF003, not a #646 descendant) -- worth a dedicated look via ordinary `resolve-issue`, not a free rabbit-hole pick |
| #684 | RF010/RF021-adjacent | consent revocation endpoint has no role/ownership gate | security-sensitive, not sized/triaged -- needs a product call on intended revocation UX before fixing. **Same outside-scope note as #683** |
| #687 | RF024-adjacent (not a #646 descendant) | sign-off request on #661's two policy calls | **not itself a rabbit-hole pick** -- it's a sign-off request on already-shipped code, same shape as the prior rotation's #686. Close once Denise confirms or corrects |

**Real unstarted candidates for the next pick (genuine #646 descendants):
#677, #678** -- both larger/`divide-and-conquer`-shaped and **not yet
confirmed with Dennis this sitting** (see table notes above) --
re-ask before starting either. Everything else stays parked for
Dennis/Denise's input or isn't actionable yet. **#683/#684 are real and
security-sensitive but are NOT rabbit-hole queue members** -- pick them
up via plain `resolve-issue` in a dedicated look, not as a "next
rabbit-hole item," if picked up at all. **#649 is standalone** (not
paired with #648, which is already closed).

## Budget (rabbit-hole Step 5)

**~2-3/10 spent this sitting** -- #661 sized as **medium** (a real fix
plus a docs-first re-dig, but no Docker/e2e needed, no schema change,
clean test-only proof). Well under the ~10pt ceiling; room to continue
if Dennis confirms #677/#678's scope, or to pick from elsewhere with his
input.

## Friction this sitting (wrap-up audit)

- **Docs-first check needed a second, deeper pass** -- the first sweep
  (Explore agent, keyword-search strategy) concluded the design question
  was unresolvable from docs; Dennis's pushback prompted a second pass
  that found the answer via the entity's own dict-02 field-list/category
  rather than a keyword match. Filed dyeallpies-skills-pack#367 to
  generalize this into `resolve-issue`'s own docs-first guidance.
- **Self-caught branch-discipline slip** -- started editing before
  creating the per-issue branch; caught before committing, no rework
  needed (`git checkout -b` carried the uncommitted edits forward
  cleanly). Not filed as a new lesson -- already covered by
  `resolve-issue`'s own "easy to slip on mid-triage" text.
- **No other friction**: scope stayed exactly to the 2 intended files
  (service + its unit test) -- confirmed via `git diff --stat` on the
  fix commit itself (142 insertions/13 deletions across those 2 files
  only; the much larger diff on the eventual push was 51 previously-
  unpushed commits from prior sessions riding the same push, not scope
  creep this iteration).
- **Security/consent-relevant judgment calls filed for sign-off rather
  than left implicit: #687** (see above), matching the prior rotation's
  #686 precedent.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's merge
  commit plus the 51 commits that were already ahead and unpushed from
  prior sessions -- all now on origin). Working tree clean except the
  pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention -- pushing to the integration branch is not the same as
  merging to `main`.
- **Docker: still DOWN** (unchanged from the prior rotation -- Dennis
  said "Docker is on" meaning available for use this sitting, but #661's
  fix needed no Docker/e2e, only native vitest against a real
  query-matching fake collection). Named volumes preserved
  (`bioavanced-test_*`). Bring the stack up per `docker-workflow`'s
  bioavanced-v2 overlay if the next item needs it (#678 explicitly does;
  #677 likely will for any real slice).

## Recommended next steps

Budget has plenty of room left (~2-3/10) -- continue this sitting.
**Before starting #677 or #678, re-confirm scope with Dennis** -- his
last `AskUserQuestion` round addressed #661's docs-recheck but didn't
land a clear yes/no on opening #677 as a new multi-session
divide-and-conquer effort, or on which of #678's three resolution paths
to take. Everything else in the queue table stays parked as an explicit
design/policy call, a marker, or outside this rabbit hole's own scope
(#683/#684) -- don't resolve any of those unilaterally. Invoke the
routed skill (`work-issue` -> classified loop) for whichever issue is
picked next, right before editing, every time. Rotate this file again
after the next item lands/closes, per Step 4.
