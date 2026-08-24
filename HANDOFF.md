# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- this sitting landed a backend slice on #726, none of #725's queue
members closed. Re-read #725 for current queue membership before
resuming rather than trusting this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon down/cold, same as last sitting) -- #730
still wasn't picked up.

Queue: **#726** (RF008 AC#6, report templates -- backend slice landed
this sitting, dispatch-wiring + frontend UI remain), **#728** (RF013
AC#5/AC#6, backup-policy entity -- design call resolved, not started),
**#730** (wire `cleanupStorageBoxLocation()` into ~5 real spec callers --
Docker-dependent, not started).

## What landed this sitting

**#726 (RF008 AC#6, report templates) -- backend slice landed, issue
stays open.** `feature/docker-e2e-backend-integration` @ `fd8be692`
(merge of `test/726-report-template-backend` @ `fcc3065d`). New
`ReportTemplate` model (`api/backend/src/models/ReportTemplate.js`) +
CRUD routes at `/api/report-templates` (`GET`/`GET :id` gated by
`viewReports`, `POST`/`PUT`/`DELETE` gated by the new
`manageReportTemplates` permission, granted to Coordenador+Administrador
per this issue's design call) + seed migration
(`report-template-seed.service.js`, idempotent by `code`) of the 13
existing hardcoded report types from `reports.routes.js`'s
`buildPreviewData` into system-defined `ReportTemplate` rows. Each
seeded row carries a `handlerKey` naming which `buildPreviewData` branch
it maps to -- deliberately unused so far. System-defined rows can't be
deleted via the API. 33 new tests (native, mocked Mongo, no Docker
needed); full backend smoke suite green (118 files, 2625 tests) after
touching the shared RBAC catalog + `app.js`.

**Deliberately not done in this slice:** `buildPreviewData` still
resolves report type via its existing `typeIncludes`/`normalizeTypeValue`
string-matching, not via a `ReportTemplate` lookup -- the actual "no
permanent legacy special-casing, one code path" half of the design call
is a real refactor (the ~700-line branch chain into a handler-map keyed
off template lookups) left for a future sitting. Frontend UI (template
management screens) also not started.

Per #726's own design call ("Backend + frontend UI both in scope for
this issue -- not split into a follow-up"), **#726 stays open** rather
than closing against the narrowed backend deliverable -- caught
mid-session before `divide-and-conquer` would have filed a UI follow-up
issue, which the design call explicitly ruled out. Remaining work
(dispatch wiring + frontend UI) continues on #726 across future
sittings, progress-commented as it lands (same precedent as #549's
15-sittings-under-one-issue pattern), not split into a new issue number.

**Two findings filed this sitting, both outside #725's queue** (ordinary
case-4 finds, not descendants of anything already in the hole):
- **#732** (BioAvanceD-v2): `GET /api/reports/:type/filters` ignores its
  own `:type` param -- always returns the same 4 generic filters
  regardless of report type. Adjacent to #726 but distinct scope, found
  while reading `reports.routes.js` for the seed migration.
- **dyeallpies-skills-pack#397**: `divide-and-conquer`'s filing
  playbooks don't check whether the target issue already carries an
  explicit owner instruction against splitting before filing a
  follow-up -- this sitting nearly hit exactly that on #726 itself,
  caught only by happening to re-read the design-call comment at the
  right moment.

## Not yet done -- still inside #725

- **#726**: backend slice landed (see above). Needs: repoint
  `buildPreviewData`'s dispatch onto `ReportTemplate` lookups (replacing
  the `typeIncludes`/`normalizeTypeValue` chain with a handler-map keyed
  by each seeded row's `handlerKey`) + frontend UI (template
  management screens, CRUD form/table). Likely needs
  `divide-and-conquer`'s *execution-chunking* (not filing-split, per the
  design call) if either half grows past one iteration on its own.
- **#728**: design call resolved (backend entity + admin CRUD +
  audit-log wiring + `scheduler.service.js` cron hot-reload), no code
  written yet.
- **#730**: none started -- needs Docker up to safely edit/verify the 5
  real-backend spec files it lists.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `fd8be692`.
- Docker: down this sitting (never brought up -- #726's backend slice
  followed this repo's "backend-internal slice" proof bar, mocked
  Mongo, same precedent as #723/#724/#727's prior work).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward from
  before this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists. Resuming #725 means picking
up #726's remaining work (dispatch wiring or frontend UI -- either is a
real, separately-landable slice) or #728 (design call resolved, ready to
implement, size with `divide-and-conquer` if it grows past one
iteration) or #730 once Docker is available.
