# HANDOFF

**Written:** 2026-08-21, after closing #648 (per `rabbit-hole`'s Step 4 --
every item gets its own rotation, including a clean close). Continuing
the Wave 3 rabbit hole (tracker **#646**) under Dennis's "continue rabbit
hole"/"keep going" instructions. Same sitting as the previous rotation
(`da6d03ef`, #650) -- this rotation supersedes it after landing one more
item.

## Rabbit-hole state: STILL INSIDE, not exited -- budget at/past the ~10pt ceiling, stopped here for a checkpoint

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting

- **#648 CLOSED -- RF014 AC#4 (admin-forced password reset) built and
  merged**, merge `79149980` on `feature/docker-e2e-backend-integration`.
  The `forceReset` flag already existed on the User model (set only by
  `createFirstAdmin.js`'s bootstrap, never wired to anything) -- this
  slice added the missing half: an admin endpoint
  (`POST /api/users/:id/force-password-reset`, mirrors `reset-mfa`'s
  shape, new `forcePasswordReset` RBAC permission) plus a login-flow gate
  in `auth.service.js#processLogin` (returns `requiresPasswordChange`
  inline, same UX pattern as the existing 2FA-code prompt -- no new
  page). Frontend: `LoginPage.tsx` inline section,
  `SystemManagementPage.tsx` admin button.
  - **Turned out bigger than the "smaller lift" sizing this rabbit hole
    generally favors** -- sized as **large (5pt)**, not medium, because
    wiring up enforcement for the *first time* on a previously-dormant
    flag surfaced a real, repo-wide problem: `createFirstAdmin.js` has
    *always* set `forceReset:true` for the bootstrap admin, but since
    nothing enforced it, the persistent test-stack's own admin fixture
    (bootstrapped 2026-08-17) carried a dormant `forceReset:true` this
    whole time. The moment enforcement landed, every e2e spec depending
    on direct admin login via `realLogin()` broke -- not just this local
    volume, but every *fresh* bootstrap including CI's. Fixed in the same
    branch with an explicit, isolated opt-out
    (`BOOTSTRAP_ADMIN_FORCE_RESET`, `compose.test.yml`'s `x-test-env`
    only -- never inferred from `NODE_ENV`, same shape
    `AUTH_RATE_LIMIT_RELAXED` already uses) rather than weakening the
    real default. Also caught and fixed a second bug on the way: the new
    `requiresPasswordChange` flag wasn't hoisted to the response's root
    level in `auth.controller.js` (unlike `requiresMFASetup`/`requiresMFA`),
    so the frontend's generic fallback silently misread it as a 2FA
    prompt -- confirmed live via a real-backend Playwright run before the
    fix, re-confirmed green after.
  - Proven via a real-backend Playwright test (`auth-access-security.spec.ts`,
    RF014 describe block) driving the actual login-page UI through the
    full block-and-recover flow in a real browser, plus unit/integration
    coverage (auth.service.processLogin gate, the new route handler,
    auth.controller.js's response-shaping, createFirstAdmin.js's
    opt-out). Full spec file re-run 11/11 green (confirms no regression
    to RF001-RF014's other criteria). All targeted backend test files
    160/160.
  - **Two policy calls made autonomously, filed for Denise's sign-off
    rather than resting only on code comments: #686** -- (a) no
    admin-targeting restriction on the new endpoint, unlike `reset-mfa`'s
    own admin-protection rule; (b) the test/CI bootstrap opt-out's exact
    scoping.
  - RF014 is now 7/8 criteria proven -- only AC#8 (#649) remains, and it
    still needs Denise's product call on which policy changes should
    trigger session revocation before it's buildable.
- **Filed dyeallpies-skills-pack#366**: a vitest `globalThis.vi` /
  working-directory gotcha, confirmed this sitting (twice) and matching a
  previously-flagged-but-undiagnosed friction note from the prior
  sitting -- see that issue for the full diagnosis. Practical takeaway
  for the next session: **always run this repo's backend vitest suite
  from `api/backend`, never the repo root** -- a wrong-directory run
  doesn't fail cleanly, it silently breaks any test relying on
  `globalThis.vi` (e.g. `tests/factories/rbac.factory.js`'s
  `buildMutableRbacCollections`) with a confusing, unrelated-looking
  `TypeError`.

## Queue members remaining (16 open issues, plus #674 blocked, plus #686 new)

| # | RF | One-line | Note |
|---|---|---|---|
| #649 | RF014 | AC#8: policy changes don't revoke sessions | needs Denise's product call (which changes require revocation) -- not a quick fix, don't pick without her input |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent | genuine design call -- the issue itself poses two options (build dataset/file->participant consent resolution, or declare de-identified-by-design explicit) and doesn't resolve which; a data-consent policy question, not a pure bug fix. Read closely / consider asking Dennis before picking |
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
| #683 | RF003 (RF015-adjacent) | mfaLocked flag never enforced -- lockout doesn't actually block logins | security-sensitive, not sized/triaged. **Outside this rabbit hole's own scope** (RF003, not a #646 descendant) -- worth a dedicated look via ordinary `resolve-issue`, not a free rabbit-hole pick |
| #684 | RF010/RF021-adjacent | consent revocation endpoint has no role/ownership gate | security-sensitive, not sized/triaged -- needs a product call on intended revocation UX before fixing. **Same outside-scope note as #683** |
| #686 | RF014-adjacent (not a #646 descendant) | two policy calls from #648 (admin-targeting scope, bootstrap opt-out) needing Denise's sign-off | **not itself a rabbit-hole pick** -- it's a sign-off request on already-shipped code, not unbuilt work. Close it once Denise confirms or corrects the two calls it documents |

**Real unstarted candidates for the next pick (genuine #646 descendants):
#661, #677, #678** -- everything else stays parked for Dennis/Denise's
input or isn't actionable yet. **#683/#684 are real and
security-sensitive but are NOT rabbit-hole queue members** (see
`rabbit-hole`'s own Scope section) -- pick them up via plain
`resolve-issue` in a dedicated look, not as a "next rabbit-hole item," if
picked up at all. **#649 is now standalone** (the #648/#649 "matched
pair" framing from the prior rotation didn't hold up once read closely --
#648 was a clean build, #649 explicitly needs a design call first).

## Budget (rabbit-hole Step 5)

**At or past the ~10pt sitting ceiling** -- prior rotation's own
checkpoint was ~5-7/10, and #648 sized out to **large (5pt)** once the
bootstrap-collision fix is counted in (see above), landing this sitting
at roughly **10-12/10**. Per Step 5, this is exactly the "next pop would
push past budget" signal: stopping here to surface and let the user
decide whether to continue this sitting or resume later, rather than
autonomously picking up another item.

## Friction this sitting (wrap-up audit)

- **The vitest cwd/globals gotcha above (dyeallpies-skills-pack#366)** --
  the actual proof-of-work friction this sitting: hit it twice, each time
  costing a full misdiagnosis-and-recheck cycle before tracing it back to
  running from the repo root instead of `api/backend`.
- **No other core-audit friction**: scope stayed inside build-loop's
  bounds once the bootstrap-collision fix is understood as integral (not
  optional) to landing AC#4 safely -- confirmed via `git status`/`git
  diff --stat` against the merge, only the 22 intended files touched.
  Docker rebuild cycles were repeated (3x backend, 2x frontend) as issues
  were caught incrementally (a TS interface mismatch, then the
  controller response-shaping bug) rather than all upfront -- normal cost
  of iterative debugging on a slice that turned out to need more than
  initially scoped, not a process gap worth its own fix.
- **Two security-relevant judgment calls filed for sign-off rather than
  left implicit: #686** (see above) -- per this pack's own
  security-decision discipline, "the code comment explains why" isn't
  the same as an owner's actual confirmation.

## Repo state

- On `feature/docker-e2e-backend-integration`, ahead of
  `origin/feature/docker-e2e-backend-integration` by 49 commits -- not
  yet pushed; pushing is a `ship-integration-branch`-gate decision.
  Working tree clean except the pre-existing untracked `.claude/skills/`
  and `api/backend/storage/assays/` (neither this sitting's doing).
  This sitting's branch (`test/648-admin-force-password-reset`) merged
  (`79149980`) and deleted locally, never pushed remotely.
- No PR to `main` exists.
- **Docker: UP.** `compose.test.yml` test stack is currently running,
  `backend-app-test`/`frontend-app-test` freshly rebuilt with this
  sitting's #648 changes (confirmed via `docker exec` grep against the
  running containers' own source, not just container-created
  timestamps). RBAC catalog re-seeded (23 permissions, up from 22) so
  the new `forcePasswordReset` permission is live. The persistent test
  admin's dormant `forceReset:true` was cleared directly (one-time data
  fix on the already-bootstrapped fixture; the `BOOTSTRAP_ADMIN_FORCE_RESET`
  code fix only affects *future* fresh bootstraps).
  **`playwright-runner` is no longer present at all** (not just stopped)
  -- was "stopped, not removed" per the prior rotation; unclear why it's
  now absent from `docker ps -a` entirely. Didn't block anything this
  sitting (all verification ran as targeted host-side Playwright
  commands against specific spec files) and wasn't investigated further
  -- flagging in case a future session needs the full containerized
  suite and finds it missing. Restart/recreate via `docker compose -f
  compose.test.yml up -d playwright-runner` if needed, or a targeted
  `up -d --build --wait` on it specifically if the image itself is gone.
  Tear down the whole stack only at Dennis's explicit request or genuine
  end of sitting: `docker compose --env-file .env.test.example -f
  compose.test.yml down` (no `-v`).

## Recommended next steps

**Budget is at/past the ~10pt ceiling -- this is a natural checkpoint to
ask Dennis whether to continue this sitting or resume later**, per
rabbit-hole's own Step 5. If continuing: **#661** is the smallest
genuine candidate but is itself a borderline design call (read closely
before committing, or ask Dennis first); **#677/#678** are both larger,
likely `divide-and-conquer` territory. Invoke the routed skill
(`work-issue` -> classified loop) for the *current* issue right before
editing, every time. Rotate this file again after the next item
lands/closes, per Step 4. #674 stays out of reach until RF027 exists;
#649/#660/#662/#663/#665/#666/#667/#680/#681/#682 all stay parked as
explicit design/policy calls or low-priority markers -- don't resolve
any of them unilaterally. #683/#684 are both security-sensitive, real,
and outside this rabbit hole's own scope -- worth a dedicated
`resolve-issue` look, still not picked up, not a rabbit-hole queue pick.
#686 isn't a queue pick either -- it's a sign-off request, close it once
Denise responds.
