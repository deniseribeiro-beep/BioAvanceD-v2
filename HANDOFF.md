# HANDOFF

**Written:** 2026-08-25 (third sitting of the day). Dennis asked for a
group of 5-10 issues; ran `issue-loop` **queue mode** over a self-picked
7-issue queue and closed every member. He then said "Docker is on"
mid-turn, so the end-loaded Docker gate ran too — the first full gate
since #738 merged.

## What closed this sitting

Each landed as its own `fix/<slug>` branch, merged `--no-ff`, closed,
branch deleted local+remote (7/7 remote deletions succeeded).

- **#750** (`12458e8e`) — `runControlledRestoreTest` dropped its scratch
  database on the two success paths and neither failure path, so every
  failed run left a distinct timestamped orphan. Both drops now go
  through one `dropScratch()` in a `finally`; it swallows its own errors
  and logs the scratch name so a drop failure can't mask the real error.
- **#749** (`6af54bf6`) — `RETENTION_SWEEP_CRON` was read by
  `scheduler.service.js` but never declared in `env.js`, so the override
  was permanently dead. **Swept all 26 files that require the env module:
  it was the only such case.** New `tests/unit/config/env.test.js` tests
  the half `scheduler.service.test.js` structurally cannot — it assigns
  onto the already-required env object, which never exercises the
  process.env → env.js hop.
- **#736** (`d47a95f0`) — `generateUniqueEquipmentID` sorted the whole
  collection descending; in BSON order every string sorts above every
  number, so one string-typed `equipmentID` made `+1` string
  concatenation. Now filtered to `{ $type: 'number' }`.
- **#702** (`f872409b`) — `import-lgpd` validated sampleType/
  sampleOrigin/extractionProtocol with `findOne({ description: <id> })`
  against docs whose `description` is the human label. **Every row of
  every LGPD sample import was rejected.** Now queries by `id`.
- **#683** (`e5a3acbf`) — `mfaLocked` was written after 5 failed MFA
  codes and read by nothing in the login path. A correct code still
  logged in; attempts kept climbing past 5. Gate added **after** password
  verification (same place as the status guard) so a locked account
  isn't distinguishable to someone without the password.
- **#694** (`6ae02d7c`) — the shared ingestion fake's `find()` was async
  and returned a bare `{ toArray }` with no `.sort()`. Now synchronous,
  returning a chainable cursor. All 15 consumer files re-run: 22 files,
  170 tests, green.
- **#729** (`6ff37231`) — no `@types/node` anywhere; 92 tsc errors over
  `tests/e2e/`. 91 were missing-global noise; **the 92nd was a real type
  error** (`MockUser` vs `Record<string, unknown>`). Added `@types/node`
  + `typescript` at root, `DOM` lib, and a `typecheck:e2e` script chained
  into the root `typecheck`. All three roots exit 0.

Three of these were features that **did not work at all** (#702, #683,
#749), not edge cases.

## Docker gate — RUN, 199/200

Full stack from scratch with `--build`, `admin-bootstrap-test`, and all
17 reference-data bootstrap services (every one `Exited (0)`), then the
full 200-test suite from the host at `--workers=1`.

**Last sitting's four un-run assertions all passed:**
- #741 + #739 — `scientific-data-access.spec.ts` "applies the AC#1
  filters to the specimens behind a report" ✓
- #740 — `pipeline-continuity.spec.ts` "an Administrador runs a backup
  and edits the policy through the real UI" ✓
- #738 — `mode === 'mongodump'` (in the `performBackup` helper, line
  1132) ✓, so the backend image rebuild took.

**The one failure is a serious new finding: #765.** `mongorestore`
restores **0 documents and exits 0**, so both `restoreBackup` (the real
disaster-recovery restore) and `runControlledRestoreTest` report
`success: true` while doing nothing. Cause: `MONGO_URI` carries a
default database, which puts mongorestore in its single-db use-case
where it expects `.bson` directly in the given directory — but
`mongodump --out` writes `<dir>/<dbName>/*.bson`, so it says "don't know
what to do with subdirectory" and restores nothing. **Fix verified by
hand: drop the db from the URI → 32,127 documents restored instead of
0.** Not caused by this sitting — #738 made the path reachable in
containers, replacing a working JSON fallback with a silently-no-op
primary. **#731 runs this weekly, unattended, reporting success.**

