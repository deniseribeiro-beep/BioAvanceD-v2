# HANDOFF

**Written:** 2026-08-20, after landing #650's governança-domain slice
(per `rabbit-hole`'s Step 4 -- every item gets its own rotation).
Continuing the Wave 3 rabbit hole (tracker **#646**) under Dennis's
"continue rabbit hole" instruction. **This is a fresh sitting** (new
conversation after the prior sitting's own budget checkpoint at
~8-9/10) -- budget below is reset for this sitting, not a continuation
of the prior one's count.

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting (so far)

- **#650 (3/4 domains)** -- RF015's notification engine now wired to
  segurança, consentimento (both landed in the prior sitting) and, this
  sitting, **governança**:
  - **3/4 governança** -- `dispositionAction.service.js`'s real
    `recordDisposition` (RF026's own "Retenção e destinação" trigger --
    picked over the cron-only `retentionSweep.service.js` sweep, which
    has no HTTP trigger and so isn't provable real-backend without
    building a new test-support route first) now fires
    `dispatchNotification` with a new `disposition_action_recorded`
    eventType. Merge `dbf9ed5b`.
  - Unlike the segurança/consentimento call sites (fire only on a rare
    branch), this one fires on *every* successful `recordDisposition` --
    so it carries an explicit `.catch()` (matching `iot.controller.js`'s
    `environmental_excursion` precedent), not the bare `void` the other
    two use. Without it, the existing fake-db unit tests in
    `dispositionAction.service.test.js` (no `notificationRules`
    collection mocked) surfaced as unhandled rejections and failed the
    run -- this is *why* the `.catch()` was added, not a stylistic
    choice.
  - Proven with 2 new unit cases (dispatches on a successful record;
    does NOT dispatch when a destroy is blocked by an active legal
    hold) and a new real-backend Docker e2e test appended to
    `interop-monitoring.spec.ts`'s "Alertas e notificações (RF015)"
    describe block. All 5 tests in that describe block pass together
    (no regressions to environmental_excursion/segurança/consentimento).
  - **#650 stays OPEN** -- per this repo's multi-item-requirement
    convention (#549/#551 precedent), **qualidade** remains for a
    future iteration under the same issue number. Progress comment
    posted.
  - **#685** (product, filed during this slice, NOT a rabbit-hole queue
    member -- same "incidental finding while reading touched code"
    treatment as #683/#684 from the prior sitting) -- `auth.service.js`'s
    `mfa_brute_force_lockout` and `consent.service.js`'s
    `consent_revoked` `dispatchNotification` calls (#650 1/4 and 2/4,
    prior sitting) lack the `.catch()` this slice added to the
    governança call site. This repo has no global `unhandledRejection`
    handler, so Node's default (`--unhandled-rejections=throw`) means a
    transient notification-engine failure during an MFA lockout or
    consent revocation would crash the whole backend process. Small,
    mechanical fix suggested in the issue.

## Queue members remaining (17 open issues, plus #674 blocked)

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | sized in a prior sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
| #650 | RF015 | notification engine: 1/4 remaining domain (qualidade) | next pick if continuing -- same "pick a concrete trigger point, one dispatchNotification call, one NotificationRule, real-backend proof" pattern as this sitting's slice. Candidates scoped but not picked: cold-chain/equipment quarantine (`equipment-sensor-quarantine.service.js`, needs full freezer/box/sensor topology fixture -- no existing e2e reuses that shape) or intake-wizard RCS-grade-E auto-quarantine (`intakeWizard.routes.js`'s `enforcePersistedGovernanceStatus`, needs a real intake payload that scores grade E -- no existing e2e posts to `/api/intake-wizard` directly either). Both are bigger lifts than the prior 3 domains; size accordingly before picking. |
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
| #685 | RF015-adjacent (filed this sitting) | auth.service.js/consent.service.js dispatchNotification calls lack .catch(), can crash the process | small, mechanical -- good quick-win candidate |

**Real unstarted candidates for the next pick: #650 (4th domain,
qualidade -- bigger lift than the prior 3, see note above), #661,
#677, #678, #683, #684, #685** (plus #648+#649 as their own
iteration) -- everything else stays parked for Dennis/Denise's input
or isn't actionable yet.

## Budget (rabbit-hole Step 5, this sitting)

**~2-3/10.** #650's governança slice (~2-3pt, medium: one trigger
point, one product-code call site, one unit-test-file extension, one
real-backend e2e test added, plus a small unrelated reliability fix
discovered and filed as its own issue rather than folded in). Well
under the ~10pt checkpoint -- room to continue this sitting.

## Friction this sitting (wrap-up audit)

One real finding, filed as **#685** (see above) rather than folded
into this slice's own fix -- the two prior sitting's RF015 call sites
(segurança/consentimento) turned out to share the same missing-`.catch()`
gap this slice's own governança call site would have had, if not for
noticing the existing unit tests fail without it. No other friction:
scope stayed inside build-loop's stated bounds (product code + its own
unit/e2e test only), no stale instructions, no retries.

## Repo state

- On `feature/docker-e2e-backend-integration`, ahead of
  `origin/feature/docker-e2e-backend-integration` by 37 commits -- not
  yet pushed; pushing is a `ship-integration-branch`-gate decision.
  Working tree clean except the pre-existing untracked
  `.claude/skills/` and `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists.
- **`.env.docker` (local, gitignored) has `ENABLE_TEST_SUPPORT_ROUTES=true`**
  -- needed under #675's registration gate.
- **Docker: up**, left running deliberately (Dennis's explicit choice
  this sitting, since more #650 work was expected). `compose.test.yml`
  test stack, `backend-app-test` rebuilt once this sitting (`--build`,
  explicit `cd` to repo root inline in the same command). `docker
  inspect --format='{{.Created}}'` confirmed fresh before the e2e run.
  `playwright-runner` not running. Reuse for the next pick, but
  **rebuild `backend-app-test`/`frontend-app-test` with `--build`
  again if the next iteration touches backend/frontend source.**
- This sitting's branch (`test/650-disposition-action-notification`)
  merged and deleted locally, never pushed remotely.

## Recommended next steps

Budget is low (~2-3/10) -- plenty of room to continue this sitting if
Dennis says so. **#650's 4th domain (qualidade)** would close the
issue outright, but note above: both scoped candidates
(cold-chain/equipment quarantine, intake-wizard RCS grade-E
auto-quarantine) need real fixture work no existing e2e spec already
covers, unlike the prior 3 domains which each reused an existing
fixture/endpoint -- size this one as a slightly bigger iteration, not
an automatic "smallest next item" pick. **#685** (this sitting's own
finding) is a genuinely small, low-risk pick if a quick win is wanted
instead. Invoke the routed skill (`work-issue` -> classified loop) for
the *current* issue right before editing, every time. Rotate this file
again after the next item lands/closes, per Step 4. #674 stays out of
reach until RF027 exists; #660/#662/#663/#665/#666/#667/#680/#681/#682
all stay parked as explicit design/policy calls or low-priority
markers -- don't resolve any of them unilaterally. #683/#684 are both
security-sensitive and outside this rabbit hole's own scope (RF003/RF010,
not #646 descendants) -- worth a dedicated look, still not picked up.
