# HANDOFF

**Written:** 2026-08-18, fresh sitting (twenty-sixth update, budget reset
to zero for this sitting). **Still inside the rabbit hole**, tracker
**#618** ("organization-scope enforcement + RBAC gaps"). User requested a
specific pickup order this sitting: **#621 -> #602 -> #626 -> #625**.
#621 and #602 both landed (both partial/split); #626 next.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #621 (partial — Result report-type org-scope
  resolved; rest split to #629), #602 (split into #630/#631, no code
  change — design-call issue, resolved by filing the implementation
  plan).
- **Filed this sitting:** #628 (bug), #629 (enhancement, #621's
  remainder), #630 (foundational: correct PERMISSION_CATALOG's
  allowedActions), #631 (depends on #630: actual per-verb enforcement).
- **Still queued, in the user's stated order:** #626, #625.
- **Also open in the hole (not in this sitting's requested order, lower
  priority):** #628, #629, #630, #631 (all just filed this sitting).

## Issues closed this sitting

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
- **#602**: design call resolved with Dennis (2026-08-18) — direction is
  to make `PERMISSION_CATALOG`'s `allowedActions` a real per-verb
  enforcement contract in `requirePermission()`, not drop it as
  decorative (dict-02 P1X-0222 confirms it's canonical Core RBAC data).
  Too large for one sitting (107 `requirePermission()` call sites, 17
  permission codes) — split into **#630** (foundational: audit + correct
  the catalog, no behavior change, safe first step) and **#631**
  (depends on #630: the actual enforcement change, likely needs its own
  further split once started — two implementation-shape options already
  sketched in its body). No code changed for #602 itself.

## Filed this sitting

- **BioAvanceD-v2#628** (bug, open): `Result.sampleID` stores either the
  Sample's Mongo `_id` or its `specimenId` depending on write path — #621's
  fix works around it defensively but every other Result join has the
  same latent gap. Also flags the pre-existing `sampleanalysis` report
  type's own Result join likely being silently broken (reads a
  `sample.sampleID` field that doesn't exist on the canonical `Sample`
  model).
- **BioAvanceD-v2#629** (enhancement, open): the un-fixable remainder of
  #621 — Sensor/Equipment/Temperature report types and saved Report
  documents have no organization-bearing reference anywhere, needs
  Dennis's design call (same shape #621 originally needed).
- **BioAvanceD-v2#630** (enhancement, open, foundational): audit +
  correct `PERMISSION_CATALOG`'s `allowedActions` for all 17 permission
  codes / 107 call sites.
- **BioAvanceD-v2#631** (enhancement, open, depends on #630): add
  per-verb enforcement to `requirePermission()`. Likely needs its own
  `divide-and-conquer` split once started.
- **dyeallpies-skills-pack#338** (not a BioAvanceD-v2 issue, filed
  earlier this sitting): `bioavanced-v2-legacy`'s doc-authority pointer
  is stale vs. `bioavanced-v2-conventions`' newer `docs/` ordering.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `88a00317`
  (last push was the previous HANDOFF rotation — #602 produced no code
  changes, so no new push this item). Working tree clean except the
  gitignored/junctioned `.claude/skills/`.
- Full native unit suite last run for #621's slice: 6183/6183 passed. Not
  re-run for #602 (no code touched).
- No Docker stack brought up this sitting.

## Recommended next steps

User explicitly named the order: **#626 next**, then **#625**. #626
already has a fully-sketched fix shape in its own body (no design call
needed — mirrors the now-merged sample sub-resource org-scope pattern
from #619/#623/#624, applied to `clinicalUnitId` instead of
`collectionSite`). #625 needs a narrower design call (which layer owns
the org-scope check — route middleware vs. per-handler in
`sample-file.controller.js`) — check `docs/` first per this sitting's
established pattern, though a layering question like this is more likely
an implementation-style call than something `docs/` would settle.
