# HANDOFF

**Written:** 2026-08-18, continuation session (sixteenth update). User said
"go down a rabbit hole with 340 341 616 617 602" — **still inside the
rabbit hole**, tracker **#618** ("organization-scope enforcement + RBAC
gaps (seeds #340, #341, #616, #617, #602)"). Two large items landed this
sitting (#340, #341); budget note below.

## Rabbit hole state

- **Tracker:** #618, open. Original working order: #340 → #341 → #616 →
  #617 → #602 (#341 depended on #340).
- **Landed this sitting:** #340, #341.
- **Still queued:** #616, #617, #602, plus **#619**, **#620**, **#621**
  (all filed mid-work, added to the tracker as they were found).
- **Budget note:** the tracker's own sizing estimate flagged #340+#341 as
  both "large" (~10 points combined) against a ~10-point sitting budget —
  this sitting's two closes already spend that budget on the rabbit-hole
  skill's own advisory scale. Next session: recompute before continuing,
  don't assume a fresh full budget just because it's a new sitting if
  picking up mid-session — but do treat a fresh session as a fresh
  ~10-point allowance per the skill's normal pacing.

## Issues closed this session

- **#340** ("RF003 AC#3: enforce institutionalScope on sample/patient
  list+detail endpoints"): new `requireOrganizationScope` middleware
  (`rbac.js`) + three helpers on `rbac-assignment.service.js`
  (`isOrganizationScopeUsable`, `applyOrganizationScopeFilter`,
  `isRecordInOrganizationScope`). Gates `GET /api/samples`, `GET
  /api/samples/:id`, `GET /api/patients`, `GET /api/patients/operational`,
  `GET /api/patients/:id`. Org-scoped callers see only records whose
  `collectionSite`/`clinicalUnitId` is one of their scoped organizations;
  org-less callers hard-403; out-of-scope existing records 403 (not 404);
  Administrador (hierarchyLevel 4) bypasses via `'global'` scope. Shared
  test factory `buildRbacCollections` now synthesizes `scopeType`/
  `scopeId` by default (`'test-org-default'` org for non-Administrador
  users) so pre-existing callers across the suite keep resolving a usable
  scope. 377 targeted tests green, full suite (367 files/6900 tests)
  green. Merged `9312d9a2`, closed.

- **#341** ("RF003 AC#3: enforce institutionalScope on reports +
  dashboards"): design call confirmed with Dennis before implementation
  (the issue's own body flagged this as needed) — only report types
  rooted in samples/patients (`amostra`/`sample`, `paciente`/`patient`,
  `samplesbypatient`, `sampleanalysis`,
  `tissueoriginhistory`/`extracellularnetwork`) enforce org-scope in
  `reports.routes.js`'s `POST /generate`, `POST /:type/preview`, `GET
  /:type/export`, `GET /:type/export/pdf`; non-sample-rooted types
  (temperature, sensor, equipment, results, access logs) are left
  unscoped — `resolveUserOrganizationScope` is only invoked when the
  resolved type actually needs it, not on every request (a first design
  pass that resolved it unconditionally broke unrelated tests, caught and
  redesigned before landing). Confirmed dashboards inherit #340's scoping
  for samples/patients but not results (`GET /api/results` untouched by
  either issue). Fixed a real bug found along the way: the patient-rooted
  branches' query fell through to unfiltered `{}` when no other filter was
  given and zero samples matched — fixed with a direct `clinicalUnitId`
  push, not reliance on the indirect sample-derived path alone. 78
  targeted tests green (65 existing + 13 new), full suite (367
  files/6913 tests) green. Merged `e5087f00`, closed.

## Filed this session

- **#619**: sample/patient sub-resource/mutation routes (label,
  movements, files, `PUT /:id`, `GET /search`, etc.) aren't covered by
  #340's enforcement.
- **#620**: `reports.routes.js`'s `withdrawalhistory` report type reads a
  `withdrawals`/`withdrawalHistory` collection nothing in the codebase
  ever writes to — dead code, found during #341, unrelated to org-scope.
- **#621**: non-sample-rooted report types, saved-Report listing (`GET
  /api/reports`, `GET /api/reports/:id`), and `GET /api/results` directly
  have no organization reference anywhere — same shape as #619.
- **dyeallpies-skills-pack#335** (not a BioAvanceD-v2 issue): `Glob` with
  no explicit `path` returned "no files found" for a file that exists,
  suspected tied to a prior Bash `cd` changing the tool's effective cwd.
  Medium confidence, flagged for someone to deliberately reproduce.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after both #340 and
  #341 landed. Working tree clean except the gitignored/junctioned
  `.claude/skills/`. Local branches
  `test/340-sample-patient-org-scope-enforcement` and
  `test/341-reports-dashboards-org-scope-enforcement` still exist (both
  merged, not yet deleted — safe to delete).
- No Docker stack was brought up this session — both #340 and #341 are
  backend-internal slices, proof bar was mocked-Mongo tests per the
  build-loop overlay, not literal Docker/live DB.
- `migrateRoleAssignmentScopes.js` (from #615) is still unrun against any
  real database — one-time ops script for whenever this enforcement goes
  live in a real environment, not needed for any issue's own test proof.

## Recommended next steps

Continuing the rabbit hole (tracker #618), in order:
1. **#616** — auditor-role-drop bug, already fully scoped with a
   recommended fix shape in the issue body.
2. **#617** — organizationId referential-validation gap, fix shape
   already sketched (mirror `sample.service.js`'s `collectionSite`
   check).
3. **#602** — `PERMISSION_CATALOG.allowedActions` decorative-only gap.
   Explicitly flagged in its own body as needing a product/design call
   before a fix shape exists — check in with Dennis when picked up rather
   than guessing a shape, same as #341 needed.
4. **#619** — sample/patient sub-resource/mutation route org-scope gap.
5. **#620** — dead-code withdrawal-history report type.
6. **#621** — non-sample-rooted org-scope gap (temperature/sensor/
   equipment/results/logs report types, saved-report listing, GET
   /api/results).

Given the budget note above, this is a reasonable point for the user to
decide whether to continue the hole in the same sitting or resume later
— #616/#617 are both small-to-medium and already-scoped, a natural next
pair; #602/#619/#620/#621 can wait for a fresh sitting's budget.
