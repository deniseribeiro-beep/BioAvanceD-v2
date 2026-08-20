# HANDOFF

**Written:** 2026-08-20, after closing #685 (per `rabbit-hole`'s Step 4
-- every item gets its own rotation, even a non-queue-member fix worked
in the same sitting). Continuing the Wave 3 rabbit hole (tracker
**#646**) under Dennis's "continue rabbit hole"/"keep going"
instructions. **This is still the same fresh sitting** the prior
rotation started (budget reset from the previous sitting's own
checkpoint at ~8-9/10).

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting (so far)

- **#650 (3/4 domains)** -- RF015's notification engine now wired to
  segurança, consentimento (prior sitting) and **governança** (this
  sitting): `dispositionAction.service.js`'s real `recordDisposition`
  now fires `dispatchNotification` (`disposition_action_recorded`
  eventType) with an explicit `.catch()` (picked over the cron-only
  `retentionSweep.service.js` sweep, which has no HTTP trigger). Merge
  `dbf9ed5b`. Proven with 2 unit cases + a real-backend Docker e2e test;
  5/5 in the RF015 describe block pass. **#650 stays OPEN** -- qualidade
  is the last of the 4 domains. Progress comment posted.
- **#685 (closed this sitting, NOT a rabbit-hole queue member** -- an
  incidental finding from the governança slice, same treatment as
  #683/#684) -- `auth.service.js`'s `mfa_brute_force_lockout` and
  `consent.service.js`'s `consent_revoked` `dispatchNotification` calls
  were missing the `.catch()` the governança call site needed. This
  repo has no global `unhandledRejection` handler, so a transient
  notification-engine failure during an MFA lockout or consent
  revocation would have crashed the whole backend process. Fixed both
  call sites (same `.catch()` + logger.error shape as the other two),
  proven with a reproduction test per file. Fix commit `ca7d3ed5`, merge
  `d10d81cc`. 172/172 across the touched suites on the merged tree.
  Closed with the merge hash.
  - **Friction from this fix, filed as its own pack issue** --
    `dyeallpies-skills-pack#363`: the first version of the
    `auth.service.js` reproduction test passed against the *unfixed*
    code (a false-negative reproduction), because `processLogin`
    already has an unrelated outer `catch` that calls `logger.error` on
    every rejection -- a bare `toHaveBeenCalled()` spy assertion
    couldn't tell the fix's own log call apart from that pre-existing
    one. Fixed by asserting the specific `[NOTIFICATION_DISPATCH]`-
    prefixed message instead. Filed as a generic `vitest-specs` craft
    lesson (can't edit that skill file directly from this session -- it's
    junctioned from the pack repo, Rule 0).

## Queue members remaining (16 open issues, plus #674 blocked)

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | sized in a prior sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
| #650 | RF015 | notification engine: 1/4 remaining domain (qualidade) | next pick if continuing -- same "pick a concrete trigger point, one dispatchNotification call, one NotificationRule, real-backend proof" pattern as the prior 3 domains. Candidates scoped but not picked: cold-chain/equipment quarantine (`equipment-sensor-quarantine.service.js`, needs full freezer/box/sensor topology fixture -- no existing e2e reuses that shape) or intake-wizard RCS-grade-E auto-quarantine (`intakeWizard.routes.js`'s `enforcePersistedGovernanceStatus`, needs a real intake payload that scores grade E -- no existing e2e posts to `/api/intake-wizard` directly either). Both are bigger lifts than the prior 3 domains; size accordingly before picking. |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent | borderline design call (is de-identified-by-design an explicit policy?) -- read closely before picking |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico can't create Assay/ReagentLot | **re-triaged in a prior sitting: genuine RBAC/access-control policy call -- skip unless Dennis weighs in** |
| #666 | RF025 | AC#3: dict-08's Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer |
| #678 | RF029 | no ThresholdProfile entity | needs Docker, but itself unsized/presents 3 design options -- read closely, may need a scope decision before code |
| #680 | RF029-adjacent | canonical contracts version-requirement policy call | design call, skip |
| #681 | RF029-adjacent | canonical.v1.file comment stale + no real caller populates it | marker for a future slice, skip unless picking it up directly |
| #682 | RF029-adjacent | pre-deployment checklist: NODE_ENV/ENABLE_TEST_SUPPORT_ROUTES verification | marker, not actionable until a real deployment exists |
| #683 | RF003 (RF015-adjacent) | mfaLocked flag never enforced -- lockout doesn't actually block logins | security-sensitive, not sized/triaged |
| #684 | RF010/RF021-adjacent | consent revocation endpoint has no role/ownership gate | security-sensitive, not sized/triaged -- needs a product call on intended revocation UX before fixing |

**Real unstarted candidates for the next pick: #650 (4th domain,
qualidade -- bigger lift than the prior 3, see note above), #661,
#677, #678, #683, #684** (plus #648+#649 as their own iteration) --
everything else stays parked for Dennis/Denise's input or isn't
actionable yet.

