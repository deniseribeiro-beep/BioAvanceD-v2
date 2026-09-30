# HANDOFF

**Written 2026-09-30, seventy-third queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.**

The instruction was to refresh and re-deploy the local dev tooling, then:
"read handoff. Pick next group of issues to resolve and begin resolving them.
Docker is on." The tooling was refreshed and re-deployed first.
The group picked was **#1242** (suite-red, first by rule), then **#1240** and
**#1241**, then **#1013**, plus **#1243**, which #1013's work surfaced.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `8b19dae8`.

## What shipped (all closed with comments)

- **#1242** (`2e9a0623`): the revoke-sessions handler assigns its user
  filter before `findOne`. The #1088 guard is green again.
- **#1240** (`7ef77eee`, `687c2fd4`):
  - User reads (`GET /api/users`, `GET /:id`, the PUT response) carry
    `auditorRole`.
  - The user edit form has an Auditor checkbox, and the list shows an
    Auditor badge.
  - PUT acts on `auditorRole` only when it differs from the held state,
    read after `changeUserRole`, which revokes every assignment. The audit
    row records it only on a real change (the #1009 trap).
- **#1241** (`32264f96`, `b3e8434b`): review done.
  - `GET /api/users/logs` served the audit trail to every account after
    #926 made it reachable. It now follows `isAuditReader`.
  - `GET /api/users/:id` and `GET /:id/validate-status` now need
    `createUser`.
  - Items 1 and 2 are kept deliberately, with the reasoning in code comments.
- **#1013** (`beef9874`): `POST /api/users/:id/set-password`, behind the new
  `setUserPassword` permission.
  - It checks strength and reuse, keeps history (depth 3), sets
    `lastPasswordChange`, and sets `forceReset`.
  - It revokes sessions (`admin_action`) and writes its own audit row.
  - `PUT` now refuses a non-empty password with 422. The edit form's
    password field calls the new route.
- **#1243** (`8b19dae8`, filed and fixed this sitting): `isBecomingAdmin`
  was true for an echoed `roleName`. Any form edit of an existing
  Administrador therefore wiped their MFA enrolment, #1021's defect through
  a second field.

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| per-fix targeted vitest / `node --test` | named files per commit | all green, listed in each commit message | per commit | seconds |
| in-container `playwright-runner`, `auth-access-security.spec.ts` | one spec | 15/15, 0 skipped | `687c2fd4` sources | 23 s |
| backend vitest `tests/unit tests/integration tests/compliance`, JSON reporter | full | 9373/9373, 0 skipped | `8b19dae8` | 629 s |
| frontend vitest, **eight** `src/` dirs (`src/config` is new; re-derive the list from `git ls-files`, never copy it) | full | 38 files, 339/339 | `8b19dae8` | 20 s |
| backend `node --test "tests/architecture/**/*.arch.test.js"` | full | 162/162 | `8b19dae8` | 45 s |
| `compose build` of backend, frontend and runner; stack, admin bootstrap and 17-service chain, all `--no-deps`; full in-container `playwright-runner` | full | **260/260**, 0 skipped, 0 flaky | `8b19dae8` | 152 s |

No suite was skipped: the diff touched backend, frontend and e2e.
The machine-resource check read free RAM below its reserve before the first
bring-up. No other session was live, so everything ran at width 1.

## Filed, carried open

- **#1244:** the password-reuse depth is hard-coded in five places and
  disagrees (`user-security.service` stores 5, `validateReuse` reads 3).
  dict-02 P1X-0203 says "conforme política", which ties it to #914.
- **#1245:** security review of this sitting's surfaces. Item 2 is settled
  in a comment. Item 1 (an admin setting another admin's password, with no
  hierarchy floor) is the one that needs a deliberate answer.
- Two local-tooling findings are tracked outside this repo.

## Touched, left open

- **#1229** (verb split of `createUser`): left, not started. It is deferred
  by Denise's Axis E decision ("Verb split (dir 2) deferred", 2026-09-25),
  and its revisit trigger has not fired. This sitting put two more reads
  behind `createUser` (#1241), which the split would re-home.

## For Dennis

Unchanged from the previous note:
- Milestone #3's stale runner line (#284).
- Whether #1222 merits an upstream report.
- #1225's option call, #1228's default, #1220's step 5, the #941 re-close,
  #1218, #956 and #979.
- Whether `0d87f73b` (#1124) stands.
- Whether to mirror Denise's `docs/` deletions, and #1231.
- The go for a PR into `main`.

New:
- #1245 item 1.
- #1013 moved the password control to the new route but kept it in the edit
  form, rather than on System Management as the issue suggested (the
  reasons are on #1013).

## Docker and the machine

- **Gate:** Dennis, 2026-09-30: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `compose down` ran. The named volumes and the
  images, built from `8b19dae8`'s sources, are kept. The build cache was
  pruned (2.22 GB).
- `admin-bootstrap-test` (`createFirstAdmin`) re-seeds the RBAC catalog on
  every bring-up. That is how `setUserPassword` reached the kept Mongo
  volume without a manual re-seed. `[ran it]` The #1013 e2e passed on it.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **PUT `/api/users/:id` never sets a password.** A non-empty one is a 422.
  `set-password` owns it, and its `forceReset: true` is deliberate.
- **`isBecomingAdmin` means a change of level** (`!isAdmin && ...`). The
  form echoes `roleName` on every save.
- **An echoed `auditorRole` equal to the held state is not a permission
  change.** Read the held state after `changeUserRole`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-30: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-30: 936 commits on hers only, 233 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still unread against the
  issue comments.

## Recommended next

None queued by Dennis. No `suite-red` issue is open. #1245 and #1244 are this
sitting's own filings, and nothing blocks either.
