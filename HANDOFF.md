# HANDOFF

**Written 2026-09-25, sixty-fifth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group was **#1216** (retire `sampleID` from `POST /api/samples`).
Working it surfaced **#1219**, **#1220** and **#1221**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `eba07e1b` (#1221).

## What shipped

- **#1216**, closed. `da72dbf4` (backend), `04a1dcd7` (frontend) and
  `f2caab1d` (e2e). The create response names a specimen only by
  `specimenId`, and every sample, sample-file and storage route resolves
  either form through `utils/sampleLookup.js`. `DELETE /api/samples/:id`
  had been a 404 for every real sample, and is fixed in the same commit.
- **#1219**, closed on its items 1-2.
  - `62541b25`: QuarantineAction writers record the canonical id, and reads
    and releases match both forms. `GET /:id/quarantine-actions` had never
    returned a real action.
  - `13eeb310`: an assay references a specimen by either id and stores the
    canonical one.
- **#1221**, closed, `eba07e1b`: `PUT` on master-data mounts runs the #664
  reference check.

Proof is in each close comment. Live proof was the 12 spec files that
touch sample, storage or file routes, on a fresh-volume stack
(`-p bioavanced-fresh`) with the admin bootstrap and the 17-service chain.
The last run was 151/151, 0 skipped. No full-suite gate ran this sitting.
The last one was 251/251, at `d0429eb5`.

## Open, touched this sitting

- **#1220**, open. Split from #1219 item 3. Storage assignments, occupancy
  grids, the storage half of the movement ledger and the Neo4j lineage all
  key a specimen by its `_id` under the name `specimenId`. It is a
  cross-store migration, only correct applied whole. Its first task is one
  Cypher query to establish the lineage key. **Not started:** an atomic
  change like this wants agreement on the shape before a partial lands.
- **#1211**, closed: a pointer comment only, on the storage resolver that
  now runs ahead of its scope check.

## For Dennis

- #1220's direction (read-side tolerance vs a backfill), before anyone
  starts it.
- Still yours from before: #941 re-close (proof posted), #1218, #956, #979,
  whether `0d87f73b` (#1124's port) stands, whether to mirror Denise's
  `docs/mestrado/` and `docs/planning/bioavanced-v3/` deletions, and the go
  for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `bioavanced-fresh` was taken down with `-v`. Its
  images may still be cached; the next bring-up uses `--build` regardless.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Every route that names a specimen resolves `_id` OR `specimenId`**
  through `utils/sampleLookup.js`. A new sample-addressed route uses it.
  A new storage route that names a sample puts `resolveSampleIdentifier`
  **ahead of** `requireStorageTargetsInScope`, which passes on a miss.
- **A new QuarantineAction records `canonicalSpecimenId(sample)`**, and a
  read or release hands the service the sample document, never a bare id,
  so both key forms match.
- **`sample-storage-lifecycle.spec.ts` pins today's storage echo** (the
  `_id` under `specimenId`, via `mongoIdOf`). #1220 removes that pin.

## Standing context: re-measure, don't copy

- **The project phase (Dennis, 2026-09-25):** we are working down the issues
  the e2e plan surfaced (Wave 3 tracker #646). CI comes only after they are
  all resolved and the whole plan passes on Docker, so it is far off. The
  proof bar now is our tests plus our Docker e2e on this branch.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 180 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis.
