# HANDOFF

**Written 2026-09-03, tenth queue sitting. The requested 10-issue queue is
discharged; no end signal from Dennis, so this is not a sign-off.** Dennis asked for "the next 10 issues to resolve, Docker is on."
**10 closed, 2 escalated.** 12 commits pushed.
7 issues filed here, 5 on the pack.

**The Docker gate RAN GREEN: 12 passed (11.9s), none skipped**, covering both
new e2e specs plus the 10 pre-existing tests in those two files. Re-derive
every count below rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed. `main`
  untouched, no PR.
- Last substantive commit: `8b8e93f4` (#1017).
- **New npm scripts / dependencies / env keys: none.** `@vitejs/plugin-react`
  was already a devDependency; #1019 only wired it into a second config.
- New test files: `frontend/src/components/AnalysisUpload.test.tsx` — the
  repo's **first** test to *render* a `.jsx` component.

## Docker state

- **Stack was empty at sitting start** and is **DOWN again now** — brought
  up with `--build` (this sitting changed backend source), gated, then
  `docker compose down --remove-orphans`. No containers left running.
- **Both bootstraps ran and exited 0** against the current volumes:
  `admin-bootstrap-test` and `foundation-bootstrap-test`. The LGPD spec's
  MIABIS ids are the real seeded ones, so skipping the foundation seed is
  the highest-probability false red on a first gate — it was not skipped.
- **`docker compose up -d --wait` exit-code traps, both hit and both
  harmless:** it exits **1** on a one-shot service that succeeded
  (`admin-bootstrap-test` showed `Exited (0)`), and it exits **0** while
  ignoring services with no healthcheck. Read `compose ps` states, never
  the exit code.
- Cleanup: `docker builder prune -af` reclaimed **1.047GB**. Images back to
  the pre-existing **33 / 4.683GB**; **56 local volumes / 1.537GB** (7 more
  than last sitting, all compose-managed and near-empty). The
  `bioavanced-test-*` named volumes are **kept** — dropping them, and any
  machine-wide `prune -a`, still needs Dennis's consent.

## What closed (10)

`#1019` `#974` `#1010` `#1012` `#1016` `#1017` `#1024` `#997` `#1015` `#1022`.

## The two the gate closed

- **#997** — `tests/e2e/lgpd-sample-import.spec.ts:269`, commit `7c49132d`.
  Proves a real HTTP import response carries `data.skipped`.
- **#1015** — `tests/e2e/sample-storage-lifecycle.spec.ts:209`, commit
  `1d24f7a8`. `POST /api/storage/allocate/auto` was the last of the four
  storage mutations with no real-backend coverage.

**[ran it] `npm run test:e2e:docker -- <those two specs> --workers=1
--reporter=list` → 12 passed (11.9s), none skipped.**

## Escalated, not worked (2)

**#988 / #990 are blocked on #1026**, which this sitting filed and which is
the more important issue of the three. The deferral ladder was walked —
code, env files, compose files, canonical requirements, milestones.

## The judgment a query cannot carry

- **[ran it] `enforceAppendOnlyCollection` was one-shot per PROCESS**, keyed
  by collection *name*, so `sample_movements` append-only enforcement was
  order-dependent and absent from the second call onward — and
  `appendImmutableAudit` builds a fresh view every invocation, so every
  audit append after the first ran unguarded. Fixed (`041ee8b3`, WeakSet on
  object identity). **The reason no test saw it: every case in that describe
  passes a distinct `collectionName`**, so each got a fresh wrap.
- **[ran it] Every `vi.mock` specifier in `users-access.routes.test.js`
  resolved to `null`.** The file is at `api/backend/tests/integration/`, so
  `../../../src` is `api/src`, which does not exist. **Both** mocks were
  inert — including `auth.service`, which #1017's body asserted was working.
  Vitest retries a failed dynamic `import` root-relative (which is why the
  `await import`s worked) and does **not** extend that retry to `vi.mock`.
  A mock's presence is never evidence it is installed.
- **[ran it] The remedy for a lazily-required CJS module is to spy on the
  module object loaded through the same `require` as the SUT** — never
  `vi.mock`, which does not intercept a lazy in-handler require even at the
  correct path. `auth.routes.test.js` in the same directory is the working
  precedent. **The cheap proof the spies landed is that the
  `AUDIT_TRAIL_WRITE_FAILURE` stderr block disappears from the run.**
- **[read it] `consent.service.js:952` hardcodes `specimenId: null`**, and
  `neo4jCanonicalProjection.service.js:79` falls back to `event.aggregateId`
  — so `GOVERNED_BY` lands on a phantom `Sample` node keyed by the *consent*
  id. Nothing writes `Sample.consentStatus` either, so
  `validateBeforePersistence` denies **every real specimen**. `.env.production`
  runs `fail-closed`. **#1026**, and it violates RNF012 AC#1 (Alta), which
  requires participant→specimen→location lineage to be recoverable.
- **[read it] `LINEAGE_MODE` is effectively boolean** — all seven read sites
  compare `=== 'fail-closed'`, so any typo means fail-open. It is fail-open
  in code, in `.env.docker`, and in `compose.test.yml` (unset); fail-closed
  only in production.
- **[ran it] The `isEmptyRow` backstops were unreachable in all three
  importers**, by one argument repeated three times — and on the Excel side
  it is *gate two* that closes it, not gate one. The docs half of the
  dead-code protocol came back **empty**; the consumer half did **not** (nine
  tests), so the default did not authorise the deletion on its own.

## Conventions this sitting relied on / established

- **A claim from another agent's report is not firsthand.** One reached a
  second agent's brief as established fact and was refuted by that worker.
  The `verify-each-precedent` clause is what caught it — twice. Pack **#712**.
- **A leaf worker cannot run `gh`**, so a brief must transcribe the
  load-bearing issue comments rather than saying "read the issue". Pack **#711**.
- **Derive the consumer set from the changed FUNCTION, not the module** — a
  module-level two-hop sweep on `session.service` returns ~65 test files,
  most of which only stub auth middleware.
- **When the changed file is the test runner's own config, the consumer set
  is the whole suite** and the sanctioned explicit-breadth run is the
  targeted one. Pack **#709**.

## Filed this sitting

Here: **#1020 #1021 #1023 #1025 #1026** open; **#1022** and **#1024** were
filed and closed in the same sitting.
On the pack: **#709 #710 #711 #712 #713**. Comments on pack #579, #657.

**Worth reading first: #1026** (consent projection keys `GOVERNED_BY` onto a
phantom node — production-shaped, blocks #988), then **#1021** (a `PUT` that
merely *omits* `mfaEnabled` disables an admin's MFA; the inline comment says
that is deliberate).

Query the board for everything else: `gh issue list --state open`.

## Recommended next

**None queued by Dennis.** The one thing genuinely waiting on him is
**#1026's direction** — it blocks #988/#990 and is the highest-value open
item this sitting produced.

The cheapest unblocked work on the board is **#1025** — apply #1017's spy
remedy to `user-security.routes.test.js`. Its controller requires
auditLogger at BOTH module scope and lazily, so correcting the path alone
changes that suite's behaviour; that is why it was split rather than done
as a drive-by.

**#1025 is the one issue this sitting filed and did not discharge** — not
blocked, not the owner's call, simply not reached. Recorded plainly rather
than dressed as a disposition.
