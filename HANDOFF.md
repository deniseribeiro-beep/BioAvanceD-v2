# HANDOFF

**Written 2026-09-25, sixty-second queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group was **#1211**, the storage tenancy gap #1210 left behind, plus
**#1212**, which working it surfaced. Both are fixed and closed.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `9f40fc9f` (#1212).

## What shipped

- **#1211**, `38687a68` + `bfb468ec`: all 13 `storage.routes.js` routes now
  check the caller's organization. A specimen is scoped by `collectionSite`,
  and a box or freezer by its root freezer's Equipment (#1210's walk), in
  the new `src/services/storage-scope.service.js`. The five mutations and
  six single-record reads answer 403 out of scope before the controller
  runs. `GET /freezers` and `GET /samples/search` filter their queries
  instead. `TRACKED_UNSCOPED` in `org-scope-routes.arch.test.js` is now
  empty.
- **#1212**, `9f40fc9f`: the storage search, the medications dictionary
  search and `DrugService.searchAndCacheDrug` escape the caller's query
  before `new RegExp`. A `(` was a 500. The shared util is
  `src/utils/escapeRegex.js`.

Verification is in each close comment. The #1211 live proofs used
`compose.test.yml`. The new `tests/e2e/storage-allocation-tenancy.spec.ts`
was run against three images: the fix (green), no fix (the foreign release
answered 200), and mutations only (the foreign sample read answered 200).
#1212 is proven natively only. It fails at `new RegExp` before any query
runs.

## Open, touched this sitting

- **#1192** (not changed, only cited): `collectionSite` is still both the
  collection site and the tenancy key. #1211 built on it as the interim key.

## For Dennis

- Still yours from before: #956, #979, whether `0d87f73b` (#1124's port of
  Denise's service file) stands, whether to mirror Denise's `docs/mestrado/`
  and `docs/planning/bioavanced-v3/` deletions, and the go for a PR into
  `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next `/clear`.
- **The test stack is down** (`compose down`). `mongodb-test-data` persists,
  with the bootstrap admin and this sitting's fixtures. The last
  `backend-app-test` image was built from `bfb468ec`'s tree and lacks #1212,
  so pass `--build` on the next bring-up.
- Influx needs `INFLUXDB_HOST_PORT=18086` on this machine (reserved-port range).

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Every storage route is organization-scoped.** It is pinned by name in
  `org-scope-routes.arch.test.js` (#1210, #1211 blocks), by
  `storage-allocation.api.test.js`, `storage-query-scope.api.test.js` and
  the e2e spec. A new storage route needs the gate or an `EXEMPT` reason.
- **`TRACKED_UNSCOPED` stays, empty, with its stale check.** It is where the
  next known unscoped route gets recorded against its issue.
- **Storage fixtures for a non-admin caller need an in-org
  `collectionSite` and a box tree reaching Equipment in that org**, or the
  request is correctly refused (`treeInOrg` in both integration files).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 161 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state validation,
  Full Vitest diagnostic and Coverage diagnostic passed. Release manifest
  integrity failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
