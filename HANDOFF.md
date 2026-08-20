# HANDOFF

**Written:** 2026-08-20, mid-sitting rotation after landing **#679** (per
`rabbit-hole`'s Step 4 -- every item gets its own rotation, including
when the session continues to the next item rather than stopping).
Continuing the Wave 3 rabbit hole (tracker **#646**) under Dennis's
"continue rabbit hole, Docker is on" instruction, in a fresh sitting
(budget resets per sitting, per `rabbit-hole`'s Step 5).

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as the prior rotation: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting (so far)

- **#679** -- RF007: `SampleFile.js`/`sample-file.controller.js` gained
  real `fileRole` (dict-02 ELM-0317, six-value enum, defaults to `raw`)
  and `fileFormat` (dict-02 ELM-0319, derived deterministically from the
  existing closed `fileType` enum). Merge commit `7b492833` on
  `feature/docker-e2e-backend-integration`. Verified: 9 new/updated unit
  tests, plus real-backend Docker proof (`scientific-data-access.spec.ts`,
  `sample-files-section-ui.spec.ts` -- all 10 specs in that shared file
  green, no regression).
  - Follow-up filed: **#681** (`canonical.v1.file`'s header comment is
    now stale re: the vocabulary-mismatch rationale #679 resolved; no
    real caller populates it from `SampleFile` yet) -- added to #646's
    queue, same "marker for a future slice" shape as #660/#663/#667.
  - Two skills-pack process findings filed during wrap-up (see below).

## Queue members remaining (16 open issues, plus #674 blocked)

Same table as the prior rotation, minus #679 (closed), plus #681 (new):

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
| #675 | RF029 | test-support probe route: attacker-controlled payload write, audit before deploy | security-flavored, needs Docker |
| #677 | RF005 (RF029-adjacent) | structured clinical-data domain unbuilt | large, likely divide-and-conquer |
| #678 | RF029 | no ThresholdProfile entity | needs Docker |
| #680 | RF029-adjacent | canonical contracts version-requirement policy call | design call, skip |
| #681 | RF029-adjacent (filed this sitting) | canonical.v1.file comment stale + no real caller populates it | marker for a future slice, skip unless picking it up directly |

**Real unstarted candidates for the next pick: #650, #661, #675, #677,
#678** (plus #648+#649 as their own iteration) -- everything else stays
parked for Dennis/Denise's input, don't default to them just because
they're in the queue.

## Budget (rabbit-hole Step 5, fresh sitting)

**~2-3/10.** #679 was a medium-large single-file-scope item (model +
controller + 2 unit test files + 2 e2e spec updates + one Docker
rebuild). Room for several more items this sitting before the checkpoint.

## Friction this sitting (wrap-up audit)

- **Docker build-not-mount gotcha, 3rd confirmed recurrence** (after
  #329 frontend, #333 backend): read both gotchas in the docker-workflow
  overlay this session, brought the stack up via the documented recipe
  with no `--build`, still got a stale `backend-app-test` image (first
  Playwright run showed `fileRole`/`fileFormat` as `undefined`). Rebuilt
  with `--build`, reran green. Filed
  `dyeallpies-skills-pack#361` with verbatim replacement text (a
  same-file, closer-to-the-recipe warning) for a pack-repo session to
  apply -- not editable directly from this session (skill-maintenance
  Rule 0, the overlay resolves through a junction into the pack repo).
- **`full-suite-guard.cjs` inconsistency**: a bare `npx vitest run
  tests/unit` with no explicit background flag exceeded its 120s timeout
  and auto-backgrounded, running to completion (exit 0) with no guard
  block at any point. The identical command run again in the foreground
  afterward was blocked immediately as expected. Filed
  `dyeallpies-skills-pack#360` -- the guard's enforcement point may fire
  on a completion hook rather than pre-execution, letting the
  auto-background-on-timeout path bypass it.

## Repo state

- On `feature/docker-e2e-backend-integration`, 26 commits ahead of
  `origin/feature/docker-e2e-backend-integration` -- not yet pushed;
  pushing is a `ship-integration-branch`-gate decision. Working tree
  clean except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **Docker: up.** `compose.test.yml` stack brought up fresh this sitting,
  `backend-app-test` rebuilt with `--build` after the stale-image
  gotcha above (so it reflects current source as of #679's merge). Admin
  bootstrap ran successfully. `playwright-runner` stopped (per the
  overlay's resource-contention gotcha) before the manual host-side
  Playwright runs above. Reuse this stack for the next RF029-adjacent
  pick (#675/#677/#678) rather than tearing down and rebuilding --
  **but rebuild `backend-app-test`/`frontend-app-test` with `--build`
  again before trusting it if this sitting touches backend/frontend
  source again** (the gotcha above applies to every subsequent iteration
  in the same sitting, not just the first bring-up).
- Branch from this sitting (`test/679-datafile-role-format-vocab`) was
  merged and deleted locally; never pushed remotely. A second throwaway
  branch (`test/local-env-note`) was created and deleted without any
  commit (blocked edit attempt on a pack-junctioned file, see friction
  notes) -- no trace left.

## Recommended next steps

Still inside the rabbit hole -- continuing this same sitting per
Dennis's "continue" instruction, budget nowhere near the ~10-point
checkpoint. Next: pop **#650**, **#661**, **#675**, **#677**, or
**#678** (the real unstarted candidates), or start a fresh iteration on
**#648+#649** together. Invoke the routed skill (`work-issue` ->
classified loop) for the *current* issue right before editing, every
time. Rotate this file again after the next item closes, per Step 4.
#674 stays out of reach until RF027 exists; #660/#662/#663/#665/#666/
#667/#680/#681 all stay parked as explicit design/policy calls or
low-priority markers for Dennis/Denise -- don't resolve any of them
unilaterally.
