# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- stopped at this sitting's ~10-point complexity budget
(`rabbit-hole` skill's Step 5), not because the queue is empty. Re-read
#725 for current queue membership before resuming rather than trusting
this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon torn down/cold, by instruction) -- both seed
issues' own Definitions of Done need Docker (a green `test:e2e:docker`
run for #723; a live-Mongo-verified fix for #724), so neither closes
regardless of how much backend work landed.

Queue: **#723** (open, progress-commented, 3 pieces resolved/corrected +
3 split off), **#724** (open, foundational fix landed + 1 piece split
off). Two more issues surfaced and filed but are **not** queue members
(unrelated findings, filed separately per the ordinary case-4 rule, not
folded into #725): **#729** (tests/e2e has no real typecheck coverage --
missing `@types/node`), and the three #723 splits **#726/#727/#728**
count as descendants of #723 and *are* in scope if picked up.

## What landed this sitting

**RF013 AC#1/AC#3** (persisted backup run-history + checksum) --
`feature/docker-e2e-backend-integration` @ `ddd9154c`. `backup.service.js`
now computes a deterministic sha256 checksum per backup run (in
`manifest.json` for both mongodump and JSON-fallback paths -- mongodump
never wrote a manifest before this) and persists one `backupHistory` doc
per run via the caller's already-connected db (no new MongoClient
connection -- no-op when no db passed, zero behavior change for
pre-existing callers). `db` threaded through `POST /perform` and the
daily cron job. `GET /list` merges persisted status/checksum onto the
filesystem listing. 71 tests green (native, no Docker).

**RF008 AC#5** -- corrected, not a gap: `app.js:194`'s global
`auditRequest` middleware already logs every export request (action,
entity, full path incl. type/format, actor, status, duration). No code
change; commented the correction on #723.

**#724 root cause + foundational fix** --
`feature/docker-e2e-backend-integration` @ `d9bb4955`.
`seedStorageBoxLocation()` (`tests/e2e/helpers/seedParticipant.ts`)
never returned an id for the equipment/sensor docs it creates, so no
caller could ever clean them up -- the actual cause of the 521+-row
equipment debris. Added `equipmentId`/`containerID` to its return type
and a new `cleanupStorageBoxLocation()` export. Purely additive,
typechecks clean (`tsc --noEmit -p tsconfig.json`: 88 pre-existing
`@types/node`-noise errors before and after -- see #729 -- zero new
ones; frontend's `tsc` binary works against the root tsconfig, no
install needed: `./frontend/node_modules/.bin/tsc --noEmit -p
tsconfig.json`).

**Follow-ups filed this sitting** (all reference their originating
issue): **#726** (RF008 AC#6, report-template model -- needs Dennis's
design call), **#727** (RF013 AC#4, sandboxed restore test mode -- needs
Dennis's design call, safety-relevant), **#728** (RF013 AC#5,
backup-policy entity + UI -- needs Dennis's design call), **#730**
(wire `cleanupStorageBoxLocation()` into #724's ~5 real spec callers +
verify against live Mongo -- Docker-dependent, lists every confirmed
call site), **#729** (tangential finding, not a queue member: no
`@types/node` anywhere in the repo, so `tests/e2e/`'s own tsconfig
can't usefully typecheck -- found while verifying the #724 fix above).

## Not yet done -- still inside #725

- **#726/#727/#728**: none started -- each needs Dennis's product/design
  call before any code, per this repo's convention for entity/UI/safety
  decisions.
- **#730**: none started -- needs Docker up to safely edit and verify
  the 5 real-backend spec files it lists.
- No other #723/#724 pieces remain unaddressed; #725's remaining known
  members are exactly #726/#727/#728/#730 above, all blocked on either
  Dennis's input or Docker being available -- **not** blocked on more
  investigation.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `d9bb4955`.
- Docker: still down this sitting, by instruction -- next session
  needing it starts cold (see the 2026-08-21 predecessor note this
  file's prior rotation carried, now superseded by this one -- if a
  fresh cold-rebuild procedure is needed, that predecessor context is
  in this file's git history, not restated here).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

Resuming #725 means: either pick up #726/#727/#728 (each needs Dennis's
design call first -- these are genuine product decisions, not something
to implement unilaterally), or #730 once Docker is available (edit +
run the 5 real-backend specs it names, confirm nothing broke). Dennis
hasn't picked a specific one yet this sitting -- none queued beyond what
#725 already lists.