## Budget (rabbit-hole Step 5, this sitting)

**~3-4/10.** #650's governança slice (~2-3pt) + #685's fix (~1pt, small
mechanical, two call sites). Well under the ~10pt checkpoint -- room to
continue this sitting.

## Friction this sitting (wrap-up audit)

Two real findings, both filed rather than folded silently into their
fixes:
- **#685** itself (see above) -- the governança slice's own `.catch()`
  addition surfaced that the two prior sitting's RF015 call sites shared
  the same gap.
- **dyeallpies-skills-pack#363** (see above) -- a false-negative
  reproduction-test trap specific to spying on a shared/generic logger,
  hit while writing #685's own reproduction test.

No other friction: scope stayed inside each loop's stated bounds
(product code + its own unit/e2e test only), no stale instructions, no
retries beyond the one test-assertion correction already covered above.

## Repo state

- On `feature/docker-e2e-backend-integration`, ahead of
  `origin/feature/docker-e2e-backend-integration` by 40 commits -- not
  yet pushed; pushing is a `ship-integration-branch`-gate decision.
  Working tree clean except the pre-existing untracked
  `.claude/skills/` and `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists.
- **`.env.docker` (local, gitignored) has `ENABLE_TEST_SUPPORT_ROUTES=true`**
  -- needed under #675's registration gate.
- **Docker: down.** `compose.test.yml` test stack was up for most of
  this sitting (rebuilt once, for the governança slice's real-backend
  proof) and torn down at Dennis's explicit request at the end of the
  sitting (`docker compose --env-file .env.docker -f compose.test.yml
  down`, no `-v` -- named volumes/`mongodb-test-data` untouched, confirmed
  no `bioavanced-test-*` containers remain). The next iteration that
  needs real-backend e2e proof brings the stack back up fresh via the
  recipe in this skill pack's `docker-workflow` overlay
  (`docker compose --env-file .env.test.example -f compose.test.yml up -d
  --wait <services>` + the separate `admin-bootstrap-test` step).
- This sitting's branches (`test/650-disposition-action-notification`,
  `fix/685-notification-dispatch-catch`) both merged and deleted
  locally, never pushed remotely.

## Recommended next steps

Budget is low (~3-4/10) -- plenty of room to continue this sitting if
Dennis says so. **#650's 4th domain (qualidade)** would close the issue
outright, but note above: both scoped candidates (cold-chain/equipment
quarantine, intake-wizard RCS grade-E auto-quarantine) need real
fixture work no existing e2e spec already covers, unlike the prior 3
domains which each reused an existing fixture/endpoint -- size this one
as a slightly bigger iteration, not an automatic "smallest next item"
pick. Invoke the routed skill (`work-issue` -> classified loop) for the
*current* issue right before editing, every time. Rotate this file
again after the next item lands/closes, per Step 4. #674 stays out of
reach until RF027 exists; #660/#662/#663/#665/#666/#667/#680/#681/#682
all stay parked as explicit design/policy calls or low-priority
markers -- don't resolve any of them unilaterally. #683/#684 are both
security-sensitive and outside this rabbit hole's own scope
(RF003/RF010, not #646 descendants) -- worth a dedicated look, still
not picked up.
