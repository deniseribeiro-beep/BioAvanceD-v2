# HANDOFF

**Written:** 2026-08-20. Picked up right after the prior rotation's "two
findings big enough to stop and check in" note (#654 storagePaths,
#655 label-route split — that rotation explicitly deferred sequencing
to Dennis rather than picking one). This sitting resolved both, found
and fixed a real regression along the way, and filed six follow-ups.

## #654 (storagePaths never written) — fixed, merge `988317bf`/`de504a23`

Docs settled the fix direction before any question was asked:
`docs/architecture/legacy-location-migration-mapping.md` names
`StoragePath.js` as the canonical target's "materialized
freezer→shelf→rack→box path" — confirming populate-on-write over
delete-the-collection. But tracing the actual write side found there's
**no live production endpoint that creates a StorageBox/StorageContainer
at all** — the only writers are a now-moot backfill script and
test-only raw-insert seed helpers. So the real fix made the *readers*
(`checkLocationBlocked`, `findStorageHierarchyForBox`) self-sufficient
instead: a new `resolveAncestorContainersLive` walks
`storageContainers.parent_id` live whenever no `StoragePath` document
exists, which is every real box today. Also transparently handles the
optional `DRAWER` level (#458) that `StoragePath`'s own schema has no
field for.

Left deliberately out of scope, filed separately: **#657** (two
cosmetic `storagePaths` display readers still show `'N/A'`).

## #655 (RF016 label route split) — fixed, merge `19889184`/`fcff884d`

The design-call framing from the prior rotation held up to a second,
harder docs pass (Dennis pushed back on the first "no docs settle this"
— rightly; the first pass checked 3 architecture/naming docs, all
tangential). The real answer was in `E2E_IMPLEMENTATION_PLAN.md` (the
actual "how to build this" doc, not just an inventory) plus milestone
#2's own description, in Dennis's own words: "Legacy/testid-less
frontend pages get rebuilt fresh, not patched." `SampleLabelPage.tsx`
is on that plan's confirmed testid-less list; its pre-RF016 code survey
already called `sample.routes.js` the richer, already-built-out
symbology surface.

Shipped: `SampleLabelPage.tsx` rebuilt with real `data-testid`s, calling
`sample.routes.js`'s real Code128/DataMatrix/QR symbology
(`/by-barcode/:barcode/symbology-assets?includePayload=true`) and a new
ported ZPL print-job route (`GET /:id/label/print-job`, so RF016's
"gerar e imprimir" requirement isn't lost). `label.routes.js` retired
entirely (mount, file, test); `intakeWizard.js`'s dead-end label links
and the dead `sampleChainApi.getLabelBlob` client method cleaned up
alongside it. **#653** (symbology-assets had no org-scope check) fixed
in the same commit, since that route became the real page's direct
dependency rather than an unreached capability.

New e2e coverage added: UI-driving tests proving the real page (not
just the API) renders real symbology and downloads a real ZPL job
(`specimen-quality-inventory.spec.ts`).

## Regression found and fixed mid-verification — `7257ea34`

Bringing the Docker stack up to verify #655 against real UI, even the
**pre-existing, untouched** RF016 API tests started failing. Root
cause: #654's new ancestor-block query, `{ $ne: 'OPERATIONAL' }`,
matches a `StorageContainer` with **no status field at all** just as
readily as an explicit `MAINTENANCE`/`RETIRED` one — every e2e seed
helper's SHELF/RACK containers hit exactly this shape (only the FREEZER
gets an explicit status, per #598's own precedent). #654's own fix
would have 422'd every real allocation attempt the moment it shipped.
Fixed with `{ $exists: true, $ne: 'OPERATIONAL' }`, matching
`StorageContainer.js`'s own Mongoose default. This also finally made
#654's ancestor-level RETIRED/MAINTENANCE blocking provable against the
real backend for the first time — new tests in
`specimen-quality-inventory.spec.ts`'s RF017 AC#7 block confirm it.

## Six follow-ups filed this sitting

- **BioAvanceD-v2#656** — `storageService.js`'s `allocateSampleToPosition`
  (and its own private `validatePositionAvailability`) is dead code
  with zero route callers, but would silently bypass RF017 AC#7 if
  anything ever wired a route to it. Not urgent (unreachable today),
  recorded so nobody's surprised later.
- **BioAvanceD-v2#657** — the two cosmetic `storagePaths` display
  readers (`getSampleStorageLocation`,
  `resolveStorageLocationsForSamples`) still show `'N/A'`/`null` for
  real boxes; deliberately out of #654's scope.
- **BioAvanceD-v2#658** — `backend-unit-runner` has no `docs/` mount at
  all, so `dictionary:validate` (already wired into its command chain
  per the earlier #530 trace) crashes with ENOENT the moment it
  actually runs. Nobody's noticed because CI's `main`-only trigger
  (#599, open) means this container has likely never really executed
  end-to-end on this branch. Will surface as a new red build the moment
  #599 lands — worth fixing before that, not after.
- **BioAvanceD-v2#659** — nothing in the app actually links to
  `SampleLabelPage` (`samples/:id/label`); it's real now but only
  reachable by typing the URL.
- **dyeallpies-skills-pack#349** — `resolve-issue`'s docs-first-before-
  asking rule doesn't mention checking GitHub Milestones, even though
  `fix-bugs`' own overlay already learned that lesson (#316). This
  session hit a third data point of the #340 pattern despite genuinely
  checking docs first — the miss was reaching the *most specific* doc.
- **dyeallpies-skills-pack#350** — the pre-action routing gate
  ("no routed workflow skill invoked yet") fired three separate times
  this sitting on actions taken *after* `fix-bugs` was already actively
  invoked and mid-execution, with no intervening compact — each
  required a no-op re-invocation just to clear it. Pure friction, no
  functional harm, but a real, repeated cost worth fixing at the source.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through both
  merges (`de504a23`, `fcff884d`). Working tree clean except the
  gitignored/junctioned `.claude/skills/` and the pre-existing untracked
  `api/backend/storage/assays/` (matches sibling `storage/samples/`/
  `storage/datasets/`, not cleaned up, not this sitting's doing).
- No PR to `main` exists.
- **Docker**: `compose.test.yml` is up — all 12 core services healthy,
  `backend-app-test`/`frontend-app-test` rebuilt through both fixes and
  re-verified on the merged tree (34/34 e2e in
  `specimen-quality-inventory.spec.ts`, 451/451 native unit tests, plus
  `backend-unit-runner`'s actual test suite at 59/60 — 1 pre-existing
  skip — before hitting #658's unrelated ENOENT). Not torn down; check
  `docker ps` before assuming either state if picking this up fresh.
- Two pre-existing dangling local branches noted (not this sitting's
  work, left untouched both times): `test/377-docs-on-main` (a single
  docs-only commit, name suggests it was meant to land on `main`
  directly), `test/human-showcase-video` (a separate demo-video
  session's work). Neither merged anywhere.

## Recommended next steps

Dennis hasn't yet said whether to continue straight to RF024 or address
anything else first. **#646** (8-RF Wave 3 tracking issue) is still the
active thread — 4 of 8 done (RF014/015/016/017), RF024/025/026/029
remaining.
