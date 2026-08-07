# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after resolving #514.

## What happened this session

Dennis said "pick #514" — the verification issue carried forward from the
prior handoff (confirm `test:smoke`, added in #513, actually catches a
#507-shaped cross-file break). **Routing:** `work-issue` → `resolve-issue`
(a verification/confirmation task, not a new bug fix or new coverage —
route 6's exception for confirming a previously-filed finding).

**Verification required actually running the guarded command.** This
repo's `full-suite-guard` hook blocks any bare/`--changed` vitest
invocation regardless of args, by design (it can't tell a deliberate
one-off check from an accidental full-suite run). Asked Dennis via
`AskUserQuestion` for a one-time exception — approved.

**Repro:** renamed `MongoStorageRepository.findCurrentStorageAssignment`
to `findCurrentStorageAssignmentRenamedForVerification` (definition only,
call sites in `sample.service.js` and `findSampleById` left broken/
untouched) — the exact #507 shape. Result:

- `npx vitest run --changed --passWithNoTests` (uncommitted diff): **0
  test files selected.**
- Same with `--changed=HEAD~1` after committing the break.
- `npx vitest related src/infrastructure/persistence/mongo/MongoStorageRepository.js`:
  also 0 — even though `tests/unit/MongoStorageRepository.test.js`
  `require()`s that file **directly** (depth-1, not transitive).
- Control: running that test file directly does correctly fail 3 tests
  on the break (`this.findCurrentStorageAssignment is not a function`) —
  proving the gap is entirely in vitest's `--changed`/`related`
  selection, not in the tests themselves.

**Conclusion: `test:smoke` as configured is a no-op** — vitest 4.1.10's
`--changed`/`related` isn't walking this repo's CommonJS `require()`
graph at all, not even one level deep. It would pass on any pure
cross-file break as long as no test file itself was touched — exactly
the #507 failure mode it was built to catch.

**All repro changes fully reverted** (`git reset --hard HEAD~1`, working
tree confirmed clean and matching origin) before closing anything out.

**Filed:**
- [BioAvanceD-v2#515](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/515)
  — fix or replace `test:smoke`'s detection mechanism; full repro and
  findings live there.
- Comment on
  [skills-pack#229](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/229)
  — stakes update: wiring `test:smoke` into the gate as currently
  configured would give false confidence, not catch anything; that
  should be fixed (via #515) before #229's gate-wiring work is applied.

**#514 closed** with the negative result and pointer to #515.

`wrap-up` ran: no friction beyond what's already noted above (the guard
exception went exactly as the hook's own text describes). No scope creep
— only the temporary synthetic-break commit touched anything, and that
was reverted before the session ended.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `55bce5c3`, clean, up
  to date with origin. No commits landed this session (verification-only;
  the synthetic break and its commit were both reverted).
- Issues this session: **#514 closed**. **New:** BioAvanceD-v2#515 (open,
  fix/replace `test:smoke`'s detection), skills-pack#229 (open, comment
  added — now blocked-in-spirit on #515 landing first).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward:

**#515** (new, this session) — the actual fix: `test:smoke` doesn't
detect cross-file breaks at all in this repo's CJS layout. Needs either
a vitest config fix (if one exists for CJS `require`-graph walking) or a
different detection mechanism entirely. Natural next pick given it's the
direct continuation of this session's finding.

**skills-pack#229** — pack-repo only, and now has a stated dependency:
don't wire `test:smoke` into the gate until #515 lands.

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
  `fix/513-smoke-check-script` — all safe to delete, low priority
  housekeeping).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread once skills-pack#227 lands the new spec in the inventory.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit.

## Dev stack state

Nothing started this session. Verification-only: one temporary local
commit made and fully reverted (`git reset --hard`), no lasting code
change. Working tree clean, matches origin.

## Which skills to use

- `work-issue` → `resolve-issue`: a "verify a prior finding" issue
  routes to `resolve-issue` (route 3's exception), not `test-loop` or
  `fix-bugs` — no new coverage was written and no product bug was fixed,
  the deliverable was the confirmed-negative finding itself plus its
  follow-up issue.
- **New this session:** when a verification task genuinely needs to run
  a guarded command (the `full-suite-guard` hook has no way to
  distinguish a deliberate one-off check from an accidental full-suite
  run), ask the user explicitly via `AskUserQuestion` rather than either
  silently working around the guard or silently declining the task. The
  guard's own block message already says to do this; this session is the
  confirmation that asking-and-proceeding is the correct path, not a
  reason to look for another way around the hook.
- **New this session:** a negative verification result (the thing being
  checked doesn't actually work) is still a complete resolution of the
  issue that asked for verification — close it with the finding, and
  open a *new* issue for the fix, rather than leaving the original open
  "until it's actually fixed."
- **New this session:** a finding that changes the stakes of a *different*
  open issue (here: skills-pack#229's premise that `test:smoke` is
  ready to wire into a gate) is worth a short comment on that issue too,
  not just a mention in the issue actually being closed — this isn't the
  "don't announce a merge on the tracking issue" case from
  `resolve-issue`'s wrapping-up section, since #229 wasn't a
  tracking/merge issue for this session's own branch; it was a
  different issue whose correctness assumption this session's finding
  directly undermined.
