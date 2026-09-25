# HANDOFF

**Written 2026-09-25, sixty-third queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group was the RF008 reports cluster: **#1077** (report data bounded at
the CSV only) and **#748** (filter UI). Working them surfaced **#1213**,
**#1214**, **#1215** and **#1216**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `de852105` (#1216 slice 1).

## What shipped

- **#1077**, `c2a20c43`, closed: `buildPreviewData` applies `EXPORT_CATALOG`
  to every handler's result. The preview, the CSV, `/export/pdf` and the
  stored Report now share one allow-list.
- **#1213**, `bc4b6be5`, closed: ReportViewPage reads `participantId`,
  `specimenId` and `registeredAt`.
- **#748**, `86483343`, closed: ReportQueryPage renders an "Inventário"
  section built from `GET /reports/:type/filters`.
- **#1214**, `1c0e563f`, closed: once the catalog has loaded, a filter
  renders only if the type's handler reads it. The grade select sends
  `qualityCategory`; `final_grade` was never read.
- **#1216** slice 1, `de852105`: `POST /api/samples` returns `specimenId`
  alongside `sampleID`.

Proof is in each close or progress comment. The live proof is
`tests/e2e/report-inventory-filters.spec.ts`, 3 passed against
`compose.test.yml`.

## Open, touched this sitting

- **#1216**, open: retiring `sampleID` (the Mongo `_id`) from the create
  response. The progress comment scopes it at 19 e2e reads and 25 frontend
  files. The id-taking routes already resolve `specimenId`. Denise fixed
  this on her branch as #804; on ours it is re-implementation work, not a
  port.
- **#1215**, open, not started: a StorageBox picker for the report
  location filter. Its body names two directions.
- **#803** (commented only): one more mock-fidelity instance, fixed inline.

## For Dennis

- Still yours from before: #956, #979, whether `0d87f73b` (#1124's port of
  Denise's service file) stands, whether to mirror Denise's `docs/mestrado/`
  and `docs/planning/bioavanced-v3/` deletions, and the go for a PR into
  `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next `/clear`.
- **The test stack is down** (`compose down`). `mongodb-test-data` persists.
  The `backend-app-test` and `frontend-app-test` images were built from
  `de852105`'s and `1c0e563f`'s trees. The build cache was pruned.
- Influx needs `INFLUXDB_HOST_PORT=18086` on this machine (reserved-port range).

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Report data is bounded where `buildPreviewData` returns, not per
  surface.** A new handler needs an `EXPORT_CATALOG` entry, or its preview,
  PDF and stored Report keep no rows (deny by default). Pinned by the
  `#1077` describe in `reports.api.test.js`.
- **ReportQueryPage's filters come from the backend catalog.** A filter a
  handler reads must be listed in `FILTER_CATALOG`, or the page will not
  render it.
- **Find a new specimen by `data.specimenId`, not `data.sampleID`.**
  Reports and exports carry only `specimenId`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 164 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this sitting's last three commits.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state validation,
  Full Vitest diagnostic and Coverage diagnostic passed. Release manifest
  integrity failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
