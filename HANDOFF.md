# HANDOFF

**Written:** 2026-08-20, end of this sitting (rotating one last time per
`rabbit-hole`'s Step 4/5). Continuing the Wave 3 rabbit hole under
Dennis's "continue, Docker is on, we're only out when we finish Wave 3,
though we will probably not finish this session" instruction. Landed
**#657**, **#676**, **#656**, and **#664** this sitting, plus follow-ups
**#680** and two skills-pack findings (**dyeallpies-skills-pack#358**,
**#359**). Stopping here at the sitting's own budget checkpoint (Step
5), not because anything blocked -- still inside the rabbit hole.

**Sized but declined this sitting: #648** (RF014 AC#4, forced password
reset). Investigated (read the issue, the existing `reset-mfa`
precedent in `user.routes.js`, and `auth.service.js`'s login/
`processLogin` flow) and confirmed it's well-scoped and unambiguous --
but bigger than it first looked: a new `mustChangePassword` user-model
field, an admin endpoint mirroring `reset-mfa`'s shape, real
entanglement with the login flow (a `requiresPasswordChange`-style
response + temp token, matching the existing `requiresMFASetup`
pattern), and a follow-up endpoint to actually set the new password --
all in a security-sensitive area (auth/login) that deserves a full
iteration's attention and its own real-backend proof, not a squeeze
into an already ~7/10-point sitting's tail end. No code was touched for
it -- pure investigation, safe to pick up fresh next time. #649 (RF014
AC#8, revoke sessions) is adjacent/similar in shape and probably
belongs in the same future iteration as #648 since both touch
`security.service.js`/session lifecycle.

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
| #648 | RF014 | AC#4: no admin forced password reset | sized this sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration, see note above |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
| #650 | RF015 | notification engine only wired to 1 of 5 domains | larger, may need divide-and-conquer |
| #660 | RF024 | AC#4: Shipment entity not built | explicitly "not urgent... file as a marker" -- don't pick |
| #661 | RF024 | AC#2: evaluateCompatibility skips dataset/file consent | borderline design call (is de-identified-by-design an explicit policy?) -- read closely before picking |
| #662 | RF024 | manageAccessRequests permission may be too broad | design call |
| #663 | RF024 | AC#2: no AccessPolicy entity | **explicit design call, skip** |
| #665 | RF025 | Técnico (RF's own primary actor) can't create Assay/ReagentLot | **re-triaged this sitting: genuine RBAC/access-control policy call ("confirm with Dennis/Denise... or Coordenador-only is intended"), NOT mechanical despite the nonconformances precedent pointing one way -- skip unless Dennis weighs in** |
| #666 | RF025 | AC#3: dict-02 Device entity richer than code's Equipment | **explicit design call, skip** |
| #667 | RF026 | RetentionPolicy ALLOWED_ENTITY_TYPES too narrow | **explicit design call, skip -- needs Dennis/Denise** |
| #675 | RF029 | test-support probe route: attacker-controlled payload write, audit before deploy | security-flavored, needs Docker |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer |
| #678 | RF029 | no ThresholdProfile entity | needs Docker |
| #679 | RF029 | file vocab mismatch (fileFormat/fileRole) | needs Docker |
| #680 | RF029-adjacent (filed this sitting) | canonical contracts version-requirement policy call | design call, skip |

**Of the 15, only #650/#661/#675/#677/#678/#679 are real unstarted
candidates for the next iteration** (plus #648+#649 as their own
iteration) -- #660/#662/#663/#665/#666/#667/#680 all need Dennis/Denise's
input before touching, don't default to them just because they're in
the queue.

**Budget (rabbit-hole Step 5):** ~10-point sitting budget. #657=1pt,
#676=~1-2pt, #656=1pt, #664=~3pt (build-loop, Docker, multi-file,
touched a shared route factory). Running total: **~7/10** --
this sitting's own stop-and-report checkpoint, per Step 5. Not a fixed
count reached by coincidence: #648 was investigated and explicitly
declined for size/sensitivity reasons above, which is what actually
triggered stopping here rather than squeezing in one more small item.

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
- **Docker: torn down.** A follow-up status-check sitting (2026-08-20,
  after this file was already written) inherited the stack described
  above, did no work with it (only re-read this handoff and reported
  status), and per `clean-up`'s "inherited a stack you didn't start"
  rule tore it down with Dennis's explicit confirmation rather than
  leaving it idle. Next sitting starts from a clean slate: bring the
  stack up fresh (`docker compose -f compose.test.yml up`) before
  picking up #675/#677/#678/#679 (all RF029-adjacent, all likely need
  the real backend) -- rebuilding `backend-app-test`/`frontend-app-test`
  from current source is part of a fresh bring-up regardless (build-not-
  mount gotcha, `docker-workflow`'s BioAvanceD-v2 overlay).
- Fix branches from this sitting (`fix/657-...`, `fix/676-...`,
  `fix/656-...`, `test/664-...`) were all merged and deleted locally;
  none were ever pushed remotely.

## Recommended next steps

Still inside the rabbit hole -- stopped at this sitting's own budget
checkpoint (~7/10), per Dennis's own "probably won't finish this
session" framing, not because anything blocked. Next sitting: pop
**#650**, **#661**, **#675**, **#677**, **#678**, or **#679** (the only
non-design-call items left), or start a fresh iteration on **#648+#649**
together (same file area, both security-sensitive, both need real
login-flow/session-lifecycle work and their own real-backend proof).
Invoke the routed skill for the *current* issue right before editing,
every time (see this sitting's own friction notes above). The Docker
stack is up as of this writing -- reuse it for any RF029-adjacent pick
rather than tearing down and rebuilding, if the next sitting starts
before it's been torn down some other way. Rotate this file again per
Step 4 after each close; stop at the budget checkpoint or when Dennis
says stop. #674 stays out of reach until RF027 exists;
#660/#662/#663/#665/#666/#667/#680 all stay parked as explicit
design/policy calls for Dennis/Denise -- don't resolve any of them
unilaterally, even ones that look mechanical at first glance (see
#665's re-triage above -- a plausible-looking precedent isn't the same
as a settled policy).