**#744 / #745 / #746 all passed** — the overlay lists them as known
pre-existing gate failures. Commented on each: fresh volumes + the full
bootstrap chain is exactly what the overlay's fixture-accumulation
gotchas predict. Not closed; the cheap experiment that would settle it is
a second consecutive run against the same volumes.

**The stack is still up.** Nothing was torn down — see Cleanup below.

## Filed this sitting, all open

**From the gate:** **#765** (mongorestore no-op, above — the most
serious thing on this list).

**Blocking-ish / near-term:** **#752** — `backup.service.test.js` has
been **red on the integration branch since #738 merged** (`ace3e5c0`);
the previous handoff's "every native check is green" was wrong. #738's
canonical EJSON parse turns legacy plain-JSON restores from Double into
Int32 on the live restore path. Needs a call on which is intended.
**#762** — deploying #683 locks out any user whose `mfaLocked` is
already true; count them first.

**Follow-ups from the queue:** #753 (sweep pre-existing
`*_restoretest_*` orphans), #754 (no `.env.*.example` documents any
schedule cron), #755 (architecture guard for undeclared `env.<NAME>`
reads), #756 (four sibling ID generators share #736's bug, latent),
#757 (the fixture that writes a string into `equipmentID`), #758
(duplicate `registeredAt` key), #759 (**no e2e covers the LGPD import
path at all** — why #702 survived), #760 (locked MFA account gets
"check your credentials"), #763 (two-step `find()` workaround now
inert), #764 (root `test:browser*` are dead scripts).

**Needs a decision, not code:** #761 (MFA lockout duration policy —
dict-02 P1X-0201 is 0..1 Condicional, so the flag-only behaviour is
spec-compliant), plus **#751** carried from last sitting.

Skills-pack: **#412** (PowerShell here-string in a Bash call silently
corrupts a commit message), **#413** (fix-bugs' no-compound-command rule
reads as classifier-only but hook gates block identically), **#414**
(routing gate re-dumps the full skill per queue item), **#415** (routes
and controllers are not siblings), **#416** (**bare-vitest guard is
inconsistent** — the broader run passed, the narrower subset blocked),
**#417** (conventions' "root-level vitest" claim is false; the "don't
use `npx tsc`" rule is now fixable at source). Earlier: #404-#411.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, in sync at
  `6ff37231` plus this rotation. No `fix/` branches from this sitting
  remain, local or remote.
- **Four older local branches still exist**, unchanged from last
  sitting: `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged into the
  integration branch (safe to delete); `test/377-docs-on-main` and
  `test/human-showcase-video` are **not** merged. #599 is intentionally
  open, held by the CI milestone's sequencing.
- **Native suites:** one known red — `backup.service.test.js`'s
  legacy-JSON restore assertion (#752). Everything else run this sitting
  was green.
- Two untracked paths still deliberately untouched: `.claude/skills/`
  and `api/backend/storage/assays/`. **Never `git add -A` a directory
  containing them** — every commit this sitting named its files
  explicitly.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Cleanup still owed

**The full `compose.test.yml` stack is still running** (12 services up,
18 bootstrap containers `Exited (0)`) and images were built this
sitting. Teardown was deliberately left to Dennis since he turned Docker
on and may want the stack for #765. When done:
`docker compose --env-file .env.test.example -f compose.test.yml down`
(add `--volumes` only for a genuinely from-scratch next run — note the
fresh-volume state is what made #744/#745/#746 pass), then
`docker builder prune -af`.

## Carried forward, re-confirmed this sitting

- **`npm run typecheck` now covers all three roots** including
  `tests/e2e/` (#729) — use it.
- **`npx tsc` at the root now works** (typescript is a declared root
  devDependency as of #729). The old "prank package" warning is obsolete
  *at the root*; see pack #417.
- Host Playwright run against the stack (unchanged, still correct):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- `npm run test:smoke` still refuses any change touching `env.js`.
- The `restore-test`/`restore` endpoints take a **basename**, not the
  full path `/api/backup/perform` returns.
- Older open findings from earlier sittings: #733, #734, #735.

## Recommended next steps

None queued — Dennis has not named the next piece of work.

The obvious candidate is **#765**: it is the most serious open bug, the
fix is one small change already verified by hand against the live stack,
and the stack is still up to re-verify it. **#752** is the other thing
holding the branch back, and it needs a decision on intended behaviour
before it can be fixed.

`ship-integration-branch` is premature while #765 and #752 are open —
and it needs Dennis's explicit go separately, since it means a PR.
