# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- one queue item (#727) resolved this sitting, three remain. Re-read
#725 for current queue membership before resuming rather than trusting
this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon down/cold) -- the one Docker-dependent queue
item (#730) still wasn't picked up.

Queue: **#726** (RF008 AC#6, report templates -- design calls resolved,
not started), **#728** (RF013 AC#5/AC#6, backup-policy entity -- design
call resolved, not started), **#730** (wire `cleanupStorageBoxLocation()`
into ~5 real spec callers -- Docker-dependent, not started).

## What landed this sitting

**#727 (RF013 AC#4, sandboxed controlled restore testing) -- closed.**
`feature/docker-e2e-backend-integration` @ `ddd545fe` (merge of
`test/727-sandboxed-restore-test` @ `0cb21472`). `backup.service.js`'s
`restoreBackup()` was the only restore path and it's live/destructive
(`mongorestore --drop` against the configured db). New
`testRestoreBackup()`: restores into a disposable scratch database
(`<dbName>_restoretest_<timestamp>`, remapped via mongorestore's
`--nsFrom`/`--nsTo` so the live db is never touched), verifies the
backup's own checksum against its `manifest.json` first (RNF010:
"validado por checksum"), tears the scratch db down after. Falls back to
a JSON restore into the same scratch db when `mongorestore` is
unavailable. New route `POST /api/backup/restore-test/:fileName`, same
`manageBackup` RBAC as the existing restore route. Persists one
`restoreTestHistory` doc per run (mirrors #723's `backupHistory`
pattern). 67/67 tests (36 unit + 31 integration), native -- no Docker,
mocked exec/MongoClient per this repo's backend-internal-slice proof
bar.

**Docs-first check resolved most of #726/#727/#728's "needs Dennis's
design call" framing before asking anything** (per `resolve-issue`'s
own docs-first-before-`AskUserQuestion` rule, prompted mid-session by
Dennis: "Design calls might have answers in updated docs"). Findings
recorded as comments on #726/#727/#728 directly:
- RNF010 already settles restore-test *validation* as checksum-based
  (not row-count/diff) and gives the RPO/RTO/retention/encryption
  numbers for #728's backup policy -- only the entity schema, RBAC, and
  cron-hot-reload mechanism were genuinely open for #728; only the
  restore-test *target* (scratch vs. namespace) was genuinely open for
  #727.
- #726 (report templates) had nothing settled in docs -- full design
  call, now resolved with Dennis (see below).
- New 79-entity Polyglot Persistence data model doc
  (`docs/docs-7-31-2026/manuscript/2.2-Additional_file_2_...docx`) has
  no `ReportTemplate` entity and no `BackupPolicy` entity -- confirmed
  absent, not just unsearched.

**Design calls resolved with Dennis this sitting** (recorded as
comments on each issue):
- **#726**: existing hardcoded report types migrate into the new
  `ReportTemplate` model as seeded rows (one code path, no permanent
  legacy special-casing). Backend + frontend UI both in scope for this
  one issue (not split into a follow-up). RBAC: Coordenador +
  Administrador can create/edit templates.
- **#727**: restore-test target is a disposable scratch database (see
  "What landed" above -- already built).
- **#728**: scope includes live cron hot-reload --
  `scheduler.service.js`'s `startBackupSchedule` must pick up
  `BackupPolicy` changes without a process restart, in addition to the
  entity/CRUD/audit-log work.

**#731 filed** (found during this session's `wrap-up` audit, not
folded into #725): my #727 close comment named periodic restore-test
scheduling as a deferred follow-up without a tracking issue --
`wrap-up`'s shipping-addendum check #10 caught it. Small, not a design
call: `scheduler.service.js`'s existing `startBackupSchedule` pattern
generalizes directly.

## Not yet done -- still inside #725

- **#726**: design calls resolved (see above), no code written yet.
  Needs: `ReportTemplate` entity + seed migration of existing hardcoded
  types + CRUD routes/RBAC + frontend UI. Likely too big for one
  iteration -- consider `divide-and-conquer` when picked up (backend
  entity/CRUD as a landable first slice, UI separately).
- **#728**: design call resolved (see above), no code written yet.
  Needs: `BackupPolicy` entity (fields per RNF010's settled numbers) +
  admin CRUD + audit-log wiring (existing `auditLogger` pattern) +
  `scheduler.service.js` cron hot-reload.
- **#730**: none started -- needs Docker up to safely edit/verify the 5
  real-backend spec files it lists.
- **#731**: none started -- small, not blocked on anything (see above).
  Not an #725 queue member (filed as an ordinary found-gap per
  `wrap-up`'s case-4 rule, same as #729 before it).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `ddd545fe`.
- Docker: down this sitting (never brought up -- #727 followed this
  repo's "backend-internal slice" proof bar, mocked exec/MongoClient,
  same precedent as #723/#724's prior-sitting work).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists. Resuming #725 means picking
up #726 or #728 (both have their design calls resolved now -- ready to
implement, size each with `divide-and-conquer` if it grows past one
iteration) or #730 once Docker is available. #731 is small and
Docker-free, pickable anytime independent of #725.
