# HANDOFF

**Written:** 2026-08-20, mid-sitting rotation after landing **#675** (per
`rabbit-hole`'s Step 4 -- every item gets its own rotation). Continuing
the Wave 3 rabbit hole (tracker **#646**) under Dennis's "continue rabbit
hole, Docker is on" instruction, same fresh sitting as the prior
rotation.

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting (so far)

- **#679** -- RF007: `SampleFile.js`/`sample-file.controller.js` gained
  real `fileRole`/`fileFormat` (dict-02 ELM-0317/ELM-0319). Merge
  `7b492833`. Follow-up filed: **#681** (canonical.v1.file comment now
  stale).
- **#675** -- test-support route registration hardened: both
  `iot.routes.js` and `ingestionTestSupport.routes.js` now require an
  explicit `ENABLE_TEST_SUPPORT_ROUTES=true` opt-in on top of
  `NODE_ENV !== 'production'` before mounting, same "explicit isolated
  opt-in" shape as `AUTH_RATE_LIMIT_RELAXED`. Deduplicated the two
  routes' identical gate logic into `api/backend/src/utils/
  testSupportGate.js`. Wired the flag into `.env.docker`/
  `.env.docker.example`, `.env.test.example` + `compose.test.yml`'s
  `x-test-env` anchor, and `tests/vitest.setup.js`. Merge `6524d203`.
  Verified: 9 new unit tests, plus real-backend Docker proof -- 23/23
  `pipeline-continuity.spec.ts` "Ingestion gateway" specs (RF029 slices
  1-5), 22/22 `interop-monitoring.spec.ts` (RF009/011/015), 6/6
  `iot.api.test.js`'s existing test-support describe block, all green.
  - Follow-up filed: **#682** (pre-deployment checklist marker: confirm
    `NODE_ENV=production` + `ENABLE_TEST_SUPPORT_ROUTES` unset in the
    first real deployment -- not actionable from this repo's code, no
    production deployment exists yet).
  - Three skills-pack process findings filed across this sitting (see
    below).

## Queue members remaining (16 open issues, plus #674 blocked)

Same table as the prior rotation, minus #675 (closed), plus #682 (new):

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | sized in a prior sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
| #650 | RF015 | notification engine only wired to 1 of 5 domains | larger, may need divide-and-conquer |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent | borderline design call (is de-identified-by-design an explicit policy?) -- read closely before picking |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico can't create Assay/ReagentLot | **re-triaged in a prior sitting: genuine RBAC/access-control policy call -- skip unless Dennis weighs in** |
| #666 | RF025 | AC#3: dict-02's Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer |
| #678 | RF029 | no ThresholdProfile entity | needs Docker |
| #680 | RF029-adjacent | canonical contracts version-requirement policy call | design call, skip |
| #681 | RF029-adjacent | canonical.v1.file comment stale + no real caller populates it | marker for a future slice, skip unless picking it up directly |
| #682 | RF029-adjacent (filed this sitting) | pre-deployment checklist: NODE_ENV/ENABLE_TEST_SUPPORT_ROUTES verification | marker, not actionable until a real deployment exists |

**Real unstarted candidates for the next pick: #650, #661, #677, #678**
(plus #648+#649 as their own iteration) -- everything else stays parked
for Dennis/Denise's input or isn't actionable yet, don't default to them
just because they're in the queue.

## Budget (rabbit-hole Step 5, fresh sitting)

**~4-5/10.** #679 (~2-3pt, medium-large single-file-scope) + #675
(~2pt, cross-cutting but mechanically contained: one shared module, two
route-file edits, four env-file wirings, real-backend proof across two
e2e spec files). Room for a couple more items this sitting before the
checkpoint.

## Friction this sitting (wrap-up audit)

- **Docker build-not-mount gotcha, 3rd confirmed recurrence** (after
  #329 frontend, #333 backend, now #679): read both gotchas in the
  docker-workflow overlay, still got a stale `backend-app-test` image on
  first bring-up. Filed `dyeallpies-skills-pack#361` with verbatim
  replacement text for a pack-repo session to apply (not editable
  directly -- skill-maintenance Rule 0, resolves through a junction).
- **`full-suite-guard.cjs` inconsistency**: a bare `npx vitest run
  tests/unit` that auto-backgrounded on timeout ran to completion with no
  guard block; the identical foreground command was blocked as expected.
  Filed `dyeallpies-skills-pack#360`.
- **Close-discipline gate caught its own trigger, in-session**: #675's
  close comment named ask #1 (NODE_ENV=production verification) as
  future/checklist work with no tracking issue -- caught during this
  same iteration's wrap-up audit (not a later session), filed **#682**
  immediately per `resolve-issue`'s "re-read the close comment for
  deferral language" gate. Working as designed, not a new finding.

## Repo state

- On `feature/docker-e2e-backend-integration`, 28 commits ahead of
  `origin/feature/docker-e2e-backend-integration` -- not yet pushed;
  pushing is a `ship-integration-branch`-gate decision. Working tree
  clean except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **`.env.docker` (local, gitignored) now also has
  `ENABLE_TEST_SUPPORT_ROUTES=true`** -- added this sitting so the dev
  stack's existing `TEST_SUPPORT_SECRET`-dependent specs
  (`interop-monitoring.spec.ts` against `compose:up`) keep working under
  #675's new registration gate. Machine-local, won't carry to another
  machine/session automatically -- if a fresh clone's dev-stack e2e run
  ever 404s on a test-support route, check this var first.
- **Docker: up.** `compose.test.yml` stack from the prior rotation,
  `backend-app-test` rebuilt twice this sitting (once for #679, once for
  #675's `x-test-env` anchor change) -- current as of #675's merge.
  `playwright-runner` stopped before manual host-side Playwright runs.
  Reuse for the next pick, but **rebuild `backend-app-test`/
  `frontend-app-test` with `--build` again before trusting it** if this
  sitting touches backend/frontend source again (applies every
  iteration, not just first bring-up -- 3rd confirmed recurrence above).
- Branch from this sitting (`fix/675-test-support-route-gate`) merged
  and deleted locally, never pushed remotely.

## Recommended next steps

Still inside the rabbit hole -- continuing this same sitting per
Dennis's "continue" instruction, budget nowhere near the ~10-point
checkpoint. Next: pop **#650**, **#661**, **#677**, or **#678** (the
real unstarted candidates), or start a fresh iteration on **#648+#649**
together. Invoke the routed skill (`work-issue` -> classified loop) for
the *current* issue right before editing, every time. Rotate this file
again after the next item closes, per Step 4. #674 stays out of reach
until RF027 exists; #660/#662/#663/#665/#666/#667/#680/#681/#682 all
stay parked as explicit design/policy calls or low-priority markers for
Dennis/Denise -- don't resolve any of them unilaterally.
