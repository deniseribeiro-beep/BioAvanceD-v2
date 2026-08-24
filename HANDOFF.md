# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- this sitting closed **both #730 and #724** outright: #730 landed and
was verified live against a Docker stack, and its close cascaded to
#724 (the parent it was split from) since #730's fix was confirmed to
cover #724's full root-cause scope. Only **#723** remains in the queue,
and it's a substantial, not-yet-started e2e-coverage undertaking, not a
quick continuation -- stopping here rather than starting it
unannounced.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. Membership is
strictly `#723`/`#724` and their direct splits (per #725's own body) --
`#726`/`#728`/`#730` were splits off `#723`/`#724` and are all now
closed; `#724` itself is now closed too. Fresh ~10-point pacing budget
this sitting; effectively fully spent on `#730` alone (Docker bring-up,
a 5-file/26-call-site wiring change, multiple live-verification rounds,
a found-and-filed related bug, two cascading issue closes) -- large by
the rabbit-hole skill's own Step 5 table.

Queue: **#723 only** (RF008/RF013 real-backend Playwright spec work --
Definition of Done is a real-backend spec + green `test:e2e:docker`;
not started, no code exists for it yet beyond the backend-gap pieces
`#726`/`#728` already delivered from the same seed).

## What landed this sitting

**#730 (RF004/#724 equipment-fixture cleanup wiring) -- CLOSED.** Wired
`cleanupStorageBoxLocation()` (already-merged, additive helper from a
prior sitting) into every confirmed real-backend caller's teardown:
`tests/e2e-showcase/human-showcase.spec.ts` (1 site),
`tests/e2e/specimen-quality-inventory.spec.ts` (22 real call sites
across ~10 `describe` blocks, 3 of them via shared per-block helpers,
plus the RF025 test's own direct `POST /api/equipment` fixture),
`tests/e2e/sample-storage-lifecycle.spec.ts` (4 sites),
`tests/e2e/sample-files-section-ui.spec.ts` (1 site),
`tests/e2e/scientific-data-access.spec.ts` (1 helper call site invoked
8x, tracked via a shared array). Branch `test/730-storage-box-cleanup-
wiring`, merged into `feature/docker-e2e-backend-integration` @
`ada79ee8`, pushed. **Verified against a live `compose.test.yml`
stack** (Docker was brought up this sitting specifically because #730's
own issue text required it): all 59 affected tests pass, both pre- and
post-merge; direct Mongo inspection confirms zero leftover
`storageBoxes`/`storageContainers`/`equipment`/`sensors` debris after
every run.

**#724 (shared equipment-fixture accumulation, #730's parent) --
CLOSED**, cascading from #730's close per the upward-cascade check:
confirmed `seedStorageBoxLocation()` is the only helper writing directly
to the `equipment` collection, the one other direct-POST site (RF025)
is now also cleaned up, and the third equipment-referencing spec
(`inline-storage-movement.spec.ts`) only mocks the API and was never a
debris source. #724's root cause is fully closed off at the source.

**New finding filed while verifying #730: #736** -- `generateUniqueEquipmentID`
(`api/backend/src/utils/equipmentIDGenerator.js`) returns a corrupted,
non-numeric `equipmentID` (string concatenation instead of numeric
increment) whenever string-typed equipment debris -- exactly what
`seedStorageBoxLocation()` creates -- sorts highest in the collection.
Reproduced live during #730 verification: it silently broke that same
test's own equipment-cleanup call (DELETE by the corrupted string ID
400'd, swallowed by `.catch(() => {})`). Worked around in #730's own
RF025 test (delete by Mongo `_id` instead of `equipmentID`), not fixed
at the generator level -- out of #730's scope, filed separately.

## Not yet done -- still inside #725

- **#723**: none started this sitting (or any prior sitting within this
  tracker) -- needs real-backend Playwright spec work for RF008
  (Relatorios) and RF013 (Backup e restauracao), proving the backend
  pieces `#726`/`#728` already delivered actually work end-to-end
  through the real UI/API. This is the only remaining queue item.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed and up to date
  with origin as of `ada79ee8` (the #730 merge commit). This HANDOFF
  rotation is the only uncommitted change as this file is written --
  commit it before ending the sitting.
- Docker: **up** this sitting (`compose.test.yml`'s core services +
  `admin-bootstrap-test`, brought up specifically to verify #730). Left
  running -- not torn down, in case the next sitting continues straight
  into #723 while it's still warm. If picking this back up later than
  immediately, expect it to be down again and follow
  `docker-workflow`'s local-env overlay's startup recipe.
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward again.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists: **#723** is the only
remaining item. Resuming #725 means picking up #723's real-backend
Playwright spec work for RF008/RF013 (Docker is already up as of this
writing, may need re-bringing-up depending on elapsed time). Once #723
closes, #725's own upward-cascade check (`resolve-issue`'s close
discipline) applies -- confirm no further split is pending before
closing the tracker itself.
