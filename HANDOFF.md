# HANDOFF

**Written:** 2026-08-20, mid-sitting rotation after landing #650's
consentimento-domain slice (per `rabbit-hole`'s Step 4 -- every item
gets its own rotation). Continuing the Wave 3 rabbit hole (tracker
**#646**) under Dennis's "continue rabbit hole, Docker is on"
instruction, same fresh sitting as the prior rotations. **Budget is now
at the ~10-point checkpoint -- see "Recommended next steps" below before
popping another item.**

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting (so far)

- **#679** -- RF007: real `fileRole`/`fileFormat`. Merge `7b492833`.
  Follow-up: #681.
- **#675** -- test-support route registration hardened. Merge
  `6524d203`. Follow-up: #682.
- **#650 (2/4 domains)** -- RF015's notification engine wired to 2 more
  of the 5 total RF015 domains this sitting:
  - **1/4 segurança** -- real MFA brute-force lockout
    (`auth.service.js#processLogin`) fires a new `mfa_brute_force_lockout`
    eventType. Merge `1351043e`.
  - **2/4 consentimento** -- real consent revocation
    (`consent.service.js#revokeConsent`) fires a new `consent_revoked`
    eventType. Merge `4a3d3ed9`.
  - Both fire-and-forget, same shape as the pre-existing
    `environmental_excursion` call site; both proven with a new unit
    test (spied `dispatchNotification`, asserts call args + a
    does-NOT-dispatch negative case) and a new real-backend Docker e2e
    test appended to `interop-monitoring.spec.ts`'s "Alertas e
    notificações (RF015)" describe block. All 4 tests in that describe
    block pass together (no regressions across either slice).
  - **#650 stays OPEN** -- per this repo's multi-item-requirement
    convention (#549/#551 precedent), **qualidade** and **governança**
    remain for a future iteration under the same issue number. Progress
    comments posted for both landed pieces.
  - Two issues filed as this sitting's own incidental findings (NOT
    rabbit-hole queue members -- discovered while reading the touched
    code, not `divide-and-conquer` splits of #650's own scope):
    - **#683** (product, filed during the segurança slice) --
      `mfaLocked` is set on lockout but never checked anywhere in the
      login path; the lockout is currently cosmetic.
    - **#684** (product, filed during the consentimento slice) --
      `POST /api/e-consent/consents/:id/revoke` has `authenticate` but
      no `requireRole`/ownership check -- any authenticated user
      (including the lowest-privilege role) can revoke any patient's
      consent by ID. Security-relevant, not sized/triaged (depends on
      RF010/RF021's intended revocation UX -- admin-gated vs.
      self-service-with-ownership-check).
    - **`dyeallpies-skills-pack#362`** (process, filed during the
      segurança slice) -- Bash's persisted cwd broke a `docker compose
      --env-file` relative path silently; verbatim fix included. Not
      repeated on the consentimento slice's rebuild (explicit `cd
      "<repo-root>" &&` inline this time).

## Queue members remaining (16 open issues, plus #674 blocked)

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | sized in a prior sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
| #650 | RF015 | notification engine: 2/4 remaining domains wired (segurança, consentimento done) | next pick: qualidade or governança -- same "pick a concrete trigger point, one dispatchNotification call, one NotificationRule, real-backend proof" pattern as this sitting's two slices |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent | borderline design call (is de-identified-by-design an explicit policy?) -- read closely before picking |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico can't create Assay/ReagentLot | **re-triaged in a prior sitting: genuine RBAC/access-control policy call -- skip unless Dennis weighs in** |
| #666 | RF025 | AC#3: dict-02's Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer |
| #678 | RF029 | no ThresholdProfile entity | needs Docker, but itself unsized/presents 3 design options -- read closely, may need a scope decision before code |
| #680 | RF029-adjacent | canonical contracts version-requirement policy call | design call, skip |
| #681 | RF029-adjacent | canonical.v1.file comment stale + no real caller populates it | marker for a future slice, skip unless picking it up directly |
| #682 | RF029-adjacent | pre-deployment checklist: NODE_ENV/ENABLE_TEST_SUPPORT_ROUTES verification | marker, not actionable until a real deployment exists |
| #683 | RF003 (RF015-adjacent) | mfaLocked flag never enforced -- lockout doesn't actually block logins | security-sensitive, not sized/triaged |
| #684 | RF010/RF021-adjacent (filed this sitting) | consent revocation endpoint has no role/ownership gate | security-sensitive, not sized/triaged -- needs a product call on intended revocation UX before fixing |

**Real unstarted candidates for the next pick: #650 (3rd domain), #661,
#677, #678, #683, #684** (plus #648+#649 as their own iteration) --
everything else stays parked for Dennis/Denise's input or isn't
actionable yet. #683/#684 are both security-sensitive and unsized --
read closely (and consider whether either belongs in the same
"own iteration" bucket as #648/#649) before picking either up as a
"quick win."

## Budget (rabbit-hole Step 5, fresh sitting)

**~8-9/10 -- at the checkpoint.** #679 (~2-3pt) + #675 (~2pt) + #650's
two domain slices (~2pt each, medium: one trigger point, one
product-code call site, one unit test file extended, one real-backend
e2e test added, no data-model change). Per Step 5: **the next pop would
push past budget -- this rotation is the surface-and-let-the-user-decide
point**, not a "pick one more and go." Don't start another item without
checking in first, unless the next item is genuinely small enough that
finishing it closes something outright (Step 5's own escape hatch).

## Friction this sitting (wrap-up audit, both slices' own findings already folded into "What landed" above)

No new process friction on the consentimento slice specifically -- the
segurança slice's cwd/docker-compose mistake (`dyeallpies-skills-pack#362`)
did not recur, because the fix (explicit `cd "<repo-root>" &&` inline in
the same command, not relying on a prior call's cwd) was applied from
the start of this slice's rebuild.

## Repo state

- On `feature/docker-e2e-backend-integration`, ahead of
  `origin/feature/docker-e2e-backend-integration` by 33 commits -- not
  yet pushed; pushing is a `ship-integration-branch`-gate decision.
  Working tree clean except the pre-existing untracked
  `.claude/skills/` and `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists.
- **`.env.docker` (local, gitignored) has `ENABLE_TEST_SUPPORT_ROUTES=true`**
  -- added in an earlier rotation this sitting, still needed under
  #675's registration gate.
- **Docker: up.** `compose.test.yml` test stack, `backend-app-test`
  rebuilt twice this sitting (once per #650 domain slice), confirmed
  fresh via `docker inspect --format='{{.Created}}'` both times.
  `playwright-runner` not running. Reuse for the next pick, but
  **rebuild `backend-app-test`/`frontend-app-test` with `--build`
  again -- always `cd` to the repo root explicitly within the same
  command, per this sitting's own friction finding** -- if the next
  iteration touches backend/frontend source again.
- Both slices' branches (`test/650-mfa-lockout-notification`,
  `test/650-consent-revocation-notification`) merged and deleted
  locally, never pushed remotely.

## Recommended next steps

**Budget checkpoint reached (~8-9/10).** Still inside the rabbit hole --
per Dennis's standing "continue" instruction this sitting has kept
going past the informal ~6-7/10 mark already, but Step 5 says the *next*
pop is the one to check in about, not push through unprompted. If
continuing: **#650's 3rd domain (qualidade or governança)** is the
smallest, most consistent next item (same pattern, ~2pt, would put the
sitting at ~10-11/10) -- or stop here and let Dennis pick. Don't start
**#677** (large, divide-and-conquer territory) or **#648+#649**
(security-sensitive, deserves a fresh budget) cold this late. Invoke the
routed skill (`work-issue` -> classified loop) for the *current* issue
right before editing, every time. Rotate this file again after the next
item lands/closes, per Step 4. #674 stays out of reach until RF027
exists; #660/#662/#663/#665/#666/#667/#680/#681/#682 all stay parked as
explicit design/policy calls or low-priority markers -- don't resolve
any of them unilaterally. #683/#684 are both new, security-sensitive,
and outside this rabbit hole's own scope (RF003/RF010, not #646
descendants) -- worth a dedicated look next sitting.
