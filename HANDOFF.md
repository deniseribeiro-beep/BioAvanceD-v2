# HANDOFF

**Written:** 2026-08-24. **Still inside a rabbit hole** (tracker **#725**)
-- this sitting closed **#728** outright (backend + frontend UI both
landed) and is continuing to **#726** (frontend UI) next, within the
same sitting's budget. Re-read #725 for current queue membership before
resuming rather than trusting this snapshot alone.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. This sitting ran
**without Docker** (daemon down/cold, same as every prior sitting) --
#730 still wasn't picked up. Fresh ~10-point pacing budget this sitting;
**~3 of ~10 spent** so far (#728's frontend-UI slice, sized "medium" --
smaller than the backend slices this hole has mostly seen). Continuing
to #726's frontend UI next, expected "large" (~5 points), which would
land the sitting around ~8/10.

Queue: **#726** (RF008 AC#6, report templates -- backend + dispatch-
wiring landed, only frontend UI remains; picking up next), **#730**
(wire `cleanupStorageBoxLocation()` into ~5 real spec callers --
Docker-dependent, not started). **#728 is closed** (see below).

## What landed this sitting

**#728 (RF013 AC#5/AC#6, backup-policy entity) -- CLOSED.**
`feature/docker-e2e-backend-integration` @ `20144fd4` (merge of
`test/728-backup-policy-ui` @ `1effb685`, on top of the earlier backend
slice at `c37e6b45`). Added a "Backup Policy" section to the existing
Administrador-only `BackupPage.tsx` -- view/edit `cronExpression`,
`retentionDays`, `encryptionEnabled`, `rpoHours`, `rtoHours` against the
already-landed `GET`/`PUT /api/backup-policy` routes. Reused the page's
existing route/nav/RBAC gating (`/backup`, Administrador-only at every
layer already) -- no new route/nav entry needed. New `useBackupPolicy.ts`
hook mirrors `useSecurity.ts`'s singleton get/update pattern.
`validateBackupPolicyDraft` (exported pure function, mirrors
`backup-policy.service.js`'s validation rules) gives client-side
feedback before a round-trip 422; unit-tested, 6/6 in
`BackupPage.test.tsx`. i18n keys added to all three locales
(`backup.policy.*`). Manually verified in a real browser via a
throwaway mocked-auth Playwright spec (form loads with seeded values,
edits, saves, shows success -- deleted after use per `build-loop`'s
proof bar for a pure-frontend-UI slice with no Docker).

No new findings filed this sitting.

## Not yet done -- still inside #725

- **#726**: backend + dispatch-wiring landed (prior sitting). Needs:
  frontend UI only now (template management screens, CRUD form/table) --
  next pickup.
- **#730**: none started -- needs Docker up to safely edit/verify the 5
  real-backend spec files it lists.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through... **not
  yet pushed this sitting** -- `20144fd4` is local only as of this
  snapshot; push once the sitting's queue work for now is done (see
  `bioavanced-v2-conventions`: pushing the feature branch doesn't
  trigger CI, so no rush, but don't forget before ending the sitting).
- Docker: down this sitting (never brought up -- #728's slice followed
  this repo's "pure-frontend-UI slice" proof bar, no live backend
  needed).
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward from
  before this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

None queued beyond what #725 already lists. Resuming #725 means picking
up #726's remaining frontend UI (report-template list/create/edit/delete
screen -- closest existing analog is `SystemManagementPage.tsx`'s
`OrganizationsSection`/`UsersSection` list+modal CRUD pattern) or #730
once Docker is available. ~3 of this sitting's ~10-point budget spent so
far.
