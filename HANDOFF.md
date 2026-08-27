# HANDOFF

**INTERIM — the session is still running.** Written 2026-08-27, after
**queue item 3 of 5**. Dennis asked for the next five issues, left the
pick to me, and authorised Docker. This is a mid-run snapshot, not the
definitive rotation; do not read it as "the session is done."

## The queue (my pick, classified up front)

| # | Issue | Route | State |
|---|---|---|---|
| 1 | **#809** bulk consent-token page never built | build-loop | **CLOSED** `58c34236` / merged `76e893f9` — also cascaded **#805 CLOSED** |
| 2 | **#810** publish sweep aborts on first throw | fix-bugs | **CLOSED** `b8ab77cb` / merged `df373af2` |
| 3 | **#816** `canRoleAccessRoute` fails open | fix-bugs | **CLOSED** `1086502b` / merged `d17e7828` |
| 4 | **#815** `downloadTemplate` builds a dead URL | fix-bugs | not started |
| 5 | **#813** async importer has no quarantine | build-loop | not started (largest; deliberately last) |

## Item 1: #809 — the consent invitation path now works end to end

The link every bulk invitation emails (`/patients/<id>/consent?token=`)
lands on a real page for the first time. Route moved out of
`ProtectedRoute`; `validateConsentToken` now returns the active
`ConsentTemplate` (the page's only possible source for the term — every
other template/policy route is behind `authenticate`), and a
template-lookup failure returns **503**, not the pre-existing 400.

**#805 closed against its own leading hypothesis.** Its body argued the
four bulk paths should be unified onto `/patient/e-consent/${token}`.
That would have shipped a broken link — that route `jwt.verify`s, and
every caller passes random hex from the other token system. The
query-string shape was right all along; only the page was missing.

## Item 2: #810 — one patient's failure no longer silences the sweep

The `try` now wraps the loop body. The token is persisted **before**
delivery is attempted, so the failure mode is "invitation not sent"
rather than "invitation sent, token missing" — a participant holding a
link the database can't validate is unrecoverable. `createPolicy`
returns `consentNotifications: {total, notified, failed}`.

**But tracing who reaches that sweep produced #824, which is bigger than
#810 was.** The sweep lives only in `createPolicy`
(`POST /e-consent/consent-policies`), whose entire frontend client is
**commented out** in `api.ts:794-799`. The operator UI's TCLE builder
posts to `createTemplate` instead — and `createTemplate` has **no
notification logic at all**. So publishing a term through the UI issues
zero consent invitations and mints no `consentToken` for anyone. The
fixed code is still live (the route is registered; `PUT
/consent-policies/:id` delegates into it), just not UI-reachable — the
#813/#808 shape one domain over.

## Item 3: #816 — frontend route authorization now fails closed

