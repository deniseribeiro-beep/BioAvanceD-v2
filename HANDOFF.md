# HANDOFF

**Written:** 2026-08-20, mid-sitting rotation after landing #650's
segurança-domain slice (per `rabbit-hole`'s Step 4 -- every item gets its
own rotation). Continuing the Wave 3 rabbit hole (tracker **#646**) under
Dennis's "continue rabbit hole, Docker is on" instruction, same fresh
sitting as the prior two rotations.

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
- **#675** -- test-support route registration hardened with an explicit
  opt-in. Merge `6524d203`. Follow-up: #682.
- **#650 (1/4, segurança domain)** -- RF015's notification engine now
  also fires on a real MFA brute-force lockout (`auth.service.js`'s
  `processLogin`, `mfaFailedAttempts >= 5`), new `mfa_brute_force_lockout`
  eventType, same fire-and-forget shape as the existing
  `environmental_excursion` call site. Merge `1351043e` on
  `feature/docker-e2e-backend-integration`. Verified: 2 new unit cases
  (50/50 in `auth.service.processLogin.unit.test.js`), plus real-backend
  Docker proof -- a fresh Técnico completes first-login MFA setup,
  submits 5 wrong TOTP codes, a rule-driven `in_app` notification lands
  within SLA; all 3 tests in `interop-monitoring.spec.ts`'s "Alertas e
  notificações (RF015)" describe block pass together (no regression).
  **#650 stays OPEN** -- per this repo's multi-item-requirement
  convention (#549/#551 precedent), the remaining 3 domains
  (consentimento, qualidade, governança) land as further iterations
  under the same issue, not split into new issue numbers. Progress
  comment posted naming what's done/remaining.
  - Two issues filed as this iteration's own findings (not rabbit-hole
    queue members -- discovered incidentally, not `divide-and-conquer`
    splits of #650's own scope):
    - **#683** (product) -- `mfaLocked` is set on lockout but never
      checked anywhere in the login path; the lockout is currently
      cosmetic, a real user can keep submitting MFA codes past 5 failed
      attempts. Not sized/triaged.
    - **`dyeallpies-skills-pack#362`** (process) -- Bash tool's
      persisted cwd (left at `api/backend` from an unrelated earlier
      `npx vitest` call) silently broke a later `docker compose
      --env-file .env.test.example` command's relative-path resolution;
      the failure was easy to miss (redirected log, `docker ps` still
      showed the *stale* container as healthy). Verbatim suggested fix
      included in the issue for a pack-repo session to apply.

## Queue members remaining (16 open issues, plus #674 blocked)

Same table as the prior rotation, #650 now landed 1/4 (stays open, not
removed from the table until all 4 domains close):

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | sized in a prior sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
| #650 | RF015 | notification engine: 1/4 remaining domains wired (segurança done) | next pick: consentimento, qualidade, or governança -- same "pick a concrete trigger point, one dispatchNotification call, one NotificationRule, real-backend proof" pattern as this sitting's segurança slice |
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
| #683 | RF003 (RF015-adjacent, filed this sitting) | mfaLocked flag never enforced -- lockout doesn't actually block logins | security-sensitive, not sized/triaged; found while wiring #650's segurança domain, filed separately (not a #650 queue member) |

**Real unstarted candidates for the next pick: #650 (2nd domain),
#661, #677, #678, #683** (plus #648+#649 as their own iteration) --
everything else stays parked for Dennis/Denise's input or isn't
actionable yet, don't default to them just because they're in the
queue. #683 is new and unsized -- read it closely (and check whether it
belongs in the same "security-sensitive, own iteration" bucket as
#648/#649) before picking it up as a quick win.

## Budget (rabbit-hole Step 5, fresh sitting)

**~6-7/10.** #679 (~2-3pt) + #675 (~2pt) + #650's segurança slice
(~2pt, medium: one trigger point, one product-code call site, one unit
test file extended, one real-backend e2e test added, no data-model
change). Room for maybe one more medium item this sitting before the
checkpoint -- lean toward wrapping up soon rather than starting another
large item (#677) cold.

## Friction this sitting (wrap-up audit, this rotation's own item)

- **Bash tool's persisted cwd silently broke a `docker compose
  --env-file` relative path** -- an earlier `cd api/backend && npx
  vitest ...` call left cwd at `api/backend`; the next `docker compose
  --env-file .env.test.example ...` command (no explicit `cd` of its
  own) resolved the env-file relative to the wrong directory and failed
  instantly with "couldn't find env file," but `docker ps` still showed
  the old container as `healthy`, which read as "rebuild had no effect"
  rather than "rebuild never ran." Caught via `docker inspect
  --format='{{.Created}}'` before trusting the container reflected the
  session's source edits. Filed `dyeallpies-skills-pack#362` with
  verbatim suggested skill text (generic docker-workflow gotcha, not
  BioAvanceD-v2-specific).
- **`mfaLocked` enforcement gap** (product, not process) -- see #683
  above. Not this sitting's bug to fix (out of #650's scope), filed per
  wrap-up's "found a problem -> file it" rule.

## Repo state

- On `feature/docker-e2e-backend-integration`, ahead of
  `origin/feature/docker-e2e-backend-integration` by 31 commits (30 from
  before this sitting + this sitting's #650 merge) -- not yet pushed;
  pushing is a `ship-integration-branch`-gate decision. Working tree
  clean except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **`.env.docker` (local, gitignored) has `ENABLE_TEST_SUPPORT_ROUTES=true`**
  -- added in a prior rotation this sitting, still needed for the
  dev-stack's `TEST_SUPPORT_SECRET`-dependent specs under #675's
  registration gate. Machine-local, won't carry to another
  machine/session automatically.
- **Docker: up.** `compose.test.yml` test stack, `backend-app-test`
  rebuilt this sitting for #650's `auth.service.js` change (confirmed
  fresh via `docker inspect --format='{{.Created}}'` after the cwd
  mistake above was caught and corrected). `playwright-runner` not
  running (already stopped from a prior rotation). Reuse for the next
  pick, but **rebuild `backend-app-test`/`frontend-app-test` with
  `--build` again** (from the repo root, explicitly `cd`'d, per this
  sitting's own friction above) if the next iteration touches
  backend/frontend source again.
- Branch from this sitting's #650 slice (`test/650-mfa-lockout-notification`)
  merged and deleted locally, never pushed remotely.

## Recommended next steps

Still inside the rabbit hole -- continuing this same sitting per
Dennis's "continue" instruction, but budget is getting close to the
~10-point checkpoint (~6-7/10 now). Next: either pop **#650's 2nd
domain** (consentimento or qualidade or governança -- same pattern as
this sitting's segurança slice, likely another ~2pt medium item) for one
more quick iteration, or surface here and let Dennis decide whether to
continue further this sitting. Don't start **#677** (large,
divide-and-conquer territory) or **#648+#649** (security-sensitive,
deserves a fresh budget) cold this late in the sitting. Invoke the
routed skill (`work-issue` -> classified loop) for the *current* issue
right before editing, every time. Rotate this file again after the next
item closes/lands, per Step 4. #674 stays out of reach until RF027
exists; #660/#662/#663/#665/#666/#667/#680/#681/#682 all stay parked as
explicit design/policy calls or low-priority markers for Dennis/Denise
-- don't resolve any of them unilaterally. #683 is new -- worth a look
next sitting even though it's outside this rabbit hole's own scope
(RF003, not a #646 descendant).
