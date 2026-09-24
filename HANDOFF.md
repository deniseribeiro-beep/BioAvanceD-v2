# HANDOFF

**Written 2026-09-24, fifty-seventh queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on.
Check pc usage on heavy runs." The group picked was the four
frontend-orphan `question` issues (**#1108, #1066, #871, #934**), settled
with the docs ladder rather than handed to an owner. No heavy run happened:
only targeted vitest, `node --test` on one arch test, and `tsc`. So no
PC-usage check was needed, and there were no Docker calls.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `0b649de5` (#871).

## What shipped

- **The citation that settled the group:** `docs/architecture/canonical-active-surface.md:13`
  (Denise, 2026-07-08). Its class `B` reads "dead / not imported and should
  be deleted". Future orphan questions can cite it.
- **#1066**, closed: `52233106` deletes `ImportAdapter.tsx`, `papaparse`, and
  the three uncalled smart-import clients in `api.ts`.
- **#934**, closed: `547d9e6f` deletes `useReports`. `useAccess` stays,
  because v2.0.0 `AccessGrant` (P1X-0238..0250) names the `Access` model as
  its predecessor.
- **#871**, closed: `0b649de5`. The intake wizard showed a failed
  `/dictionary/suggest` load as "Nenhum fenótipo sugerido". It now renders an
  error with a retry, and the `CascadingSuggestion`/`AsyncTypeaheadDictionary`
  orphans are deleted.
- **#1202**, filed and partly worked: `33ccf1a6` gates the two
  `/api/access` reads, and `1caaf538` writes the canonical `AccessGrant`
  fields and turns DELETE into a revocation.

Verified natively only: targeted vitest, the RBAC arch test and the
frontend typecheck. Each fix got a pin probe. No Docker gate ran.

## Touched, not closed

- **#1108**: the ladder is done and settles it as delete plus inventory
  (see its last two comments). **The edit has not landed.** The auto-mode
  classifier denied a shell overwrite of `validations.ts`, and the denial
  forbids retrying through another tool in that session. Next session: do
  it with `Edit` directly. Trim `validations.ts` to `validateThresholds`,
  trim `FacilityManagementPage.tsx:18`'s import to match, delete
  `utils/logMethods.ts`, then run `npm run typecheck`.
- **#1202**: open for the `accessGrantId`/`userAccountId` renames (default:
  do them in #1201), `permissionCodes`, and enforcement (default: do not
  enforce until an RF names it). See its progress comment.
- **#1193**: a comment records that `/pacientes/smart-import` has no UI, with
  a recommended default of retiring it.

## Still waiting on Dennis

#1108's edit, blocked this sitting by the classifier. Plus the earlier
items: #1200's placement, #1196's default, #1197 (for Denise), and whether
to mirror Denise's `docs/mestrado/` and `docs/planning/bioavanced-v3/`
deletions. For the rest of the question backlog, query
`gh issue list --state open --label question` (redirect it) and read each
issue's last comment.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next
  `/clear`. It was unused this sitting.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **`GET /api/access*` is permission-gated, and an access DELETE is a
  soft revoke** (`tests/unit/access.routes.test.js`,
  `users-access.routes.test.js`).
- **The wizard's suggestion sections distinguish a failed load from an
  empty one** (`ClinicalIntakeWizard.test.jsx`, `#871` block).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 911 commits on hers only, 138 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 22:52: current-state validation, Full Vitest
  diagnostic and Coverage diagnostic passed. Release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`, and Dennis's go is still needed for a PR into `main`.
