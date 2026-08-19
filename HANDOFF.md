# HANDOFF

**Written:** 2026-08-19, later same day as the prior rotation.
**#638 and #639 -- the two loose threads from tracker #618's sitting --
are both closed.** Both were "owner's dead-code-vs-wire-in call"
questions; both got answered directly from `docs/docs-7-31-2026/` and
`docs/architecture/` before asking Dennis to confirm, per
`resolve-issue`'s docs-first rule.

## What landed this sitting

- **#638**: `Equipment.schema.js` (the unused Mongoose model) confirmed
  as abandoned scaffolding, not unfinished wiring --
  `docs/architecture/legacy-location-migration-mapping.md` treats
  `Equipment.equipmentID` (the hand-rolled `Equipment.js` model real
  callers use) as canonical and never references this file's fields;
  no doc anywhere describes a Mongoose-based Equipment model. Also
  confirmed `SensorMetadata.schema.js`'s `ref: 'Equipment'` is never
  populated (only `'temperaturePolicy'`/`'device'` are -- see
  `iot.controller.js`'s explicit registration-requirement comments), so
  deleting it broke no runtime path. Deleted `Equipment.schema.js`;
  trimmed only the Equipment-specific require + describe block from
  `schema-models.gaps.test.js` (that file also covers
  Cid/Disease/DrugDictionary/TemperaturePolicy, so the whole file
  stayed). Branch `fix/638-equipment-schema-dead-code`, commit
  `38691810`.
- **#639**: `useTemperature.ts`'s `createTemperature` confirmed dead --
  `docs/docs-7-31-2026/1-Requisitos-Funcionais-e-Nao-Funcionais.md`'s
  RF009 assigns temperature-telemetry collection exclusively to
  "Sistema" (automated sensor path via the IoT self-reporting
  endpoint), no requirement describes a manual/Coordenador entry flow,
  and no newer doc batch or the v3 planning docs mention one either.
  Removed the frontend wrapper only; the backend
  service/controller/routes it called are untouched and still live.
  Branch `fix/639-usetemperature-createtemperature-dead-code`, commit
  `34801514`.

Both merge commits landed on `feature/docker-e2e-backend-integration`
(pushed `1d7e84d2`), both source branches deleted locally (never
pushed remotely, so no remote delete needed). Both issues closed with
comments citing the doc evidence and commit/test results.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `1d7e84d2`
  (the #638 and #639 merges) plus this HANDOFF rotation. Working tree
  clean except the gitignored/junctioned `.claude/skills/`.
- **Only targeted native tests run this sitting, not the full suite** --
  both fixes are small, surgical deletions with no cross-cutting
  surface, so this stayed at the per-iteration tier per the
  conventions skill's gate order:
  - Backend: `npx vitest run tests/unit/schema-models.gaps.test.js`
    (16/16 green) + `npm run test:architecture` (60/60 green), run
    twice -- once on each fix branch, once again on the merged
    integration branch.
  - Frontend: `npx tsc --noEmit` (clean) + `npm run test:unit` (87/87
    green), same twice-run pattern.
  - **The full native suite (`--coverage` backend run, frontend
    `typecheck:full`, etc.) has NOT been re-run since the previous
    HANDOFF's confirmed-green sitting** -- if picking this up next,
    that's still the last full-suite confirmation on record, now two
    small commits stale.
- **Docker/CI gate not run this sitting** -- same as always, that's
  `ship-integration-branch`'s job, not asked for yet. No PR to `main`
  exists.
- **#628's migration script (`backfillResultSpecimenIds.js`) still has
  not been run against any real environment** -- older than this
  sitting, still outstanding, unrelated to #638/#639.
- Stale local+remote branch `fix/599-ci-trigger-integration-branch`
  (unrelated, still-open issue #599) still noted in passing, never
  touched.

## Recommended next steps

None queued -- Dennis didn't name a next issue this sitting. If picking
this repo back up:
1. Re-check the open backlog fresh (`gh issue list --state open`) --
   no rabbit hole or named queue is currently in flight.
2. Consider a full native-suite re-run before treating the branch as
   verified-green end-to-end, since only targeted tests ran on top of
   the last full-suite confirmation.
