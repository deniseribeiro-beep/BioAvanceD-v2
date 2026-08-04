# HANDOFF

**Written:** 2026-08-04, after splitting #408 into #412-#415 on
`feature/docker-e2e-backend-integration`. No code changed this session —
tracker state only.

## What happened this session

Dennis said "pick #408". Routed via `work-issue` → `resolve-issue` (a
refactor/consolidation-closeout item, not a bug/coverage/build-loop
shape).

**Pre-pickup checks:** working tree clean, local branch matched
`origin/feature/docker-e2e-backend-integration` exactly (`3cf7edf5`), no
stale `issue-408-*` branch, no dangling merged-but-open work.

**#408 investigation:** the issue's acceptance check ("grep confirms
nothing reads the legacy trio anywhere") looked like a quick
confirm-and-remove. A full-repo grep for
`lifecycleStatus|availabilityStatus|quarantineStatus|quarantineReason`
across `api/backend/src`, `frontend/src`, `tests/e2e` returned 25 files.
Delegated classification to a background `Explore` agent (per
`agent-delegation`'s read-only-research route) — **all 24 non-doc files
came back genuine (A) Sample-domain usage, zero false positives**,
including a surprise: `equipment-sensor-quarantine.service.js` (name
suggests equipment domain) actually writes directly to the `samples`
collection and is genuine Sample-domain scope despite its name.

This is much bigger and more business-logic-heavy than the issue text
implied — not just leftover dual-write plumbing, but real rework needed
in FHIR/LGPD import (CSV column mapping, FHIR resource fields) and
e-Consent. Applied `divide-and-conquer`'s "ship only the first slice and
stop — is the repo correct?" test: a single-shot removal of the schema
fields/dual-write bridge would break all 24 call sites simultaneously
(most have no fallback read) — this is a migration-completion family
that can't safely land in one small sitting.

Asked Dennis how to proceed (chunk-and-ship vs. full-removal-now vs.
file-the-split-only); **Dennis chose file-the-split-only, no code this
session.**

**Filed, per `divide-and-conquer`'s design-split playbook:**

- **#412** — core Sample domain (`models/Sample.js`,
  `sample.service.js`, `sample.routes.js`, `intakeWizard.routes.js`,
  `routes/intakeWizard.js`). Foundational, no dependency. Keep schema
  fields + `deriveLegacyStatuses()` bridge in place — other subsystems
  still depend on them until their own follow-ups land.
- **#413** — import/FHIR subsystem (`fhir-import-staging.service.js`,
  `fhir.service.js`, `import.service.js`, `import-lgpd.service.js`,
  `import-lgpd.controller.js`, `contracts/canonical/v1/index.js`).
  Depends on #412. Real mapping work, not a rename — CSV columns and
  FHIR resource fields need to translate to `specimenStatus`.
- **#414** — e-Consent + equipment-quarantine subsystem (`eConsent.js`,
  `MongoPatientConsentReadRepository.js`,
  `equipment-sensor-quarantine.service.js`, `MongoStorageRepository.js`,
  `analysisValidation.service.js`). Depends on #412.
- **#415** — frontend (`SamplesPage.tsx`, `types/models.ts`,
  `FhirImportPage.tsx`, `SampleDetailsPage.tsx`,
  `ClinicalIntakeWizard.jsx`, `SamplesPageView.tsx`,
  `intake.service.js`). Depends on #412, #413, #414 — needs backend to
  consistently return `specimenStatus` everywhere before frontend can
  drop its own trio reads.

**#408 retargeted** (not closed — still open as tracking issue) to just
the final closeout: once #412-#415 land, drop the schema
fields/`deriveLegacyStatuses()` bridge from `Sample.js`, update
`canonical-data-contract-v1.md`'s "Legacy Fields Prohibited" list,
confirm `BLOCKED_SPECIMEN_STATUSES` has no stray duplicates (already
consolidated per part A — confirmed this session, no action needed),
and run the final acceptance grep. Comment posted on #408 listing
#412-#415 and the re-scoping rationale.

`wrap-up` ran clean — no friction. The only snag was `gh issue create`
requiring `--label` (already-known project convention, not a new
finding).

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged this session,
  still at `3cf7edf5`. No commits, no pushes — this was a tracker-only
  session.
- Issues: **#408 open, retargeted** to closeout-only scope (see above).
  **#412, #413, #414, #415 newly filed, all open, all `enhancement`
  label**, dependency chain #412 → {#413, #414} → #415 → #408 closeout.
  **#410, #401, #402** unchanged from prior handoffs.

## Blocking next step

None.

## Recommended next steps

Dennis didn't name a specific next pick this session — no explicit
next-issue instruction beyond "go ahead" on the filing plan, so per this
skill's own rule: **none queued**. For reference, the natural next pick
is **#412** — it's the foundational piece of the #408 breakdown and
unblocks #413/#414, which in turn unblock #415 and the #408 closeout.
`build-loop` is not needed for any of these — they're migrations of
existing code to an existing target field (`specimenStatus`), not new
capability.

Older backlog, unchanged: **#410, #401, #402**, **#384–#387**,
`#371`/`#373`/`#374`/`#378`/`#379`.

## Which skills to use

- **#412 (core Sample domain), when picked up**: keep the schema fields
  and `deriveLegacyStatuses()` dual-write bridge in `Sample.js` — do NOT
  remove them yet. #413/#414 still read the trio directly and haven't
  migrated; removing the bridge in #412 would break them before their
  own issues land.
- **#413 (import/FHIR), when picked up**: this is real mapping work, not
  a delete-and-rename. `import.service.js`/`import-lgpd.service.js`
  parse `lifecycleStatus` from CSV columns and
  `import-lgpd.controller.js` has user-facing column templates that
  reference it — both need an actual value mapping onto
  `specimenStatus`, and the template text needs updating too.
- **#414, when picked up**: don't assume `equipment-sensor-quarantine.service.js`
  is out of scope because of its name — it writes directly to the
  `samples` collection (confirmed by grep + read this session) and is
  genuine Sample-domain, in scope for the trio migration.
- **#415 (frontend), when picked up**: don't start until #412-#414 are
  confirmed merged — the frontend fallback reads (e.g.
  `SampleDetailsPage.tsx` falling back to `lifecycleStatus` when
  `specimenStatus` is absent) can only be safely dropped once the
  backend guarantees `specimenStatus` is always populated across every
  flow the frontend renders.
- **#408 closeout, when picked up**: re-run the same full-repo grep this
  session ran
  (`lifecycleStatus|availabilityStatus|quarantineStatus|quarantineReason`
  across `api/backend/src`, `frontend/src`, `tests/e2e`) as the
  precondition check before removing the schema fields — confirm hits
  are down to just `Sample.js`'s own schema/bridge before deleting them,
  don't trust that #412-#415's close comments alone are sufficient
  (same lesson `#408`/`#409`/`#411` handoffs have carried before: verify
  the grep, don't trust the summary).
- Backlog unchanged otherwise: **#401, #402**, **#384–#387**, older
  backlog (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session.
