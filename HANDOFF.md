# HANDOFF

**Written 2026-09-25, sixty-third queue sitting. INTERIM: the sitting is
continuing. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group is the RF008 reports cluster: **#1077** (report data bounded at
the CSV only) and **#748** (filter UI). Working them surfaced **#1213** and
**#1214**.

## Repo state

`feature/docker-e2e-backend-integration`. The last substantive commits are
`c2a20c43` (#1077) and `bc4b6be5` (#1213).

## Shipped or in flight

- **#1077**, `c2a20c43`: `buildPreviewData` applies `EXPORT_CATALOG` to
  every handler's result, so the preview, the CSV, `/export/pdf` and the
  stored Report share one allow-list. Proven natively (comment on #1077).
  **Left open for the live check** in `tests/e2e/report-inventory-filters.spec.ts`.
- **#1213**, `bc4b6be5`, closed: ReportViewPage reads `participantId`,
  `specimenId` and `registeredAt`.
- **#748**, in flight: ReportQueryPage renders an "Inventário" section built
  from `GET /reports/:type/filters` (`buildInventoryFields`). Its unit tests
  and the new e2e spec are written. Not yet committed.
- **#1214**, filed, not started: four report types render clinical/SPREC
  filters their handlers ignore. It is next after #748, in the same file.

## For Dennis

- Still yours from before: #956, #979, whether `0d87f73b` (#1124's port of
  Denise's service file) stands, whether to mirror Denise's `docs/mestrado/`
  and `docs/planning/bioavanced-v3/` deletions, and the go for a PR into
  `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next `/clear`.
- The test stack is being brought up with `--build` from the #748 working
  tree. `admin-bootstrap-test` has not run yet.
- Influx needs `INFLUXDB_HOST_PORT=18086` on this machine (reserved-port range).

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Report data is bounded where `buildPreviewData` returns, not per
  surface.** A new handler needs an `EXPORT_CATALOG` entry, or its preview,
  PDF and stored Report keep no rows (deny by default). Pinned by the
  `#1077` describe in `reports.api.test.js`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 164 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state validation,
  Full Vitest diagnostic and Coverage diagnostic passed. Release manifest
  integrity failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
