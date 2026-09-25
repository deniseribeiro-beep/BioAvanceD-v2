# HANDOFF

**Written 2026-09-24, sixtieth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues to resolve.
Docker is on." Of the open bugs, #956 and #979 wait on Dennis's decision,
so the group was the cold-chain quarantine: #1207, plus #1208, which that
fix surfaced. Both are fixed and closed.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `25630d9f` (#1208).

## What shipped

- **#1207**, `64b489b4`: `POST /api/iot/telemetry` no longer quarantines
  on the first out-of-range reading. The alarm (incident, excursion,
  emails) stays immediate. The quarantine waits until the excursion has
  lasted the policy's `minimumDuration`, else `TELEMETRY_CRITICAL_DURATION_HOURS`
  (2 h), timed from the new `TemperatureIncident.excursionStartedAt`. An
  in-range reading sets that field back to null. The close comment explains
  why the check runs at ingest rather than in the monitor cycle: incidents
  never auto-close, and the monitor can't see policy bounds.
- **#1208**, `25630d9f`: `findBoxIdsBySensorKey` also resolves boxes
  through `SensorMetadata.storageContainer`, the link registration writes
  (#311). Before this, a registered sensor's excursion marked Neo4j
  COMPROMISED and quarantined nothing in Mongo.

Verification (details in each close comment):
- **Native:** every touched test file passes. Unit and integration were
  red before the fixes. Architecture 151/151.
- **Live:** `compose.test.yml` with `backend-app-test` rebuilt from each
  fix. `interop-monitoring` + `sensor-registration` pass 32/32 with 0
  skipped. The new #1207/#1208 e2e test was pin-probed live: it failed
  against the image built without #1208. It is the first live proof on this
  branch that a cold-chain quarantine fires.

## Touched, not closed

- **#1124**: two comments. The first describes the resolver divergence; the
  second points to #1208 as its fix. The issue's own subject (no request
  can create a `storageContainer`) is unchanged and open.

## Still genuinely Dennis's

- #956 (manual-reading affordance) and #979 (Redis fatal/non-fatal
  posture): both carry comments that walked the docs, and both await his
  decision.
- Whether to mirror Denise's `docs/mestrado/` and
  `docs/planning/bioavanced-v3/` deletions (carried, unverified this sitting).
- The go for a PR into `main`.

For the rest of the question backlog, redirect `gh issue list --state open
--label question` to a file and grep it.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next
  `/clear`.
- **The test stack is down.** Its `mongodb-test-data` volume persists.
  `sensor-registration`'s `realLogin` passed against it, so the bootstrap
  admin exists. Images were built from `25630d9f`'s tree.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **The first out-of-range reading quarantines nothing** (`iot.controller.test.js`
  `#1207` block, `iot.api.test.js`, and the `#1207/#1208` e2e test).
- **The quarantine resolves boxes through `storageContainer`**
  (`cold-chain-quarantine.service.test.js`, `#1208`).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 914 commits on hers only, 152 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 23:29: current-state validation, Full Vitest
  diagnostic and Coverage diagnostic passed. Release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
