# HANDOFF

**Written 2026-09-25, sixty-seventh queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Docker is on. Pick next group of issues
to resolve." First the collaborator digest was reconciled (Denise's Axis E
decisions, 2026-09-25). Then the group was the three Session E2
access-control decisions: **#662, #1057, #1008**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `49b507ae` (#1008).

## What shipped

- `37b5bd40`: source-comment notes that #879's and #1147's CONFIRM decisions
  asked for. #879's is the pre-`1d6d10b2` coding-version cutoff. #1147's is
  the ELM-0168/0169 deviation and the API-only facility/room surface.
- **#662**, closed, `6fbbe9fc`. `manageAccessRequests` is Administrador-only.
  The seed's role merge could never remove a grant, so the new
  `RETIRED_SEED_GRANTS` in `rbac-catalog-seed.service.js` pulls withdrawn
  grants off stored roles on every boot.
- **#1057**, closed, `cb3e1e56`. `POST /api/auth/register` is deleted. The
  #998 hierarchy floor now lives in `authService.registerUser`, and
  `grantedBy` is required, with `'system'` the only exemption.
- **#1008**, closed, `49b507ae`. There is a new `assignRole` permission,
  Administrador-only. It is required on every `POST /api/users/register`,
  and checked on `PUT /api/users/:id` when the level, the auditor role or
  the role validity dates CHANGE. `DELETE /api/users/:id` refuses deleting
  a user above the caller's level.

Proof: targeted vitest per slice, with controls (see each close comment).
Architecture suite 157/157. **Full e2e on a fresh-volume stack built from
`49b507ae`: 253 passed, 1 failed, 0 skipped.** The one failure is #1227.
Two later full runs on a second fresh stack from the same images passed
254/254 each.

## Reconciliation done this sitting (digest acked through 2026-09-25T21:10Z)

- #832's item 3 (`CONSENT_SECRET` strength is a deploy concern) is now a
  checklist item on #682, comment of 2026-09-25.
- #1216 was already resolved on our branch (`13eeb310`), so nothing was left.
  #976's syntax floor already exists (`scripts/lint.js` in CI).
- The remaining OPEN Axis E AMENDs are **implementation vehicles, direction
  decided by Denise, so each is workable without asking**: #714, #830, #840,
  #883, #961, #1049, #1055, #1106 with #1120 (a pair), and #1162. Each
  decision comment supersedes its body.

## Open, touched or filed this sitting

- **#1227**, new. In a full-suite run, the `scientific-data-access.spec.ts`
  `afterAll` stalls on host-side Mongo cleanup. It hit once in 3 full runs,
  and two later fresh-stack full runs were 254/254 (its newest comment).
  The trace is lost, so the cause is `[not established]`. The candidate
  mechanism is `getDb()`'s default 30 s server selection, labelled
  `[inference]` there. On recurrence, keep `test-results/` before any
  re-run.
- **#1228**, new question and security record. `49b507ae` means a
  Coordenador cannot create ANY account, an `[inference]` from "when a role
  is set" (every registration grants a role). The body carries the one-edit
  reversal if Denise meant it literally.
- **#1229**, new. It carries #1008's deferred verb split.
- Unchanged from before: #914 (remaining RF014 policy groups), #1225
  (lineage consent gate after #1224), #1222 (intake-wizard intermittent),
  #1226, #1220.

## For Dennis

- #1228: the recommended default is the shipped behaviour (register
  requires `assignRole`). The grounds are RF003, whose primary actor for
  role assignment is Administrador (`requisitos-index.md:37-50`, cited in
  #1008), and the fact that every registration grants a role. Denise can
  overturn it with the one edit the issue names. Otherwise nothing is
  needed.
- Still yours from before: #1220's step 5 default, #941 re-close, #1218,
  #956, #979, whether `0d87f73b` (#1124's port) stands, whether to mirror
  Denise's `docs/mestrado/` and `docs/planning/bioavanced-v3/` deletions,
  and the go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next
  `/clear`.
- **Nothing is running.** `bioavanced-fresh` was taken down with `-v`, and
  the build cache was pruned. Its images are **kept**, built from
  `49b507ae`, so a bring-up of the same code needs no `--build`. Any later
  src change needs `--build`. Port 8086 was free.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A permission withdrawn from a seeded role goes in `RETIRED_SEED_GRANTS`,**
  not only out of `LEGACY_ROLES_SEED`. `upsertRole` merges, and enforcement
  reads the stored role.
- **`registerUser` requires `grantedBy`.** An HTTP route passes the caller's
  userID. Only a trusted internal caller passes `'system'`.
- **On this branch a `Closes #N` commit does not close the issue.** It is
  not the default branch. Comment, then `gh issue close`.

## Standing context: re-measure, don't copy

- **The project phase (Dennis, 2026-09-25):** we are working down the issues
  the e2e plan surfaced (Wave 3 tracker #646). CI comes only after they are
  all resolved and the whole plan passes on Docker.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 191 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her Axis E decision log (`docs/stabilization/AXIS_E_DECISION_LOG.md`) is
  cited by every decision comment but is on no pushed branch as of
  2026-09-25 (`git ls-tree -r --name-only origin/stabilize/v2.0.0-prototype docs/stabilization`).

## Recommended next

None queued by Dennis.
