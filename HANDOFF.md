# HANDOFF

**Written:** 2026-08-19, fresh sitting (thirty-second update). **Still
inside the rabbit hole**, tracker **#618** ("organization-scope
enforcement + RBAC gaps"). Dennis's requested pickup order this sitting
-- **#630 -> #631 -> #628 -> #629** -- is now fully complete: #630/#631/
#628 landed with code, and #629 was resolved by splitting into four
sized sub-issues (#634-#637) rather than implemented directly, since
research surfaced it was bigger and more design-dependent than its own
body already flagged. No further item named for a next sitting.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #630 (fully resolved), #631 (fully resolved,
  depended on #630), #628 (fully resolved, turned out larger than
  scoped -- a field rename, not just a value fix), #629 (resolved by
  splitting into #634/#635/#636/#637, not implemented this sitting).
- **Filed this sitting:** #632 (unenforced manageBackup/manageSystem/
  resetMFA permission codes, found during #630), #633 (reports.routes.js
  reads a nonexistent Sample.sampleID field, found during #628), #634
  (Sensor.organizationId), #635 (Equipment.organizationId), #636
  (Temperature.organizationId, no backfill), #637 (Report.organizationId,
  stamp-going-forward + hide legacy from org-scoped users). All six
  added to this tracker's thread on filing. Also filed two skills-pack
  issues (not part of this tracker): dyeallpies-skills-pack#339
  (edit-branch-guard.cjs failed to fire once on a protected-branch edit)
  and dyeallpies-skills-pack#340 (AskUserQuestion should be preceded by
  a docs check, not followed by one -- filed after Dennis redirected two
  separate design-call questions back to "check docs" this same
  sitting). Neither needs action from a BioAvanceD-v2 session.
- **Still queued:** none in the user's named order -- it's complete.
  #632/#633/#634/#635/#636/#637 remain open as lower-priority tracker
  members; recompute against the tracker fresh (per rabbit-hole skill's
  own budget/re-scoping guidance) before picking any of them up. Note
  #635 (depends on nothing) and #634 (depends on nothing) are the most
  "ready" of the four org-reference issues -- #636/#637 each carry their
  own already-resolved backfill/visibility design call, so all four are
  actually implementation-ready, just not yet picked up.

## Issue closed this sitting (most recent)

- **#629**: split, not implemented. Research (agent-assisted) found no
  existing join path -- direct or indirect -- from Sensor/Equipment/
  Temperature/Report to Organization (the Facility/Room/StorageContainer
  hierarchy has no Organization anchor of its own), so each needs a
  genuinely new `organizationId` field mirroring the established
  `Sample.collectionSite`/`Patient.clinicalUnitId` pattern (a plain
  string holding `Organization.organizationId`, not a Mongoose ref) --
  not a query fix. Each entity has a materially different backfill
  story, resolved via docs rather than asking Dennis directly (F3-G09,
  `docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`):
  Sensor/Equipment have nothing to derive an org from at all (no
  backfill possible); Temperature has free-text facility/zone that could
  be fuzzy-matched but was decided against (a wrong match would cause
  exactly the cross-org exposure F3-G09 prohibits -- leave existing
  readings null instead); saved Report documents can't be backfilled at
  all (only newly-generated reports get stamped going forward; existing
  ones must be hidden from organization-scoped users per the same
  F3-G09 reasoning). See #629's own close comment and #634-#637's
  bodies for full detail. No code changed for this issue.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through
  `a0ecd86f` (the #628 merge + its HANDOFF rotation; #629 produced no
  code, so no further push). Working tree clean except the
  gitignored/junctioned `.claude/skills/`. No stale local branches --
  every fix branch this sitting (`fix/630-...`, `fix/631-...`,
  `fix/628-...`) merged and deleted immediately after landing.
- Full native unit+frontend suite not re-run in full this sitting --
  each issue's own targeted suite ran green after every merge (#630:
  46/46, #631: 181/181, #628: backend 444/444 + frontend `tsc --noEmit`
  clean). Run the full suite at the next Docker/CI gate before shipping
  this branch further.
- **#628's migration script (`backfillResultSpecimenIds.js`) has not
  been run against any real environment** -- no Docker/live-Mongo tier
  was brought up this sitting. Run it as part of deploying #628's
  change, before or alongside the next environment that has real Result
  documents with the legacy `sampleID` shape.

## Recommended next steps

No specific issue named by the user for a future sitting -- the
requested order is fully done. Candidates from the tracker, roughly in
readiness order:
1. **#634/#635** (Sensor/Equipment.organizationId) -- no backfill
   question, no design call left open, straightforward schema-add +
   route-wiring + frontend picker. Most "ready" of the six.
2. **#636** (Temperature.organizationId) -- same shape, backfill
   decision already recorded (none).
3. **#637** (Report.organizationId) -- same shape but the write site is
   report-generation time, not a CRUD form; visibility decision for
   legacy reports already recorded.
4. **#632** (unenforced manageBackup/manageSystem/resetMFA) -- needs a
   scope decision (wire through requirePermission vs. confirm the
   hardcoded requireRole(4)/isAdministrator checks are intentional)
   before implementation.
5. **#633** (sampleanalysis report type reads nonexistent
   Sample.sampleID) -- small, mechanical, no design call needed.

Recompute the sitting's budget fresh before picking any of these up --
this sitting's spend doesn't carry over, per the rabbit-hole skill's own
guidance. This sitting ran three "large" items back to back
(#630/#631/#628) before checking in, which is over budget by the
skill's own ~10-point guideline -- worth pacing more conservatively next
time rather than repeating that pattern by default.
