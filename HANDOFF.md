# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- this sitting closed **both #728 and #726** outright (each had only
frontend UI remaining; both backend halves landed in prior sittings).
Only **#730** remains in the queue, and it's Docker-gated -- Docker was
never brought up this sitting, so nothing else was poppable. Re-read
#725 for current queue membership before resuming rather than trusting
this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon down/cold, same as every prior sitting).
Fresh ~10-point pacing budget this sitting; **~8 of ~10 spent** (#728's
UI slice, "medium" ~3pts, + #726's UI slice, "large" ~5pts). Stopped
here not because the budget forced it, but because the only remaining
queue item (#730) needs Docker, which stayed down all sitting.

Queue: **#730 only** (wire `cleanupStorageBoxLocation()` into ~5 real
spec callers -- Docker-dependent, not started). **#726 and #728 are both
closed.**

## What landed this sitting

**#728 (RF013 AC#5/AC#6, backup-policy) -- CLOSED.** Frontend UI slice:
a "Backup Policy" section added to the existing Administrador-only
`BackupPage.tsx`. Merge `test/728-backup-policy-ui` ->
`feature/docker-e2e-backend-integration` @ `20144fd4`. Full detail on
the (closed) issue and the prior HANDOFF rotation this sitting.

**#726 (RF008 AC#6, report templates) -- CLOSED.** Frontend UI slice: a
new Coordenador+Administrador-only screen at `/reports/templates`
(`ReportTemplatesPage.tsx`) -- list/create/edit/delete `ReportTemplate`
rows, Table+Modal CRUD following `SystemManagementPage.tsx`'s
`OrganizationsSection` pattern. System-defined rows editable but not
deletable. Merge `test/726-report-template-ui` ->
`feature/docker-e2e-backend-integration` @ `74183e79`. Both halves of
this issue's own design call ("backend + frontend UI both in scope, not
split") are now done.

**New finding filed while wrapping up #726: #735** -- the new
ReportTemplate CRUD screen lets a Coordenador/Administrador create a
custom template, but `ReportsPage.tsx`'s report-*generation* menu never
reads from the `ReportTemplate` API at all (confirmed by grep -- zero
references across `ReportsPage.tsx`/`ReportQueryPage.tsx`/
`ReportViewPage.tsx`/`report.constants.js`). A newly created custom
template is stored and manageable but has no path to actually being
selectable when generating a report -- RF008 AC#6's "no fixed list" goal
is only half-wired. Flagged as a design call (the generation menu's
per-type display metadata -- icon/description/category -- has no
`ReportTemplate` equivalent yet), not a mechanical fix. Not a queue
member of #725 (ordinary case-4 find, same precedent as #732/#733).

## Not yet done -- still inside #725

- **#730**: none started -- needs Docker up to safely edit/verify the 5
  real-backend spec files it lists. The only remaining queue item.

## Repo state

- On `feature/docker-e2e-backend-integration`, **3 commits ahead of
  origin, not yet pushed** (`20144fd4` #728 merge, `82f8fa97` prior
  HANDOFF rotation, `74183e79` #726 merge). Push before ending the
  sitting -- pushing doesn't trigger CI (see `bioavanced-v2-conventions`)
  so there's no rush mid-sitting, but don't let it go stale.
- Docker: down this sitting (never brought up -- both UI slices followed
  the pure-frontend-UI proof bar, no live backend needed).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward from
  before this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists: **#730** is the only
remaining item, and it's Docker-gated. Resuming #725 means bringing
Docker up first, then working #730's 5 real-backend spec callers. Once
#730 closes, #725's own upward-cascade check (`resolve-issue`'s close
discipline) applies -- confirm no further split is pending before
closing the tracker itself.
