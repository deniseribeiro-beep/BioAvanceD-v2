# HANDOFF

**Written:** 2026-08-21, after closing #650 (per `rabbit-hole`'s Step 4 --
every item gets its own rotation, including a clean close). Continuing
the Wave 3 rabbit hole (tracker **#646**) under Dennis's "continue rabbit
hole"/"keep going" instructions. **This is a new sitting** (post-`/clear`)
resuming the prior sitting's own checkpoint (~3-4/10) -- budget below
carries forward from that checkpoint, not reset.

## Rabbit-hole state: STILL INSIDE, not exited

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Same shape as prior rotations: RF014-026 all `DONE` per
`E2E_TRACEABILITY_PLAN.md`, but open follow-up/gap issues filed while
building them count as rabbit-hole queue members. **RF029 has its own
sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked on
RF027/Wave 4, not started).

## What landed this sitting (so far)

- **#650 CLOSED -- all 4 notification-engine domains now wired.** This
  sitting landed the 4th and final domain (qualidade):
  `nonconformance.service.js`'s `open()` (RF025 AC#5, "Ensaios e
  qualidade") now fires `dispatchNotification` with a new
  `nonconformance_opened` eventType, fire-and-forget with an explicit
  `.catch()`, same shape as the governança call site. `affectedEntityIds`
  has no referential-integrity check, so this domain needed no new
  fixture machinery -- smaller lift than the two candidates originally
  scoped for this slot (cold-chain/equipment quarantine, intake-wizard
  RCS-grade-E auto-quarantine), which stay unbuilt/unused for this
  purpose. Proven with 2 unit cases (12/12 in
  `nonconformance.service.test.js`) + a real-backend Docker e2e test (6/6
  in the RF015 "Alertas e notificações" describe block, no regression to
  the prior 3 domains). Branch `test/650-nonconformance-notification`,
  fix commit `9e013673`, merge `255b230f`. Closed with all 4 domains'
  merge hashes named in the close comment (segurança `1351043e`,
  consentimento `4a3d3ed9`, governança `dbf9ed5b`, qualidade `255b230f`).

## Queue members remaining (16 open issues, plus #674 blocked)

| # | RF | One-line | Note |
|---|---|---|---|
| #648 | RF014 | AC#4: no admin forced password reset | sized in a prior sitting -- bigger than it looks, touches login flow, security-sensitive; own iteration |
| #649 | RF014 | AC#8: policy changes don't revoke sessions | likely same iteration as #648 (adjacent, same file area) |
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
| #683 | RF003 (RF015-adjacent) | mfaLocked flag never enforced -- lockout doesn't actually block logins | security-sensitive, not sized/triaged. **Outside this rabbit hole's own scope** (RF003, not a #646 descendant) -- worth a dedicated look via ordinary `resolve-issue`, not a free rabbit-hole pick |
| #684 | RF010/RF021-adjacent | consent revocation endpoint has no role/ownership gate | security-sensitive, not sized/triaged -- needs a product call on intended revocation UX before fixing. **Same outside-scope note as #683** |

