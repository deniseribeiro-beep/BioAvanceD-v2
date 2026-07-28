# HANDOFF

**Written:** 2026-07-28, end of a `work-issue` → `build-loop` (with a
`divide-and-conquer` detour) session — continuing Phase 1 of
`E2E_IMPLEMENTATION_PLAN.md`. Landed chunk A of RF009 (#289), the sixth
Wave 1 RF touched this milestone (RF001/RF012/RF002/RF004/RF006 landed
in earlier sessions).

**Branch:** `test/e2e-real-backend-foundation`, 3 commits ahead of
`origin/test/e2e-real-backend-foundation` (not pushed this session —
confirm with Dennis before pushing, per repo convention).

## What happened this session

1. Routed issue #289 through `work-issue` → `build-loop`. #289 asked for
   a real-backend spec proving RF009 (Telemetria e monitoramento
   ambiental), which had zero coverage before this session.
2. **Scoping surfaced the issue's own sizing warning was correct** —
   RF009's 7 acceptance criteria need three things that don't exist yet:
   a `Device` model, an `EnvironmentalExcursion` model (the closest
   analog, `TemperatureIncident`, is a different shape), and working
   missing-reading detection/propagation (`TelemetryMonitor`'s
   `findCriticalFreezers`/`propagateCompromise` are no-op stubs). Routed
   through `divide-and-conquer` — confirmed the split with Dennis before
   filing anything.
3. **Filed two follow-ups**, both referencing #289:
   - **#298** — build the `EnvironmentalExcursion` model + AC#5/AC#7
     (also flags the `Device` model question as needing a design call).
   - **#299** — missing-reading detection + `TelemetryMonitor`'s
     `findCriticalFreezers`/`propagateCompromise` (currently stubs) +
     AC#6's full alert/quarantine evaluation.
4. **Built chunk A**: new `tests/e2e/interop-monitoring.spec.ts` (5
   tests) proving RF009's real ingestion path — AC#1/AC#2 (a reading
   POSTed to `/api/iot/telemetry` persists as a real InfluxDB point,
   queried back and value-matched), AC#3-partial (sensorId-tagged
   linkage to a seeded `SensorMetadata` doc — no `Device`/storage-
   location reference yet, that's #298), AC#4-invalid (400 on missing
   sensorId / non-numeric temperature), AC#4-out-of-range + AC#6-partial
   (an out-of-range reading opens a real `TemperatureIncident` via the
   existing policy-lookup + quarantine-evaluation path; an in-range
   reading opens none).
5. New helpers: `tests/e2e/helpers/seedSensor.ts` (seeds a real
   `TemperaturePolicy` + `SensorMetadata` pair directly via Mongo — no
   API seed path exists for either) and `tests/e2e/helpers/queryInflux.ts`
   (reads telemetry points back from the real InfluxDB bucket from the
   host). `compose.test.yml`'s `influxdb-test` now publishes port 8086
   to the host, same rationale as `mongodb-test`'s published port.
6. **Building the fixture surfaced a real pre-existing bug, fixed in the
   same commit**: `TemperaturePolicy.schema.js` was never `require`d
   anywhere on the app's boot path, so mongoose never registered that
   model — every `SensorMetadata.findOne(...).populate('temperaturePolicy')`
   in `resolveTemperaturePolicy` (`iot.controller.js`) silently threw
   "Schema hasn't been registered for model \"TemperaturePolicy\"",
   caught and logged as a warning. **No real sensor's out-of-range
   reading ever triggered an incident/alert/quarantine before this
   fix** — only the `NODE_ENV=test`-hardcoded `'sensor-1'` shortcut
   worked. Fixed by requiring the schema module in `iot.controller.js`.
7. **Ran the full backend unit suite for regressions**: 6262/6264 pass.
   The 2 failures are pre-existing and unrelated to this session's
   changes (`sample.service.unit.test.js`'s `getSampleMovements` test —
   its mock was never updated after #288's `findSampleByAnyId` fix
   landed in a prior session). Filed as **#300** rather than silently
   noted, per this project's "found a problem → file it" rule.
8. **`E2E_TRACEABILITY_PLAN.md`'s RF009 row updated** — now PARTIAL,
   with the full writeup of what's covered, the bug found/fixed, and
   which follow-ups carry the rest.
9. **Closed #289** with the commit hash, naming #298/#299 as the
   follow-ups carrying the remaining scope.
10. **Docker stack** (`compose.test.yml`, all services except unit/e2e-
    runner jobs) was built and run for this iteration's real-backend
    verification, including one rebuild of `backend-app-test` mid-
    session after the `TemperaturePolicy` require fix; torn down and
    cleaned (images, builder cache, test-results, scratch logs) at
    session end.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is 3 commits
  ahead of `origin/test/e2e-real-backend-foundation` — push not done
  this session, confirm with Dennis first.
- Docker stack torn down after this iteration's real-backend run; no
  `bioavanced-test-*` containers/volumes/images remain.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).

## Recommended next steps

None queued explicitly by Dennis this session. Per the traceability
doc's own sequencing, remaining Wave 1 items: `#290` (RF018), `#291`
(RF019), `#292` (RF023), `#293` (TOTP helper, worth pulling forward if
any of those RFs' acceptance criteria turn out to need a genuine
non-admin session). This session's own follow-ups — `#298`
(EnvironmentalExcursion model + Device design call) and `#299`
(TelemetryMonitor stub work) — are natural next picks if continuing
RF009 specifically. `#295` (RF004 AC#3, Study/Protocol/Collection
modeling), `#297` (RF006 AC#6 atomic-transaction design call), and
`#300` (stale test mock) also still need attention, none design-call-
free enough to auto-pick without Dennis's input except #300, which is a
same-shape mechanical fix to `fix-bugs`'s "stale test" case.

## Which skills to use

`work-issue` to route the next issue; it'll land on `build-loop` for
any remaining Wave 1 RF, `divide-and-conquer` if scoping reveals the
same "spec names an entity that doesn't exist yet" shape again, or
`fix-bugs` for #300. `bioavanced-v2-conventions` and
`bioavanced-v2-testing-conventions` apply to all of the above.
