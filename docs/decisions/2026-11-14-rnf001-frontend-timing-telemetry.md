# 2026-11-14: RNF001 C4's frontend telemetry is a request-timing histogram kept in memory beside the RNF015 HTTP metrics, posted by any signed-in user and read by the Administrador

Requirement RNF001 C4, with RNF015 C1. Issue #1469.

## The question

RNF001 C4 asks that "O resultado é verificado por testes E2E e telemetria do frontend." The e2e half has its instrument; the frontend measured nothing (`frontend/src/api/requestId.ts` carries a correlation id only) and the backend had no route that accepted a timing. Where do the browser's timings go, and who may send and read them?

## Decided

`[inference]`, for #1469 on 2026-11-14, from the repo's pattern: every RNF015 metric so far is an in-process histogram under `api/backend/src/infrastructure/metrics/`, with no npm package, served by the Administrador-gated `GET /api/monitoring/metrics`.

1. **The timings join the RNF015 metrics, never an audit row or a log line.** `api/backend/src/infrastructure/metrics/frontendTimings.js` keeps one latency histogram for every timing and one per request name, in the same buckets as the HTTP metrics, in memory and reset on restart. No user identity is kept. RNF015 C1 asks to monitor the frontend among the rest, and RNF015 C4 keeps observational logs apart from the normative AuditEvent, so a timing writes no AuditEvent; `logs.routes.js` already refuses a client-facing write route.
2. **`POST /api/monitoring/frontend-timings` takes a batch from any signed-in user.** The reporter runs in every role's browser, so the route is behind `authenticate` and no role gate. A valid batch is recorded whole and answered 204 with no body.
3. **The Administrador reads them under `data.frontend` of `GET /api/monitoring/metrics`:** `since`, `totals` and `routes`, each route `{ name, buckets, count, sumMs, maxMs, p95UpperBoundMs }`.
4. **Limits, RNF018 C2.** The body is an object with only `timings`, a list of 1 to 50 items; each item has exactly `name` and `ms`. `name` is a string of at most 200 characters matching `^(GET|POST|PUT|PATCH|DELETE) /[A-Za-z0-9/_:.-]*$`; `ms` is a number from 0 to 600000. A batch with any bad item is refused whole with 422, `details` naming the field path that failed (`timings[3].ms`), and nothing is recorded. Past 200 distinct names, a new name is counted under `__other__`, as the HTTP metrics cap their routes.
5. **The label rule the frontend reporter follows.** The name is the method, a space and the URL path with the query dropped; each path segment that is not made of lower-case letters, hyphens and underscores, and is not `v` followed by digits, is written as `:id`. `GET /api/patients/6650f1c2a9e1/consent?x=1` is sent as `GET /api/patients/:id/consent`. No identifier reaches the metrics.

## Not decided here

- **The Prometheus rendering.** `?format=prometheus` does not carry the frontend timings yet; the JSON does.
- **Page-navigation timings** (route changes and first render), as opposed to the API request timings above.
