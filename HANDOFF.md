# HANDOFF

**Written:** 2026-08-18, continuation session (fifteenth update). User said
"go down a rabbit hole with 340 341 616 617 602" — **still inside the
rabbit hole**, tracker **#618** ("organization-scope enforcement + RBAC
gaps (seeds #340, #341, #616, #617, #602)"). One item landed this
sitting; four remain queued plus one filed mid-work.

## Rabbit hole state

- **Tracker:** #618, open. Working order per the tracker body: #340 →
  #341 → #616 → #617 → #602 (#341 depends on #340 anyway).
- **Landed this sitting:** #340.
- **Still queued:** #341, #616, #617, #602, plus **#619** (filed mid-work
  on #340, added to the tracker).
- Budget note from the tracker's own sizing estimate: #340+#341 both
  large, #602 needs its own design call before a fix shape exists — this
  was expected to span multiple sittings from the start.

## Issue closed this session

- **#340** ("RF003 AC#3: enforce institutionalScope on sample/patient
  list+detail endpoints"): new `requireOrganizationScope` middleware
  (`rbac.js`) resolves via `rbac-assignment.service.js#resolveUserOrganizationScope`
  (landed by #615) and gates `GET /api/samples`, `GET /api/samples/:id`,
  `GET /api/patients`, `GET /api/patients/operational`, `GET
  /api/patients/:id`. Three new helpers on `rbac-assignment.service.js`
  (`isOrganizationScopeUsable`, `applyOrganizationScopeFilter`,
  `isRecordInOrganizationScope`) do the actual query-filter/record-check
  work. Org-scoped callers see only records whose
  `collectionSite`/`clinicalUnitId` is one of their scoped organizations;
  org-less callers hard-403; an out-of-scope existing record 403s (not
  404s), matching `sample-file.controller.js`'s existing precedent;
  Administrador (hierarchyLevel 4) bypasses via `'global'` scope. Matches
  the four edge-case product decisions confirmed with Dennis 2026-08-18
  (recorded on #340's own earlier comments).

  `buildRbacCollections` (shared test factory,
  `tests/factories/rbac.factory.js`) now synthesizes
  `scopeType`/`scopeId` on its accessType-derived assignment (default
  `'test-org-default'` org for non-Administrador users) so every other
  caller across the suite keeps resolving a usable scope — this is a
  change to shared test infrastructure well beyond #340's own files,
  needed because the new real enforcement broke 4 pre-existing tests in
  `patients.expanded.api.test.js` (one fixture patient needed a matching
  `clinicalUnitId` added).

  377 targeted unit+integration tests green; full backend suite
  (367 files / 6900 tests) green. No live-Mongo tier in this repo — the
  proof bar for this backend-internal slice is mocked-Mongo
  query-matching, same precedent as #615 (see build-loop's local-env
  overlay). Merged `9312d9a2` on `feature/docker-e2e-backend-integration`,
  pushed, closed.

## Filed this session

- **#619**: sample/patient *sub-resource* and mutation routes (label,
  movements, files, `PUT /:id`, `DELETE /:id`, `GET /search`,
  `/:id/observations`, `/:id/consent/resend`, `/:id/reidentify`, etc.)
  aren't covered by #340's enforcement — only the list+detail endpoints
  named in #340's own AC are. Fix shape sketched in the issue (same
  `requireOrganizationScope` + `isRecordInOrganizationScope` pattern).
  Added to tracker #618.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after #340 landed.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
  Local branch `test/340-sample-patient-org-scope-enforcement` still
  exists (merged, not yet deleted — safe to delete).
- No Docker stack was brought up this session — #340 is a backend-
  internal slice, proof bar was mocked-Mongo tests per the build-loop
  overlay, not literal Docker/live DB.
- `migrateRoleAssignmentScopes.js` (from #615) is still unrun against any
  real database — remains a one-time ops script for whenever #340/#341's
  enforcement is about to go live in a real environment, not needed for
  either issue's own test proof.

## Recommended next steps

Continuing the rabbit hole (tracker #618), in order:
1. **#341** (reports/dashboards org-scope enforcement) — now unblocked
   (#340 landed). Hardest sub-piece: `Reports.js` has no organization
   concept at all, needs a design call on how a report's scope is
   derived (likely from the org-scope of the samples/patients it
   aggregates) before implementation — confirm with Dennis before
   building rather than guessing.
2. **#616** — auditor-role-drop bug, already fully scoped with a
   recommended fix shape in the issue body.
3. **#617** — organizationId referential-validation gap, fix shape
   already sketched (mirror `sample.service.js`'s `collectionSite`
   check).
4. **#602** — `PERMISSION_CATALOG.allowedActions` decorative-only gap.
   Explicitly flagged in its own body as needing a product/design call
   before a fix shape exists — check in with Dennis when picked up rather
   than guessing a shape.
5. **#619** — sub-resource/mutation route org-scope gap found during
   #340. Not user-requested originally but now a tracker member.
