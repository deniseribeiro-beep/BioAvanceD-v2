# HANDOFF

**Written:** 2026-08-24, mid-session. **Still inside a rabbit hole**
(tracker **#725**) -- this note will rotate again before the session
ends; if you're picking this up cold, re-read #725 for current queue
membership rather than trusting this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. Session is running
**without Docker** (daemon torn down/cold, per Dennis's instruction this
sitting) against a ~10-point complexity budget (`rabbit-hole` skill's
Step 5 pacing table).

Queue: **#723** (Wave 4 e2e kickoff, RF008/RF013), **#724** (equipment
fixture accumulation). Both stay open regardless of what lands here --
neither's own Definition of Done is achievable without Docker this
sitting (#723 needs a green `test:e2e:docker` run; #724's fix needs a
real Mongo to verify against).

## What landed this sitting so far

**RF013 AC#1/AC#3 (persisted backup run-history + checksum)**, on
`feature/docker-e2e-backend-integration` (merged, pushed --
`ddd9154c`): `backup.service.js` now computes a deterministic sha256
checksum over every backup run (embedded in `manifest.json` for both the
mongodump and JSON-fallback paths -- mongodump never wrote a manifest at
all before this) and persists one `backupHistory` doc per run via the
caller's already-connected db (no new MongoClient connection -- a no-op
when no db is passed, so every pre-existing `runBackup()` call site
stayed unaffected). Threaded `db` through from `backup.routes.js`'s
`POST /perform` and `scheduler.service.js`'s cron job (mirroring how
`startTemperatureMonitor`/`startRetentionSweepSchedule` already receive
it). `GET /list` now merges persisted status/checksum onto the
filesystem listing. Verified native-only: 71 tests green across
`backup.service.test.js`, `backup.api.test.js`, `scheduler.service.test.js`.
Frontend `BackupPage.tsx` doesn't yet surface `status`/`checksum` in its
table -- the API contract carries the data now; wiring the UI column is
a small, explicitly-deferred fast-follow, not filed as its own issue
(too small to need one; note it here if you pick this up).

**RF008 AC#5 (export audit log) -- turned out to be a non-gap, not yet
written up.** `#723`'s own gap list said no audit-log write exists in
`reports.routes.js`'s export paths -- true by literal grep, but
`app.js:194` already mounts a global `auditRequest` middleware
(`audit.middleware.js`) on every request, which logs action=EXPORT,
entity=Report, full path (carries report type + format), status, actor,
duration for both `/export` and `/export/pdf`. This needs a corrective
comment on #723 (case 3: confirmed, no change needed) -- **not done
yet**, next step if resuming here.

## Not yet done this sitting (queue still open)

- Comment on #723 with the RF008 AC#5 correction above.
- File follow-up issues (referencing #723) for the 3 gaps that need
  Dennis's product/design call rather than a mechanical backend fix:
  RF008 AC#6 (user-defined report template model, currently hardcoded
  string-matching in `buildPreviewData`), RF013 AC#4 (sandboxed restore
  test mode -- `/restore` is currently a live destructive `--drop`),
  RF013 AC#5 (backup-policy entity + admin UI -- currently static env
  vars, no entity/audit at all).
- Progress-comment on #723 itself once the above lands (build-loop's
  own precedent: a multi-item requirement worked in one sitting stays
  under one tracked issue with progress comments, not split into a new
  issue per gap -- confirmed against build-loop's overlay before
  filing anything).
- #724 (equipment fixture cleanup) not yet started.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `ddd9154c`.
- Docker: still down this sitting, by instruction -- don't bring it up.
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing.

## Recommended next steps

Continue the #725 rabbit hole: finish #723's remaining pieces above,
then move to #724. Budget spent so far: ~3-4 points (one medium-large
backend slice) of the ~10-point sitting budget.