**Real unstarted candidates for the next pick (genuine #646 descendants):
#661, #677, #678** (plus #648+#649 as their own iteration) -- everything
else stays parked for Dennis/Denise's input or isn't actionable yet.
**#683/#684 are real and security-sensitive but are NOT rabbit-hole
queue members** (see `rabbit-hole`'s own Scope section) -- pick them up
via plain `resolve-issue` in a dedicated look, not as a "next rabbit-hole
item," if picked up at all.

## Budget (rabbit-hole Step 5, this sitting)

**~5-7/10**, carried forward from the prior sitting's ~3-4/10 checkpoint
plus this sitting's #650 close (~2-3pt: a normal single-slice build-loop
item, despite needing a Docker rebuild-and-retest cycle -- see friction
below). Under the ~10pt checkpoint -- room to continue, but getting
closer; size the next pick with that in mind.

## Friction this sitting (wrap-up audit)

- **dyeallpies-skills-pack#361, 4th confirmed recurrence** -- brought
  `compose.test.yml` up fresh (full teardown confirmed via `docker ps`
  before bring-up, zero `bioavanced-test-*` containers), no `--build`,
  per the overlay's own documented recipe. `backend-app-test` still
  served a pre-#650 image (confirmed via `docker exec ... grep
  dispatchNotification nonconformance.service.js` -- 0 matches despite
  the change being on disk). The qualidade e2e test failed on the first
  run purely because of this (timeout waiting for a notification that
  never dispatched, since the running code didn't have the dispatch call
  yet) -- not a real bug in the new code. Targeted rebuild
  (`up -d --build --wait backend-app-test`) fixed it immediately; reran
  6/6 green. Commented on the existing open pack issue #361 (already
  tracking this exact trap from BioAvanceD-v2#679, 3rd recurrence) rather
  than filing a duplicate -- added that this occurrence confirms the
  trigger is broader than "reusing a stack left up from a prior
  iteration" (the framing both `build-loop` and the overlay currently
  use): a **fully torn-down-then-fresh** bring-up hit it too, because
  Docker's image cache persists across `compose down` and across
  sessions, keyed on the image tag alone. Not yet fixed in the pack --
  next session hitting this recipe should append `--build` proactively
  whenever backend/frontend source changed since the image was last
  built, not just when reusing a live stack.
- **Minor, not filed**: a `cd api/backend && npx vitest run ...` failed
  once with "No such file or directory" even though `api/backend`
  verifiably exists and an immediately-following absolute-path `cd`
  succeeded from a `pwd`-confirmed repo-root cwd. Single occurrence,
  self-corrected immediately, no wrong conclusion drawn from it -- unclear
  if reproducible, didn't match either of the two existing Bash-cwd pack
  issues (#362 is the opposite direction: a stray `cd` silently breaking
  a *later* unrelated command). Flagging here in case it recurs for a
  future session; not worth a pack issue on a single unreproduced
  instance.

No other friction: scope stayed inside the loop's stated bounds (product
code + its own unit/e2e test only, confirmed via `git status` --only the
3 intended files touched), no stale instructions beyond the one above, no
security-relevant surface added (the new dispatch call sits behind the
same `requireRole(2,3,4)` gate the route already had, and reuses the
notification engine's existing `sensitiveFieldsAllowlist` mechanism --
no new exposure).

## Repo state

- On `feature/docker-e2e-backend-integration`, ahead of
  `origin/feature/docker-e2e-backend-integration` by 46 commits -- not
  yet pushed; pushing is a `ship-integration-branch`-gate decision.
  Working tree clean except the pre-existing untracked `.claude/skills/`
  and `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **`.env.docker` (local, gitignored) and `.env.test.example` (checked
  in) both have `ENABLE_TEST_SUPPORT_ROUTES=true`** -- confirmed
  identical for this flag this sitting, no longer an open question.
- **Docker: UP.** `compose.test.yml` test stack (all 12 core services +
  `admin-bootstrap-test`) is currently running, `backend-app-test`
  freshly rebuilt with this sitting's #650 change (confirmed via
  `docker exec` grep, not just container-created timestamp -- see
  friction above for why the timestamp alone isn't trustworthy).
  `playwright-runner` was stopped (not removed) before the manual
  targeted runs, per the overlay's resource-contention gotcha -- restart
  it (`docker compose -f compose.test.yml start playwright-runner`) only
  if the full containerized suite is actually wanted. Left up
  deliberately (not torn down) since the rabbit hole is continuing this
  same sitting -- tear down via `docker compose --env-file
  .env.test.example -f compose.test.yml down` (no `-v`) only at Dennis's
  explicit request or genuine end of sitting, same convention as before.
- This sitting's branch (`test/650-nonconformance-notification`) merged
  and deleted locally, never pushed remotely.

## Recommended next steps

Budget (~5-7/10) has room but is past the halfway point -- size the next
pick accordingly, favor a medium item over a large one. **#661** (RF024
AC#2, evaluateCompatibility consent gap) is the smallest genuine
candidate but is itself a borderline design call -- read closely before
committing to it as a pure bug fix vs. something needing Dennis's input.
**#677/#678** are both larger, likely `divide-and-conquer` territory.
**#648+#649** are a matched pair (same file area) sized in a prior
sitting as "bigger than it looks, security-sensitive" -- treat as one
iteration, not two. Invoke the routed skill (`work-issue` -> classified
loop) for the *current* issue right before editing, every time. Rotate
this file again after the next item lands/closes, per Step 4. #674 stays
out of reach until RF027 exists; #660/#662/#663/#665/#666/#667/#680/#681/
#682 all stay parked as explicit design/policy calls or low-priority
markers -- don't resolve any of them unilaterally. #683/#684 are both
security-sensitive, real, and outside this rabbit hole's own scope --
worth a dedicated `resolve-issue` look, still not picked up, not a
rabbit-hole queue pick.