`canRoleAccessRoute` ended in a bare `return true`. Replaced with
`ROUTE_ACCESS`, an ordered per-role prefix allow-list; anything unmatched
is denied, matched on segment boundaries. New
`frontend/src/utils/rolePermissions.test.ts` includes the architecture
guard the issue asked for: it parses every `<Route path=>` out of
`App.tsx` and asserts each is reachable by at least one role (and pins
its own regex hit count so a refactor can't make it vacuously green).

**Nobody's effective access changed** — the table reproduces the old
answers. Where a route's own `requiredRole` was narrower, the narrower
one is used (can't widen: ProtectedRoute needs both). All 16 sidebar item
paths were checked individually and still resolve identically.

**#825** carries what this deliberately did NOT change: `canRoleAccessRoute`
is *stricter* than the `<Route>` declaration in two places, so
`Usuário Externo` cannot open `/reports` (the one thing that role's own
description says it is for) and **no `Coordenador` can open the TCLE
builder** (`/admin/tcle/*`, denied as collateral from the `/admin` prefix).
Fixing those means *granting* access — an owner call, and not something to
slip into a fail-closed commit.

## Six issues filed this sitting

The prior sitting's lesson (bodies are wrong about their *premises*)
held again, and this time the false premise was in the **handoff**, not
the issue:

- **#820** — `createPatientConsent` 422s **every signature-less
  manifestation**. `normalizeSignaturePayload` injects `''`/`''`/`null`
  into three fields the schema declares `minLength: 1`, so the schema
  says optional and the code says mandatory. The only production caller
  that sends no signature is `POST /api/e-consent/update` — the
  participant e-consent page's own submit. **So "system 1 works end to
  end" (last handoff, #809's body) is false: its acceptance has never
  worked.** Every test spreads a `validSignature` fixture, so nothing
  caught it. Needs an owner call on direction (is a signature required?
  RF010 AC#4 says "signatário").
- **#821** — the bulk accept path records **no `Consent` at all**:
  `acceptConsentToken` writes five fields on the Patient and returns.
  No `consentId`, no template version, no evidence, no outbox event —
  RF010 AC#2/#3/#4/#5/#7. Blocked on #820. Carries #809's unanswered
  convergence question (Denise's call).
- **#822** — both public participant pages call the backend with
  **relative `/api` URLs, and nothing proxies `/api`** in dev, test or
  prod (`vite.config.js` has no `server.proxy`; `nginx.conf` is static
  serving only). Every such request returns the SPA's `index.html` and
  renders as "link inválido". Second trap for whoever fixes it: swapping
  to the shared `api` client without adding the route to
  `TOKEN_OPTIONAL_ROUTES` reproduces the auth wall, because the request
  interceptor cancels session-less requests.
- **#825** — route authorization contradicts itself in two places
  (above). Also flags `getAllowedRoutes`, a third per-role list with no
  caller in the gate that disagrees with it on `/reports`.
- **#824** — the operator UI's TCLE builder publishes terms through a
  path that notifies nobody (above). Carries #810's remaining
  operator-visibility half.
- **#823** — `POST /consent-tokens/validate` is an unauthenticated
  **participant-enumeration oracle**: three distinguishable error
  messages disclose whether a `participantId` exists and whether it is
  awaiting consent. Pre-dates #809. Also confirmed: **there is no rate
  limiting anywhere in the backend** — not on this route, not globally,
  not on `/auth/login`.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`d17e7828`). No open PR; `main` untouched and frozen.
- `test/809-bulk-consent-token-page`, `fix/810-consent-sweep-per-patient`
  and `fix/816-route-authorization-fail-closed` all merged and deleted
  locally. Neither was pushed, so there are no
  remote branches to clean up — a deliberate deviation from `fix-bugs`'
  "push the fix branch then merge", since nothing needed the branch to
  exist remotely.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**

## Docker — currently UP and bootstrapped

**Stack: UP, 12 core services, all healthy.** Brought up with
`--build` on `backend-app-test` + `frontend-app-test` (both are
build-not-mount, and this sitting changed both trees), so the images
carry #809.

**Bootstrap: already present** — these are the same four named volumes
the previous sitting left bootstrapped (`admin-bootstrap-test` had run;
all 17 reference-data chain services had run; 16 active
`ReferenceDatasetRelease`s). The chain was **not** re-run this sitting
and does not need to be unless the volumes are dropped.

`playwright-runner` did **not** auto-start — naming services explicitly
on `up` avoids it — so there is no competing suite against this stack.
Keep it that way for any manual run.

**Left up deliberately** for queue items 2-5. Whoever ends this session
owes `clean-up`.

## Proof so far

- `consent.service.unit.test.js` **116/116** (6 new for #810, red-first
  — including the identity-lookup-throws case, which also aborted the
  whole sweep before the fix).
- `consent.controller.test.js` **81/81** (6 new, red-first).
- `consentTokenView.test.ts` **15/15** (new).
- `consent-token-page.spec.ts` **4/4** against the real stack, nothing
  logging in, asserting the persisted `PENDING_CONSENT` → `ACTIVE`
  transition.
- `rolePermissions.test.ts` **10/10** (new for #816, red-first on the two
  fail-open assertions).
- Frontend unit suite **149/149** (before #816's file was added); `patient.service` +
  `NotificationService` **127/127**.

## Recommended next steps

Continue the queue in order: **#815 → #813**. Nothing else
is queued by Dennis beyond the five.

The `#684 / #800 / #801` object-ownership cluster remains the
highest-severity item overall, still blocked on the RF010/RF021 actor
model — unchanged.
