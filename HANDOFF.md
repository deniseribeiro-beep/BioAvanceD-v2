# HANDOFF

**Written:** 2026-08-02, after closing #403 (SampleModel.create()
locationID case-mismatch fix) on `feature/docker-e2e-backend-integration`.

## What happened this session

Dennis picked "#403" directly from the prior handoff's candidate list (the
locationId/locationID case-mismatch bug found and filed while working
#400). Invoked `resolve-issue` then `fix-bugs` explicitly via the Skill
tool before acting, per the prior handoff's instruction.

Pre-pickup hygiene: no stale branch existed for #403; local
`feature/docker-e2e-backend-integration` matched origin exactly (no
carried-over unpushed commits this time). Branched
`fix/403-sample-locationid-case-mismatch` off the integration branch per
convention (`fix/<slug>` for bug-fix work, per `bioavanced-v2-conventions`).

**Root cause, confirmed by tracing every real consumer:**
`SampleModel.create()` (`api/backend/src/models/Sample.js`) built its
returned/persisted object from `data.locationId` (lowercase d, matching
the Mongoose schema's declared field at line 39) instead of
`data.locationID` (capital ID) — but `sample.service.js`'s
`createSample()` always normalizes and sets `sampleData.locationID`
(capital ID) after validating it against the `locations`/`sensors`
collections (a required, sensor-validated gate). Since `create()` never
reads the field under that name, every sample ever created persisted with
no `locationID` field at all, despite the field being required and
validated at creation time.

Traced every real reader of the returned/persisted sample document before
fixing (not just the issue's own text) to confirm the *correct* target
key, since the issue's fix description ("rename `data.locationId` to
`data.locationID`") was ambiguous about whether the object's key or just
its value-source needed to change: `sample.service.js`'s own
ledger-movement write (`sample.locationID` at line 256),
`intakeWizard.js` (sets `sampleToPersist.locationID`, capital, at the
real intake call site), and the frontend (`SampleDetailsPage.tsx`,
`types/models.ts`) all exclusively use `locationID` (capital ID) — nothing
in the codebase reads the lowercase `locationId` key on a `Sample`
document. So the fix renamed **both** the key and the read source to
`locationID`, not just the read source alone; a value-only fix would have
left the persisted key as `locationId`, which nothing downstream reads,
and the bug would have remained functionally unfixed under a different
key name. Confirmed via reproduction: added a regression test in
`sample.service.test.js` asserting `insertOne`'s argument carries the
validated `locationID` — it failed against the pre-fix code (`undefined`
vs `7`) and passes after the one-line fix.

**Changes:** `api/backend/src/models/Sample.js` line 155 — key+value
renamed from `locationId: data.locationId ?? null,` to
`locationID: data.locationID ?? null,`. Added one regression test to
`sample.service.test.js`. Left the Mongoose schema's own field
declaration (`locationId: { type: Number, default: null }`, line 39)
untouched — confirmed it's inert for this flow (creates/reads go through
the native MongoDB driver via `db.collection('samples')`, not the
Mongoose model; the one place the Mongoose `Sample` model is actually
queried, `miabisValidator.service.js`, never touches location fields) —
fixing it wasn't required for correctness and was out of the issue's
scope, so left as-is rather than a drive-by cleanup.

164 targeted tests pass across `sample.service.test.js` (82, incl. the
new one), `sample.models.test.js`, `sample.model.unit.test.js`,
`sample.model.gaps.test.js`, `sample.api.test.js` (integration), and
`intakeWizard.routes.test.js`. Backend lint (`node scripts/lint.js`, 311
files) clean.

**Found and filed separately (not part of #403's scope — this pack's own
hook mechanics, not a BioAvanceD-v2 finding):**
[dyeallpies-skills-pack#198](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/198)
— `full-suite-guard.cjs`'s targeting check splits captured trailing args
on bare whitespace with no shell-quoting awareness, so a genuinely
targeted single-file vitest run gets false-positive-blocked when paired
with a quoted multi-word `-t "some words"` filter (each word becomes a
stray non-extension pathToken, failing the "every pathToken looks like a
file" check). Hit live this session while trying to run the reproduction
test narrowly; worked around by dropping `-t` and running the whole file
(cheap here, file is small). Not fixed inline — `.claude/hooks/` in this
repo is pack-deployed (Rule 0), so filed against the pack repo instead of
edited through the junction.

**Workflow friction this session:** the hook false-positive above (its
own destination is the pack issue, not a rule change here). No scope
creep, no lazy fixes — the only files touched were `Sample.js`,
`sample.service.test.js`, plus this rotation.

## Repo state

- **`feature/docker-e2e-backend-integration`**: #403's fix merged
  (`git merge --no-ff`, commit `b37600ef`; the fix commit itself is
  `5f601172`) and pushed to origin. Branch
  `fix/403-sample-locationid-case-mismatch` merged, closed out, deleted
  (local + remote — both deletes went through clean this session, no
  classifier block). This HANDOFF rotation landed on a fresh
  `test/403-handoff-rotation` branch — `edit-branch-guard.cjs` blocked
  the first attempt to write it directly on
  `feature/docker-e2e-backend-integration`, confirming (not
  contradicting) the standard rule: HANDOFF.md is a normal root-level
  doc, not exempt via any `.claude/`-adjacent-maintenance carve-out —
  should be merged in and the branch deleted once this commit lands,
  same as prior rotations.
- Issues: **#403 closed** (merge to main still pending — noted explicitly
  in the close comment, consistent with every prior rotation). **#389
  open** (tracking issue for the storage/custody series, unchanged).
  **#398, #399, #401, #402 all still open, all unstarted** (unchanged
  from prior handoff).
- Pack repo (`dyeallpies-skills-pack`): new issue **#198** filed (hook
  false-positive, see above). Not this repo's concern to resolve.
- No other branches created, merged, or deleted this session.
- Untouched from before: `test/392-specimen-preanalytics-canonical-fields`
  (merged, from an earlier session) — still presumed on origin, not
  re-checked this session. Older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`, `#384`-`#387`) also untouched. Local branch hygiene otherwise
  unchanged: everything merged except `test/377-docs-on-main`, tracked by
  still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis this session — he asked only to
pick up #403. Candidates (unchanged from prior handoff, minus #403 which
is now done):

- **#398** — no dependency, but is itself a blocker for #399 (design
  decision: collapse `lifecycleStatus`/`availabilityStatus`/
  `quarantineStatus` into `Specimen.specimenStatus`).
- **#401** — no dependency, likely near-trivial (confirm ledger-backed
  quantity fields are already correct; probably naming-only or no-op).
- **#402** — no dependency, low priority (`StorageAssignment`
  placement-history feature gap, not cleanup).
- **#399** — **blocked on #398** until that decision is recorded.
- Older backlog, all unchanged from prior handoffs: **#384–#387** (four
  architecture-gap issues), `#371`/`#373`/`#374`/`#378`/`#379`.

## Which skills to use

- **Whichever of #398/#399/#401/#402 is picked up next: invoke
  `resolve-issue` (and `fix-bugs` if it's a bug, not a build/design item)
  via the Skill tool explicitly before acting** — same rule as every
  prior handoff, still holding.
- **#390** (multi-consumer migration once RCS/SPREC/storage-custody
  entities land): still blocked on #398/#399/#401.
- Backlog unchanged otherwise from prior handoffs: **#384–#387**, older
  backlog (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session.
