# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- this sitting landed #726's dispatch-wiring slice and #728's backend
slice, none of #725's queue members closed. Re-read #725 for current
queue membership before resuming rather than trusting this snapshot
alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon down/cold, same as every prior sitting) --
#730 still wasn't picked up. Fresh ~10-point pacing budget this sitting
(new sitting, prior sitting's budget doesn't carry over); **fully spent**
-- #726's dispatch-wiring (~5 points, "large") + #728's backend slice
(~5 points, "large").

Queue: **#726** (RF008 AC#6, report templates -- backend slice + the
dispatch-wiring half both landed, only frontend UI remains), **#728**
(RF013 AC#5/AC#6, backup-policy entity -- backend slice landed, only
frontend UI remains), **#730** (wire `cleanupStorageBoxLocation()` into
~5 real spec callers -- Docker-dependent, not started).

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
matching -- now seed a `reportTemplates` collection (via the real
`SYSTEM_REPORT_TEMPLATES` export) and post to the new code-based paths.
No frontend changes needed -- it already sent the camelCase keys
`toTemplateCode` now normalizes correctly.

**#728 (RF013 AC#5/AC#6, backup-policy entity) -- backend slice landed,
issue stays open.** `feature/docker-e2e-backend-integration` @
`c37e6b45` (merge of `fix/728-backup-policy` @ `8dd2405b`). New
`BackupPolicy` singleton config (`backup-policy.service.js` +
`backupPolicy.routes.js`, `GET`/`PUT /api/backup-policy`) --
Administrador-only (`requireRole(4)`, mirroring `security.service.js`'s
existing `security_config` singleton pattern, not #726's multi-row
`ReportTemplate` shape). Fields: `cronExpression`, `retentionDays`
(>=30, RNF010 AC#4), `encryptionEnabled`, `rpoHours` (<=24, AC#2),
`rtoHours` (<=12, AC#3). Every update audit-logged per changed field via
the existing `auditLogger` utility.

`scheduler.service.js` gained `reloadBackupSchedule(db)`, called by the
PUT route when `cronExpression` changes -- stops/re-creates the running
cron task against the new value so a schedule edit applies without a
restart (boot-time scheduling still reads `env.BACKUP_CRON`, unchanged,
to keep `initScheduler` synchronous). `backup.service.js#runBackup(db)`
now resolves `retentionDays` from the policy (env-var fallback if
unavailable) and threads it into the actual cleanup calls -- retention is
now real, not a stored-but-unused field.

`encryptionEnabled` is a compliance-target field only -- no
encryption-at-rest mechanism exists in `backup.service.js` to wire it
into (a distinct, larger feature). Filed **#734** to track that gap
explicitly.

Two implementation judgment calls flagged on #728's thread for
visibility (not explicit sub-decisions from Dennis): RBAC gate is
`requireRole(4)` directly rather than a new permission-catalog entry
(matching `security_config`'s precedent); collection name `backup_policy`
(snake_case, matching `security_config`) rather than camelCase (matching
`reportTemplates`).

**Two findings filed this sitting, both outside #725's queue** (ordinary
case-4 finds): **#733** ('Auditoria'/'Logs de acesso' report types
return identical data -- preserved-as-is behavior surfaced by #726's
slice, a product taxonomy question) and **#734** (BackupPolicy's
`encryptionEnabled` field isn't enforced by any actual encryption
mechanism -- honest gap, out of #728's scope to close).

## Not yet done -- still inside #725

- **#726**: dispatch-wiring landed. Needs: frontend UI only now
  (template management screens, CRUD form/table).
- **#728**: backend slice landed (see above). Needs: frontend UI only
  now (backup policy admin screen).
- **#730**: none started -- needs Docker up to safely edit/verify the 5
  real-backend spec files it lists.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `c37e6b45`.
- Docker: down this sitting (never brought up -- both slices followed
  this repo's "backend-internal slice" proof bar, mocked Mongo, same
  precedent as #723/#724/#727's prior work).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward from
  before this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists. Resuming #725 means picking
up #726's or #728's remaining frontend UI (either is a real,
separately-landable slice -- consider whether they're similar enough in
shape to tackle together) or #730 once Docker is available. This
sitting's ~10-point pacing budget is fully spent -- a fresh sitting gets
a fresh budget per the rabbit-hole skill.
