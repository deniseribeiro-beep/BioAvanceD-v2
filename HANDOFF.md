# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after resolving #513.

## What happened this session

Dennis said "pick #513" — the owner-call question carried forward from
the prior handoff (whether `ship-integration-branch`'s gate should add a
lightweight smoke pass to catch silent cross-file breaks like #507's,
which slipped past `sample.service.test.js` until #510). **Routing:**
`work-issue` → `resolve-issue`. Per `work-issue`'s trigger for a carried
"needs owner call" claim with no matching label, checked `docs/` first
(per #512's precedent) — no doc settles a repo-process/tooling question
like this, unlike #512's data-contract question, so this one genuinely
needed Dennis's call. Asked via `AskUserQuestion`: **Dennis chose "add
smoke pass."**

**What landed:** added `npm run test:smoke`
(`vitest run --changed=origin/main --passWithNoTests --reporter=dot`) to
`api/backend/package.json` — vitest's import-graph `--changed` mode,
meant to catch a shared-module break without a full suite run. Branch
`fix/513-smoke-check-script` created, committed (`80916e4d`), merged into
`feature/docker-e2e-backend-integration` (merge commit, pushed at
`1216ae7a`), local branch not yet deleted (see below). Issue #513 closed
with a comment.

**Could not fully resolve in this repo:** wiring the new script into
`ship-integration-branch`'s actual gate procedure means editing pack-owned
files (`skills/ship-integration-branch/SKILL.md` and its
`local-env/BioAvanceD-v2.md` overlay), which Rule 0 forbids from a
consuming-project session. Filed
[skills-pack#229](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/229)
with the exact text to apply from a pack-repo session.

**Also could not verify in this repo:** running `test:smoke` (even in
`--changed` form) trips this repo's per-iteration full-suite guard, so
the command was added but never actually exercised against a synthetic
cross-file break this session. Filed
[#514](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/514) to
track that verification (confirm vitest's `--changed` walks this repo's
CommonJS import graph correctly, and reproduce a #507-shaped break to
confirm it's actually caught) before anyone treats `test:smoke` as a
trustworthy gate step.

`wrap-up` ran: two findings, both filed as issues above rather than left
in chat (skills-pack#229 for the orchestration/gate-wiring gap, #514 for
the unverified-script gap). No scope creep — only `package.json` touched.

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed to origin at
  `1216ae7a` (merge commit for `fix/513-smoke-check-script`). Clean, up
  to date with origin.
- **`fix/513-smoke-check-script`**: merged and closed out; local branch
  still present, not yet deleted this session — safe to delete next
  session (`git branch -d fix/513-smoke-check-script`).
- Issues this session: **#513 closed**. **New:** skills-pack#229 (open,
  pack-repo work), BioAvanceD-v2#514 (open, verification needed).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (not re-verified this session except #513,
now resolved):

**#514** (new, this session) — verify `test:smoke` actually catches a
#507-shaped break before trusting it as a gate step. Natural pairing
with whoever next touches a shared repository/service/use-case file.

**skills-pack#229** (new, this session) — only actionable from a
pack-repo session, not this one. Wires `test:smoke` into
`ship-integration-branch`'s documented gate procedure.

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
  `fix/512-quarantine-storage-scope-not-applicable` — all safe to
  delete, low priority housekeeping; `fix/513-smoke-check-script` now
  joins this list, merged this session).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread once skills-pack#227 lands the new spec in the inventory.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit.

## Dev stack state

Nothing started this session. `package.json` script addition only, no
code/tests run (blocked by the full-suite guard — see #514).

## Which skills to use

- `work-issue` → `resolve-issue`: confirmed again this session that a
  carried "needs owner call" note is a trigger to re-check `docs/`
  first, but that check can legitimately conclude "no doc settles this,
  ask Dennis" — #512's doc-answered case and #513's genuinely-owner's-call
  case are both real outcomes of the same check, not a bias toward one
  answer.
- **New this session:** a resolution that requires editing a pack-owned
  skill/overlay file cannot be completed in one sitting from a consuming
  project — Rule 0 means the actual procedural change has to be filed as
  a pack issue and picked up from a pack-repo session. `resolve-issue`'s
  close-discipline case 2 ("partially resolved / scope differed")
  applied: the product-repo half (the `test:smoke` script) shipped and
  closed #513; the workflow-procedure half is tracked separately in
  skills-pack#229.
- **New this session:** a newly-added `test:*`-named script cannot be
  self-verified in the same session that adds it, because this repo's
  full-suite guard matches on script name regardless of args (`--changed`
  included). Filed the verification as its own follow-up (#514) rather
  than claiming the script works untested.
