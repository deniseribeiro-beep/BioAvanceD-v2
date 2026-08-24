# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- this sitting landed #726's dispatch-wiring slice, none of #725's queue
members closed. Re-read #725 for current queue membership before
resuming rather than trusting this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon down/cold, same as every prior sitting) --
#730 still wasn't picked up. Fresh ~10-point pacing budget this sitting
(new sitting, prior sitting's budget doesn't carry over); ~5 of 10
spent on #726's dispatch-wiring slice (sized "large").

Queue: **#726** (RF008 AC#6, report templates -- backend slice + now the
dispatch-wiring half both landed, only frontend UI remains), **#728**
(RF013 AC#5/AC#6, backup-policy entity -- design call resolved, not
started), **#730** (wire `cleanupStorageBoxLocation()` into ~5 real spec
callers -- Docker-dependent, not started).

## What landed this sitting

**#726 (RF008 AC#6, report templates) -- dispatch-wiring slice landed,
issue stays open.** `feature/docker-e2e-backend-integration` @
`ef5146a1` (merge of `fix/726-report-dispatch-wiring` @ `e0dd720f`).
`reports.routes.js`'s `buildPreviewData` now looks up a `ReportTemplate`
by `code` (a new `toTemplateCode` camelCase->snake_case normalizer of the
incoming `:type`/`reportType`) and dispatches through a `handlerKey`->
handler map (`REPORT_HANDLERS`), replacing the old `typeIncludes`/
`normalizeTypeValue` free-form Portuguese/English string-matching chain
entirely -- the "one code path" half of #726's design call, done.

System template `code` values were realigned (from
`report-template-seed.service.js`'s original snake_case guesses) to the
snake_case form of the live frontend's `REPORT_TYPE_DEFINITIONS` `key`
values (`report.constants.js`) -- confirmed via a live-caller trace that
`GET /:type/export` (CSV) is the only route the frontend actually calls
today, sending those keys verbatim; `POST /generate` and
`POST /:type/preview` are dead code from the frontend currently. Renamed:
`patient`->`patients`, `sample`->`samples`, `sensor`->`sensors`,
`result`->`results`, `temperature_report`->`temperature`. Added a new
`audit` template row (handlerKey `accessLogs`, same handler as the
existing `access_logs` row) -- the frontend exposes both as separate
menu entries ("Auditoria" vs "Logs de acesso") that the old string-match
chain already collapsed onto one handler; preserved as-is rather than
treated as a taxonomy bug to fix in this slice (filed **#733** to ask
whether that's intentional).

Rewrote the ~90 test cases across `reports.api.test.js`/
`reports.routes.gaps.test.js` that exercised the old chain's fuzzy
matching (free-form Portuguese/English strings, URL-encoded spaces) --
now seed a `reportTemplates` collection (via the real
`SYSTEM_REPORT_TEMPLATES` export, not a hand-duplicated list) and post to
the new code-based paths. 130 tests green across the full affected set
(reports.api, reports.routes.gaps, reportTemplates.api,
report-template-seed.service, ReportTemplate model, reports.models) plus
the 61-test architecture suite. No frontend changes needed -- it already
sent the camelCase keys `toTemplateCode` now normalizes correctly.

**Deliberately not done in this slice:** frontend UI (template
management screens -- CRUD form/table for Coordenador/Administrador).
Per #726's own design call ("Backend + frontend UI both in scope for
this issue -- not split into a follow-up"), #726 stays open.

**One finding filed this sitting, outside #725's queue** (ordinary
case-4 find, not a descendant of anything already in the hole): **#733**
(BioAvanceD-v2) -- 'Auditoria' and 'Logs de acesso' report types return
identical data (preserved-as-is behavior surfaced by this slice, not a
new bug it introduced); a product taxonomy question for Dennis, not a
call this slice could make on its own.

## Not yet done -- still inside #725

- **#726**: dispatch-wiring landed (see above). Needs: frontend UI only
  now (template management screens, CRUD form/table).
- **#728**: design call resolved (backend entity + admin CRUD +
  audit-log wiring + `scheduler.service.js` cron hot-reload), no code
  written yet.
- **#730**: none started -- needs Docker up to safely edit/verify the 5
  real-backend spec files it lists.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `ef5146a1`.
- Docker: down this sitting (never brought up -- #726's dispatch-wiring
  slice followed this repo's "backend-internal slice" proof bar, mocked
  Mongo, same precedent as #723/#724/#727/#726's backend slice).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward from
  before this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists. Resuming #725 means picking
up #726's remaining frontend UI (a real, separately-landable slice) or
#728 (design call resolved, ready to implement, size with
`divide-and-conquer` if it grows past one iteration) or #730 once Docker
is available.
