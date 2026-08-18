# HANDOFF

**Written:** 2026-08-18, fresh sitting (twenty-fifth update, budget reset
to zero for this sitting per the prior sitting's own recommendation).
**Still inside the rabbit hole**, tracker **#618** ("organization-scope
enforcement + RBAC gaps"). User requested a specific pickup order this
sitting: **#621 -> #602 -> #626 -> #625**. #621 landed (partial); #602
next.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #621 (partial — Result report-type org-scope
  resolved; rest split to #629).
- **Filed this sitting:** #628 (bug: `Result.sampleID` stores
  inconsistent shapes depending on write path), #629 (enhancement:
  Sensor/Equipment/Temperature report types + saved Report documents
  still unscoped, needs a design call).
- **Still queued, in the user's stated order:** #602, #626, #625.
- **Also open in the hole (not in this sitting's requested order, lower
  priority):** #629 (just filed), #628 (bug, filed this sitting — not
  itself an org-scope item, but filed against the same tracker's
  investigation).

## Issue closed this sitting

- **#621** (partial): `reports.routes.js`'s `resultado`/`result` report
  type now enforces organization scope by joining through the linked
  Sample's `collectionSite` — `Result.sampleID` references a Sample via
  either its Mongo `_id` or `specimenId` (inconsistent, see #628), so the
  join checks both, mirroring `SampleDetailsPage.tsx`'s own defensive
  frontend lookup. An org-less caller now 403s on this report type like
  the other sample/patient-rooted types. Merged `ac34bab6`
  (`fix/621-result-report-type-org-scope` ->
  `feature/docker-e2e-backend-integration`), pushed. Sensor/Equipment/
  Temperature/saved-Report scoping split to **#629** (none of those
  entities have any org-bearing reference anywhere, confirmed via a docs
  check against dict-02/requisitos-index/F3-G09 — genuinely needs a
  design call, not docs-answerable).

## Filed this sitting

- **BioAvanceD-v2#628** (bug, open): `Result.sampleID` stores either the
  Sample's Mongo `_id` or its `specimenId` depending on write path
  (`result.routes.js` `POST /upload` vs `POST /`) — #621's fix works
  around it defensively but every other Result join has the same latent
  gap. Also flags that the pre-existing `sampleanalysis` report type's
  own Result join (`reports.routes.js` ~line 464) reads a `sample.sampleID`
  field that doesn't exist on the canonical `Sample` model at all — likely
  a silently-broken join, worth checking.
- **BioAvanceD-v2#629** (enhancement, open): the un-fixable remainder of
  #621 — Sensor/Equipment/Temperature report types and saved Report
  documents have no organization-bearing reference anywhere, confirmed
  via docs (not doc-answerable), needs Dennis's design call same as the
  now-closed #621 originally did.
- **dyeallpies-skills-pack#338** (not a BioAvanceD-v2 issue):
  `bioavanced-v2-legacy`'s doc-authority pointer only mentions
  `docs/architecture/`/`docs/inventory/`, not the newer, higher-authority
  `docs/docs-7-27-2026/extracted/` that `bioavanced-v2-conventions` already
  points to (since 2026-08-04, issue #205) — stale cross-reference between
  two skills in the same pack. Also carries a concrete confirmed case: the
  legacy models actually in code (Result/Sensor/Equipment/Temperature/
  Reports) have no corresponding entity in the canonical dict-02 dictionary
  at all.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after #621's merge
  (`ac34bab6`). Working tree clean except the gitignored/junctioned
  `.claude/skills/`. `fix/621-result-report-type-org-scope` merged and
  can be deleted (not yet deleted this sitting — do so before ending the
  session if no other work needs it).
- Full native unit suite run once this sitting (not per-iteration
  policy, just extra caution given the shared `reports.routes.js` file):
  6183/6183 passed, plus both `reports.routes.gaps.test.js` and
  `reports.api.test.js` (78 tests) green on the merged result.
- No Docker stack brought up this sitting — backend-internal, mocked-Mongo
  proof bar only.

## Recommended next steps

User explicitly named the order: **#602 next**, then **#626**, then
**#625**. Per the user's own instruction this sitting: for any of these
needing a design call, check `docs/` before treating it as needing
Dennis's input (worked for #621's Result slice; #602 in particular is
flagged in its own body as needing a product/design call on whether
`allowedActions` becomes enforced per-verb or gets corrected/dropped as
documentation-only — check `docs/docs-7-27-2026/extracted/` and
`docs/architecture/` for anything on RBAC permission-catalog semantics
before escalating).
