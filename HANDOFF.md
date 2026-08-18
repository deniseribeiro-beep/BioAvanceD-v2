# HANDOFF

**Written:** 2026-08-18, fresh sitting (twenty-eighth update). **Still
inside the rabbit hole**, tracker **#618** ("organization-scope
enforcement + RBAC gaps"). Dennis's requested pickup order this sitting
— **#621 -> #602 -> #626 -> #625** — is now fully complete; all four
landed/resolved. No further item named for a next sitting.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #621 (partial, Result report-type scoped),
  #602 (split into #630/#631), #626 (fully resolved), #625 (fully
  resolved — last in the requested order).
- **Filed this sitting:** #628 (bug), #629 (enhancement), #630
  (foundational), #631 (depends on #630). All four still open, none
  requested for pickup yet.
- **Still queued:** none in the user's named order — it's complete.
  #628/#629/#630/#631 remain open as lower-priority tracker members;
  recompute against the tracker fresh (per rabbit-hole skill's budget/
  re-scoping guidance) before picking any of them up.

## Issue closed this sitting (most recent)

- **#625**: `sample.routes.js`'s `/:specimenId/files/*` family
  (`sample-file.controller.js`) now enforces organization scope across
  all 7 routes (upload, list, download, delete, export/hl7, export/fhir,
  export/cda). Layering decision mirrored #626's split from earlier this
  same sitting rather than re-deriving: `requireOrganizationScope`
  middleware at the route-registration layer, the actual post-fetch
  `isRecordInOrganizationScope` check (against `Sample.collectionSite`)
  inside each controller handler. `downloadFile`/`deleteFile` didn't
  previously fetch the `Sample` document at all — both now do, solely
  for the scope check; a failed/missing lookup doesn't block the request
  on its own. Merged `3efa2312`, pushed. Full native suite green
  (6938/6938) after merge.
- See prior HANDOFF entries in git history (`git log -- HANDOFF.md`) for
  #621/#602/#626's own closing detail — this rotation only tracks state
  changes since #626's landing, per the "overwrite, don't accumulate"
  rule.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `3efa2312`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
  No stale local branches — every fix branch this sitting merged and
  deleted immediately after landing (`fix/621-...`, `fix/626-...`,
  `fix/625-...`; #602 needed no branch, no code change).
- Full native unit+integration suite run three times this sitting (after
  #621, after #626, after #625): all green, no unrelated regressions
  found or introduced.
- No Docker stack brought up this sitting — all fixes are
  backend-internal, mocked-Mongo/mocked-Express proof bar only. One
  Playwright e2e spec (`scientific-data-access.spec.ts`) touches the
  files-family routes #625 changed, but authenticates as Administrador
  (global scope, unaffected by the new check) and requires the Docker
  compose stack to run at all — not exercised this sitting, worth a
  quick check at the next Docker/CI gate if picked up.

## Recommended next steps

No specific issue named by the user for a future sitting — the
requested order (#621/#602/#626/#625) is fully done. Candidates from the
tracker, roughly in readiness order:
1. **#630** — audit + correct `PERMISSION_CATALOG`'s `allowedActions`
   for all 17 permission codes/107 call sites. Foundational, no behavior
   change, mechanical — the most "ready" of the four.
2. **#631** — depends on #630; the actual per-verb enforcement change.
   Likely needs its own `divide-and-conquer` split once started (two
   implementation-shape options already sketched in its body).
3. **#628** — `Result.sampleID` inconsistent-shape bug; #621's fix
   already works around it defensively, so this is lower urgency than it
   sounds, but still a real gap for other Result joins.
4. **#629** — Sensor/Equipment/Temperature/saved-Report org-scope; needs
   Dennis's design call (confirmed not docs-answerable this sitting).

Recompute the sitting's budget fresh before picking any of these up —
this sitting's spend doesn't carry over, per the rabbit-hole skill's own
guidance.
