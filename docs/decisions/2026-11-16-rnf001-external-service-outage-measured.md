# 2026-11-16: RNF001 C3's external-service outage is measured in the e2e gate with InfluxDB stopped, record-only

Requirement RNF001 C3, with RNF003 AC3 and RF009 AC1. Issue #1469.

## The question

RNF001 C3 says "Downloads, importações extensas e indisponibilidade de serviços externos são medidos separadamente." The download and the import are timed by `scripts/rnf001-ui-p95.mjs`, record-only, but the outage half was left as `notYetMeasured`. Which service is taken down, how, which route is timed while it is down, and what does the gate do with the result?

## Decided

`[inference]`, for #1469 on 2026-11-16, from the repo's pattern: the e2e gate already stops one service alone, runs one measured container and restarts that service healthy (the projection-worker phase of #1503), and the download and the import of RNF001 C3 are record-only with no budget of their own.

1. **The service is InfluxDB.** RNF003 AC3 makes it non-critical: with it down, `/api/health` still answers 200 with `degraded: true` and `checks.influxdb.status` `down`, so the backend keeps serving and the outage is measurable. Neo4j is not taken, since under `LINEAGE_MODE=fail-closed` it can be critical.
2. **It is stopped by its container id and restarted through compose.** `scripts/e2e-gate.sh` reads the id of `influxdb-test` and runs `docker stop -t 30` on it, outside compose, so compose stops none of the services that depend on it. After the measurement, `influxdb-test` is started again with `--wait --no-deps` and must be healthy before the main run.
3. **The route timed is `POST /api/reports/temperature/preview`.** The temperature report reads InfluxDB (RF009 AC1), and the Administrador's scope is global, so the handler queries InfluxDB for the admin; an InfluxDB failure propagates as a 500, which is timed like any other answer.
4. **The evidence the run needs.** The script, run with `OUTAGE=influxdb`, logs in, reads `GET /api/health` and takes samples only when `checks.influxdb.status` is `down`; each of the `SEPARATE_N` samples is recorded with its time and HTTP status. The run is measured only when every sample got a response. A service that is not read down, a failed login or an unknown `OUTAGE` value leaves the run not measured, with its `reason`.
5. **Record-only, no budget.** The outage time is written to `rnf001-outage.json` and printed in CI; no time limit applies to it.
6. **Exit codes.** A measurement that is not measured, leaves no result or runs past 10 minutes fails the gate with exit 10, as the UI p95 run does; InfluxDB that did not stop or restart is exit 11.

## Not decided here

- **The other external services** (Neo4j, SMTP, the TSA and the witness): their outages are not measured.
- **A time budget for an outage** route.
