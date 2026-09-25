# HANDOFF

**Written 2026-09-24, sixty-first queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group was the storage-topology cluster: #1124, plus #1209 and #1210,
which working it surfaced. All three are fixed and closed. #1211 was split
off and is open.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `53fbbbb6` (#1210 live proof).

## What shipped

- **#1124**, `0d87f73b`: `POST /api/storage/topology/containers` and
  `/topology/boxes` (gated on `manageStorageTopology`). Before this, no request
  could create a StorageContainer or a StorageBox. This is a port of Denise's
  own remedy from `stabilize/v2.0.0-prototype` (`12b2f889`, `dd75ae70`,
  `4dad2186`, `23e17a1c`), with the service file and two routes only. Two
  deliberate departures: `containerID` stays numeric (#757), and a variant-aware
  duplicate check returns 409.
- **#1209**, `71f387eb`: the `containerID` unique index is now `_v3` with
  `{ $exists: true }`. `v2`'s `$gt: ''` admitted strings only, while the field
  is a Number. Measured on mongo:7: it is the only filter that also serves the
  consumers' `$in` lookup.
- **#1210**, `62849f4b` + `53fbbbb6`: topology authoring is bounded by the
  caller's organization, through the root freezer's Equipment. It fails closed
  when no scope reaches it. The live e2e test builds a real scoped Coordenador
  (register with `organizationId`, then `completeFirstLoginMfa`).

Verification is in each close comment. Live runs used `compose.test.yml`
with `backend-app-test` rebuilt from each fix.

## Open, touched this sitting

- **#1211** (filed): the other 13 `storage.routes.js` routes check no tenancy,
  and that includes allocate/move/release on another organization's sample.
  `org-scope-routes.arch.test.js` pins them in a new `TRACKED_UNSCOPED` list
  that must shrink as they are scoped. The fix depends on #1192's question
  (`collectionSite` as both site and tenancy key).

## For Dennis

- **The #1124 port copied Denise's service file with `git show` and then
  adapted it** (ours has a different index helper, a numeric `containerID`, a
  scope check and a rewritten docblock). The repo rule allows reading her code
  and re-implementing it on our branch, and forbids a cherry-pick without your
  go. This sits close to that line. Your call whether `0d87f73b` stands as it is.
- Still yours from before: #956, #979, whether to mirror Denise's
  `docs/mestrado/` and `docs/planning/bioavanced-v3/` deletions, and the go for
  a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next `/clear`.
- **The test stack is down.** `mongodb-test-data` persists with the bootstrap
  admin. Images were built from `62849f4b`'s tree, and `53fbbbb6` is test-only.
- Influx needs `INFLUXDB_HOST_PORT=18086` on this machine (reserved-port range).
- Another session was running in parallel. It committed nothing to this branch
  during the sitting.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Topology authoring answers 403 across organizations and fails closed with
  no scope** (`storage-topology-authoring.api.test.js` #1210 block, the e2e
  spec, `org-scope-routes.arch.test.js` `#1210` test).
- **The `containerID` unique index is `$exists: true`, `_v3`**
  (`storageIndexes.unit.test.js`).
- **`TRACKED_UNSCOPED` is not `EXEMPT`.** It lists routes that need the gate
  and lack it, against #1211. Don't move entries between the two lists.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 914 commits on hers only, 157 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 23:29: current-state validation, Full Vitest
  diagnostic and Coverage diagnostic passed. Release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
