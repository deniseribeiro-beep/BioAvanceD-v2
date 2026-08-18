# HANDOFF

**Written:** 2026-08-18, fresh sitting (twenty-seventh update, budget
reset to zero for this sitting). **Still inside the rabbit hole**,
tracker **#618** ("organization-scope enforcement + RBAC gaps"). User
requested a specific pickup order this sitting: **#621 -> #602 -> #626
-> #625**. #621, #602, and #626 all landed; **#625 next (last in the
requested order)**.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #621 (partial), #602 (split), #626 (fully
  resolved).
- **Filed this sitting:** #628, #629, #630, #631 (all still open, lower
  priority than the user's named order).
- **Still queued, in the user's stated order:** #625 (last one).
- **Also open in the hole:** #628, #629, #630, #631.

## Issue closed this sitting (most recent)

- **#626**: `patient.routes.js`/`paciente.controller.js` sub-resource,
  mutation, and search routes now enforce organization scope —
  `GET/POST /:id/observations`, `PUT /:id`, `DELETE /:id`,
  `POST /:id/consent/resend`, `POST /:id/reidentify` all use the
  `requireOrganizationScope` + `isRecordInOrganizationScope` (post-fetch,
  403 on mismatch) pattern against `clinicalUnitId`, mirroring
  `sample.routes.js`'s already-fixed sub-resource routes. `GET /search`
  got a query-level fix instead — `applyOrganizationScopeFilter` merged
  into `patient.service.js#searchPatients`' own `$or` query (a separate
  code path from `listPatients`, which already had this). Six
  pre-existing tests in `patients.expanded.api.test.js` needed a
  `clinicalUnitId: 'test-org-default'` fixture fix (the coordinator test
  user resolves an `'organization'` scope by default via
  `buildRbacCollections`, so patient fixtures with no `clinicalUnitId`
  now correctly 403 as out-of-scope — matches the same-shape fixture
  fix #619/#623/#624 needed on the sample side). Several
  `paciente.controller.test.js` tests needed a
  `patientService.getPatient` mock added since the controller now
  pre-fetches for the scope check. Merged `4dbe9a88`, pushed. Full
  native suite green (6930/6930) after merge.
- See prior HANDOFF entries in git history for #621/#602's own closing
  detail (this rotation only tracks state changes since #602's landing,
  per the "overwrite, don't accumulate" rule — search `git log -- HANDOFF.md`
  if the earlier detail is needed).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `4dbe9a88`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
  No stale local branches this sitting — `fix/621-...` and `fix/626-...`
  both merged and deleted immediately after landing.
- Full native unit+integration suite run twice this sitting (once after
  #621, once after #626): both green, no unrelated regressions.
- No Docker stack brought up this sitting.

## Recommended next steps

**#625 next** (last in the user's stated order): `sample.routes.js`'s
`/:specimenId/files/*` family (`sample-file.controller.js`) doesn't
enforce org-scope. Per the issue body, this needs a design decision on
*which layer* owns the check — the controller currently has zero
`rbac-assignment.service.js` dependency, so it's either (a) add
`requireOrganizationScope` + a per-handler scope check inside
`sample-file.controller.js` itself, or (b) add shared middleware at the
`sample.routes.js` route-registration layer ahead of the controller
delegation. This reads as an implementation-style call more than a
product/data-model question `docs/` would settle (unlike #621/#602) —
check `docs/architecture/` briefly for any stated layering convention
before treating it as needing Dennis's input, but expect this one may
just need a judgment call made and stated in the close comment, per
`bioavanced-v2-conventions`' "check docs first" habit this sitting has
been applying successfully.

After #625, no further items are in the user's named order — recompute
against the tracker's remaining members (#628/#629/#630/#631) fresh,
per the rabbit-hole skill's budget/re-scoping guidance, before continuing
further in this or a future sitting.
