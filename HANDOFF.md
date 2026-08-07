# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after resolving #515.

## What happened this session

Dennis said "pick #515" — the actual fix for last session's finding
(`test:smoke` was a silent no-op because vitest 4.1.10's
`--changed`/`related` never walks this repo's CommonJS `require()`
graph). **Routing:** `work-issue` → `fix-bugs` (a reproducible defect in
the `test:smoke` script itself, not new coverage or a spec'd-but-missing
feature).

**Fix:** replaced the `vitest run --changed=origin/main` invocation with
`api/backend/scripts/test-smoke.js`, a small grep-based CJS `require()`
dependency-graph walker: builds the reverse-dependency graph over
`src/` + `tests/` via static regex parsing of `require('./...')` calls,
BFS from the changed files to their full set of transitively-dependent
test files, then runs vitest on just that file list.

**Verified against the exact #507/#514/#515 repro**: renamed
`MongoStorageRepository.findCurrentStorageAssignment` to
`...RenamedForVerification` (definition only, call sites left broken),
ran `SMOKE_BASE_REF=HEAD npm run test:smoke` — correctly selected and
failed `MongoStorageRepository.test.js` plus its transitive dependents
(`sample.service.test.js`, `storageService.test.js`, several
integration tests, etc. — 4 failed files, 40 failed tests). Confirmed
the fix actually catches the #507 shape that motivated #513/#514/#515.
Break fully reverted before committing anything.

**Hit and fixed one bug in the new script during verification**: `git
diff --name-only` returns paths relative to the repo root, not the
script's cwd (`api/backend`) — needed `--relative` or path resolution
broke silently (every file resolved to a nonexistent path, so the graph
walk found 0 affected tests on the first attempt). Also added a
`MAX_SMOKE_FILES` (150) safety cap after the first real-world run
against `origin/main` tried to pass 349 filenames to `npx vitest` and
crashed with Windows' command-line-length limit.

**New finding filed as a follow-up, not fixed this session:**
[BioAvanceD-v2#516](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/516)
— `test:smoke`'s default base ref (`origin/main`) is currently
non-functional on *this* branch: `feature/docker-e2e-backend-integration`
is ~500 commits ahead of `origin/main` (which hasn't merged it yet), so
the default diff picks up 349 test files and hits the new safety cap,
erroring instead of running. The graph-walking logic itself is verified
correct (per the repro above) — this is specifically about the *default
base ref* choice on a long-lived integration branch. Commented on
skills-pack#229 with the same "don't wire this in without accounting for
X" note as last session's #514→#515 finding.

**#515 closed**, fix merged into `feature/docker-e2e-backend-integration`
at `d220ddc9`. Remote delete of `fix/515-test-smoke-cjs-graph` was
blocked by the auto-mode permission classifier (same known pattern as
BioAvanceD-v2#392/#391) — branch is merged and harmless, left in place
for Dennis to clean up or grant permission for.

`wrap-up` ran: the #516 finding above is the friction/discovery worth
noting; everything else went per the `fix-bugs` skill as written (branch
→ reproduce → fix → verify → merge → close, in order).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `d220ddc9`, clean, up
  to date with origin. Contains the merged #515 fix
  (`api/backend/scripts/test-smoke.js`,
  `api/backend/package.json`'s `test:smoke` script updated).
- Remote branch `fix/515-test-smoke-cjs-graph` still exists (merged,
  harmless) — local copy already deleted. Remote delete blocked by
  permission classifier; safe for Dennis to delete manually.
- Issues this session: **#515 closed** (merged at `d220ddc9`). **New:**
  BioAvanceD-v2#516 (open — fix `test:smoke`'s default base-ref choice
  for long-lived branches). skills-pack#229 got a second comment
  (still open, now doubly-blocked-in-spirit pending #516 too).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward:

**#516** (new, this session) — `test:smoke`'s default `base=origin/main`
errors out on this branch specifically because of how far it's diverged
from `origin/main`. Natural next pick if continuing this thread; likely
fix is defaulting to something like `git merge-base HEAD origin/main`
or letting CI callers pass an explicit base ref.

**skills-pack#229** — pack-repo only, now has two stated dependencies:
don't wire `test:smoke` into the gate until both #515 (done) and #516
(open) land.

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

**#491** stays open as the tracking issue for the RCS-consumer
migration (separate from #494's storage/custody scope, itself fully
worked through as of #512).

**#390** — the umbrella issue; tracks #491, #492, #493 (closed), and
#494's 6 follow-ups (all closed, including #512 as not-applicable)
collectively.

Other backlog carried forward unchanged from prior handoffs (not
re-verified this session):
- **#492's own note (SPREC on live registration):** the live
  `POST /api/samples` path still doesn't call
  `specimenPreanalyticsService.recordProfile` for the `sprec` payload it
  accepts for RCS computation.
- **#495** — frontend consumers, including `sampleMerkleIntegrity.js`.
  Depends on #491, #493 (done), #494's follow-ups (all closed) — clear
  to pick up.
- **#496** — remaining misc backend surfaces from
  `canonical-data-contract-v1.md`'s "Known Residual Legacy Surfaces"
  list not covered by #491-#495.
- **#489** — full-suite vitest flakiness. Not re-confirmed this session.
- Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
  grep sweep, dangling merged branches (`test/440-*`, `test/441-*`,
  `fix/444-retention-period-iso8601`, `fix/450-*`,
  `fix/476-quarantine-status-design-call`,
  `fix/485-sample-details-storage-migration`,
  `test/486-storage-move-sample`, `test/488-inline-storage-movement-e2e`,
  `test/507-storage-repository-canonical-return-shape`,
  `test/508-storage-usecases-canonical-assignment`,
  `test/509-storage-service-canonical-assignment`,
  `test/510-sample-service-canonical-storage-assignment`,
  `test/511-intake-wizard-canonical-storage-assignment`,
  `fix/512-quarantine-storage-scope-not-applicable`,
  `fix/513-smoke-check-script`,
  `fix/515-test-smoke-cjs-graph` — all safe to delete, low priority
  housekeeping).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread once skills-pack#227 lands the new spec in the inventory.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit.

## Dev stack state

Nothing started this session. All verification ran vitest directly
(targeted file lists via the new `test-smoke.js`, and a manual repro
under `SMOKE_BASE_REF=HEAD`) — no Docker, no live app.

## Which skills to use

- `work-issue` → `fix-bugs`: a reproducible defect in a repo script
  (not product application code, but still tracked source under
  `api/backend/scripts/`) routes to `fix-bugs` the same as any other
  bug — reproduce first, fix, verify against the repro, merge, close.
- **New this session:** when replacing a broken detection/tooling script,
  verify the replacement against the *exact* prior repro before trusting
  it — don't just trust that new logic "should" work. The first version
  of `test-smoke.js` had its own silent bug (relative-path resolution)
  that would have shipped undetected without re-running the #507-shaped
  repro end to end.
- **New this session:** a fix that works correctly in isolation can still
  be non-functional under its *default* invocation on the specific branch
  you're merging it into — running the actual `npm run <script>` command
  (not just a scoped manual test) against the real branch state caught
  #516, which a narrower verification would have missed.
