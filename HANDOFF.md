# HANDOFF

**Written 2026-09-04, thirteenth queue sitting. INTERIM — the session is
CONTINUING.** Dennis asked for "the next 10 issues, Docker is on."
**All 10 are closed.** The full native regression is running as this is
written and the **Docker gate has not run yet** — both are owed before
this branch is shippable, and neither result is in this file.

Do not read this as an end-of-session note. Re-derive every count below
rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed. `main`
  untouched, no PR.
- **11 substantive commits this sitting**, last one `a675abb7` (the
  #1036 timing equalizer). `git status -sb` is authoritative.
- **No new npm scripts, dependencies or env keys.** Two new test files
  (`tests/integration/consent-token-response-leak.1045.test.js`,
  `tests/unit/process-fatal-handlers.1040.test.js`) plus one new arch
  test and one new frontend module.

## Docker state

- **Nothing running.** No stack was brought up this sitting; no
  container of any kind was started.
- **The Docker gate is OWED and has not run**, against 11 commits that
  include product source under `api/backend/src` and `frontend/src`.
- **The frontend suite and typecheck have NOT been run since the #1041
  `App.tsx` comment change** — only the per-iteration targeted runs.
  `npm --prefix frontend run test:unit` and `typecheck` are owed too.

## Closed (10)

`#1039` `#1043` `#1044` `#1041` `#1040` `#1038` `#1042` `#1028` `#1045`
`#1036`. Every one has a close comment carrying its own evidence.

## The judgment a query cannot carry

- **`[read it]` #1045 was five leaks wider than it said, across TWO
  permission gates.** It examined `/api/patients` and `/search`; the raw
  participant document was also returned by `buscar`, `findForEdit`, and
  **both patient report handlers — which are gated on `viewReports`, not
  `createPatient`** — plus the JWT e-consent `validate/:token` route in a
  different token system's file. `toCsvRows` derives CSV columns from
  `Object.keys(rows[0])` with **no allow-list**, so the token reached a
  file operators download. Containment shipped; **#1049 (hash at rest) and
  #1050 (the allow-list) are the remainder.**
- **`[read it]` #1036's direction 2 is WRONG if applied uniformly, and
  the issue does not say so.** It says "dummy compare on the early-return
  paths"; there are four such guards, and the fourth is the account
  lockout gate whose own comment (#952) says it sits before the compare
  *"so that guessing actually stops"* rather than burning a round per
  attempt. Equalizing it hands back that DoS. **The lockout path is left
  fast and distinguishable on purpose — #1051 is the decision record**, and
  a CONTROL test reds if someone equalizes it.
- **`[ran it]` #1036's own `[not established]` measured: bcrypt cost 10 is
  median 60.9ms (p10 58.9, p90 65.6) against ~0.0001ms for a guard-only
  return.** No distribution overlap. Direction 1 ("do nothing") does not
  survive that number.
- **`[read it]` #1037's guard does NOT cover #1028's trigger.**
  `rejectCallerSuppliedPrivilege` filters only `accessType` and
  `roleName`; `organizationId` passes through an unauthenticated
  `POST /api/auth/register` untouched, so the orphaned-user window was
  anonymously reachable until `8b64756a`. This body's "not P1" is
  withdrawn.
- **`[ran it]` #1039 settled its own sweep: of 86 files in `src/models`,
  only 14 export a Mongoose model and exactly ONE carried the duplicate
  index declaration.** The other 72 are native-driver collections.
- **`[read it]` #1040 is not free hygiene.** Three call sites
  (`auth.service.js:540`, `consent.service.js:911`,
  `collectionResolver.js:23`) reason explicitly FROM the absence of a
  global `unhandledRejection` handler. The new handlers log and still
  `process.exit(1)`; **a swallow would silently invalidate all three.**
- **`[read it]` the #1041 delegated draft made `rowNumber` a STRING,
  which would have broken `getQuarantineBatch`'s `.sort({rowNumber: 1})`.**
  `tests/e2e/async-import-quarantine.spec.ts:155` pins it as a number.
  Reworked to keep it numeric with the sheet name beside it.

## Conventions this sitting relied on / established

- **A probe that reverts ONE hunk of an N-hunk change proves nothing about
  the others, and this sitting has the receipt.** `[ran it]` the first
  `createFirstAdmin` pin passed in BOTH worlds — it called
  `createFirstAdmin(db, env)` where every sibling uses
  `createFirstAdmin({ db, env, logger })`, so it rejected on missing env
  before reaching the code under test. Only the 3-hunk probe caught it.
- **Copy the sibling test's WHOLE `it` body — its spies and its call, not
  just its fixture — and check the helpers it names are module-level.**
  Three failures this sitting from hand-writing an invocation next to a
  correctly-copied fixture. Recorded on pack #695.
- **A design decision that blocks a fix is often an in-code comment on an
  ADJACENT guard, not anything in `docs/`.** That is what stopped #1036
  becoming a security regression. Pack #749.
- **Manual test-stack Playwright env** (unchanged, not re-run this
  sitting — **unverified**):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
  `PLAYWRIGHT_API_BASE_URL=http://localhost:3000`,
  `PLAYWRIGHT_SKIP_WEBSERVER=1`, `TEST_USER=admin`, `TEST_PASS=Admin@123`,
  `E2E_MONGO_URI='mongodb://localhost:27017?directConnection=true'`,
  `E2E_MONGO_DB=bioavanced_test`,
  `TEST_SUPPORT_SECRET=e2e-test-support-secret`.

## Filed this sitting

Here: **#1046 #1047 #1048 #1049 #1050 #1051 #1052** — all OPEN and
unworked. **None is blocked on information**; #1049 and #1051 turn on a
decision only Denise/Dennis can make, the rest are actionable.
On the pack: **#746 #747 #748 #749**, plus recurrence comments on #683
and #695 and a measured one on #409.

Query the board for everything else: `gh issue list --state open`.

## Recommended next

**Dennis named no successor to the ten.** The two owed gates come first —
the native regression in flight, then Docker — because 11 commits of
product change have landed against neither.

`#1048` is the whole-suite per-test duration sweep, and the regression
now running with `--reporter=verbose` **is** that sweep: read its
durations rather than re-running it.
