# HANDOFF

**Written:** 2026-08-25 (fourth sitting of the day). Dennis asked for a
group of 5-10 issues and said Docker was back on for the session. Ran
`issue-loop` **queue mode** over a self-picked 8-issue queue. **Three
closed; the queue is paused mid-run** — iteration 3 opened a vein of
related bugs and the session stopped to ask Dennis whether to keep
pulling on it or return to the original queue order. **He has not
answered yet.**

**The Docker gate never ran.** Docker is up and the daemon is healthy,
but every `bioavanced-test-*` image is still absent (last sitting deleted
all 24), so the gate still owes a full cold rebuild. Nothing this sitting
was verified in a container.

## What closed this sitting

Each landed as its own `fix/<slug>` branch, merged `--no-ff`, closed,
branch deleted local + remote (3/3 remote deletions succeeded, no prompt).

- **#765** (`24111993`, merged `5d0adfb7`) — `mongorestore` restored 0
  documents and exited 0, so `restoreBackup` (real disaster recovery) and
  `runControlledRestoreTest` (#731's weekly unattended run) both reported
  success over a no-op. `MONGO_URI`'s default database put mongorestore
  in its single-db use-case, where it wants `.bson` directly in the given
  directory, but `mongodump --out` writes `<dir>/<dbName>/*.bson`. New
  `stripDefaultDatabase()` rewrites only the URI path component, so
  `replicaSet`/`authSource`/TLS survive — a `new URL()` round-trip was
  rejected because it re-encodes credentials and mangles a
  comma-separated replica-set host list. `mongodump` deliberately left on
  the full URI. **Also un-weakened an existing test that asserted the
  exact broken command shape** — it predated the bug so carried no `#765`
  marker, which is why grepping for the issue number would not have found
  it (pack#420).
- **#758** (`ea70ece4`, merged `114517a5`) — the archaeology the issue
  asked for. `e2549bee` renamed *both arms* of a two-alias fallback
  (`registerDate`/`registrationDate`) to one canonical name, producing
  the duplicate output key the issue named **plus a dead `else if` eight
  lines up that it did not**. Both behaviour-invariant, both deleted.
  Added the missing positive-case coverage — the only registration-date
  test was the default-to-now path, which an empty row takes whether the
  mapping is right or wrong.
- **#767** (`ceed57db`, merged `9e9d2d70`) — filed and fixed this
  sitting. `batch-validation-engine.service.js#buildSampleRow` mapped the
  three CSV date headers onto `registrationDate`, a name
  `import-lgpd.service.js` has contained **zero occurrences of** since
  `e2549bee`. Every batch-imported sample silently got the import date.
  Fixed at the producer, not by re-adding an input alias — the repo
  already settles which name is canonical in two independent places
  (below).

## The `e2549bee` rename family — the real story of this sitting

What began as #758, a "behaviour-invariant duplicate key," turned out to
be **five** distinct casualties of one canonicalization commit. Three are
still open and two of those are real data-correctness bugs.

The common shape, worth stating because it predicts where the rest are:
**a consumer written defensively against several name spellings silently
lost its only live leg while keeping the dead ones.** Nothing errors —
an unknown key is simply not read, and a sort on an absent field is legal.

- **#767** — producer/consumer split. **Fixed.**
- **#758** — inert residue in the renamed function itself. **Fixed.**
- **#768** (OPEN) — `buildBiomarkerObservationPayloads`' `collectedAt`
  chain falls back to `specimen?.registrationDate || specimen?.registerDate`.
  `Sample.js:38` declares `registeredAt` as the only (required) date
  field, so neither leg can ever fire: a biomarker row with no date column
  gets import time instead of the specimen's date. **A green test endorses
  the dead path** (`batch-validation-engine.unit.test.js:417`) by
  hand-building a specimen shape the schema never produces — it needs
  updating alongside the fix.
- **#769** (OPEN) — two RF008 report handlers
  `.sort({ registrationDate: -1, createdAt: -1 })` on samples. The
  primary key is absent from every document, so ordering falls through to
  `createdAt`; combined with `.limit(100)` that returns **the wrong 100
  rows**, not the right ones misordered. `registeredAt` is back-datable
  and `createdAt` is not, so the two genuinely differ on any historical
  import.
- **#770** (OPEN) — `import-async.service#canonicalizeHeader` targets
  `registrationDate` too. **Honestly scoped: header-preview only**, so no
  data is lost — traced it to `import.controller.js:115` returning the
  names to the client. Latent inconsistency, not a confirmed defect. The
  remaining trace is whether a frontend consumer matches these against
  canonical field names. Same map also has a genuine duplicate key
  (`idpaciente` twice).

**Two independent sources settle the canonical name**, and neither was
known when #767 was filed — use them before treating any of this as a
judgment call:

- `api/backend/tests/architecture/canonical-fields.arch.test.js` lists
  both `registerDate` and `registrationDate` in `ASPIRATIONAL_FORBIDDEN`;
- `sample.routes.js#validateCreateSamplePayload` rejects both at the API
  boundary with `NON_CANONICAL_FIELD` (test at `sample.routes.test.js:211`).

**On sweeping further:** grepping `ASPIRATIONAL_FORBIDDEN`'s entries
against `api/backend/src` is what found #768/#769/#770 and is the cheapest
way to find the rest. But a *full* de-legacying is a project, not a
sweep — 25 files carry `sampleId`, 22 `sampleID`, 12 `patientID`, 10
`currentStatus`. The list being "aspirational" (reported, not enforced)
looks deliberate. Sweep for **silent producer/consumer and query-key
mismatches**, not for every occurrence.

## Filed this sitting, all open

**From the rename family:** #768, #769, #770 (above).

**From #765:** **#766** — `pipeline-continuity.spec.ts:1214` asserts a
*collection* count, so an empty-but-created collection would still pass.
Wants a document count, which means `runControlledRestoreTest` reporting
one (and `restoreTestHistory` carrying it, since #731's weekly run is the
real consumer).

**Skills-pack** (`DyeAllPies/dyeallpies-skills-pack`): **#419** (the Bash
tool strips one level of backslash escaping from the whole command
string, *regardless of quoting* — single-quoted strings and quoted
heredocs included; corrupted a regex literal mid-fix this sitting),
**#420** (`fix-bugs`' un-weaken step greps only for the issue number, so
it structurally misses a test that predates the bug), **#421**
(`push-wrapup-checkpoint` fires on the pre-flight sync push
`resolve-issue`'s own hygiene step prescribes), **#422** (`fix-bugs`'
dead-code exception stops at the colliding file — the bullet that would
have caught #767 is gated behind a failing test, which a
behaviour-invariant collision cannot produce). Commented a 4th
remote-delete data point on **#410** (tally now 3 denials / 4 successes,
still no predictor). Earlier: #404-#418.

## Repo state

- On `feature/docker-e2e-backend-integration` at `9e9d2d70`, pushed, in
  sync. No `fix/` branches from this sitting remain, local or remote.
- **Four older local branches still exist**, unchanged for three
  sittings: `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged into the integration
  branch (safe to delete); `test/377-docs-on-main` and
  `test/human-showcase-video` are **not** merged. #599 is intentionally
  open, held by the CI milestone's sequencing.
- **Native suites:** one known red, unchanged — `backup.service.test.js`'s
  legacy-JSON restore assertion (**#752**, red since #738 merged). It is
  *not* caused by this sitting's work; #765's own tests are green
  alongside it. Everything else run this sitting was green.
- Two untracked paths still deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A` a directory
  containing them** — every commit this sitting named its files
  explicitly.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker / cleanup

- Daemon up, **no containers running, zero `bioavanced-test-*` images**.
  The next gate pays a full cold rebuild of all 24 images.
- The four named volumes from last sitting are still present
  (`mongodb-test-data`, `neo4j-test-data`, `influxdb-test-data`,
  `redis-test-data`). Last sitting's gate ran on *fresh* volumes, which
  is what made #744/#745/#746 pass; a run inheriting these may see them
  fail again. A genuinely from-scratch run needs `docker volume rm` on
  the four first.
- Nothing was built or started this sitting, so there is no new Docker
  debris to clean.

## The queue as it stands

Picked at the session start from the 52 open issues, filtered to what is
resolvable without a decision from Dennis or live production data.

**Done:** #765, #758, #767 (the last was filed mid-run and inserted).

**Remaining from the original pick:** #756 (four sibling ID generators
carry #736's string-concat bug latently), #757 (`seedStorageBoxLocation`
writes a string into numeric `equipmentID` — the *cause* of #736), #763
(drop the now-inert two-step `find()` workaround, 4 sites), #764 (root
`test:browser*` are dead scripts), #754 (no `.env.*.example` documents
any schedule cron), #755 (architecture guard for undeclared `env.<NAME>`
reads).

**Deliberately excluded at pick time, still excluded:** #752, #761, #751,
#762, #733, #686, #687, #662, #680 — all need a call from Dennis or
Denise, not code. #753 too (a scheduled `dropDatabase` against a name
pattern is a design decision). #759 (e2e LGPD import spec) was noted as a
stretch item that would use the Docker stack well.

## Carried forward, re-confirmed this sitting

- `npm run typecheck` covers all three roots including `tests/e2e/` (#729).
- `npx tsc` at the root works (typescript is a declared root devDependency
  as of #729).
- `npm run test:smoke` selects affected files automatically and is the
  cheapest wide net for a backend fix — used every iteration this sitting.
  It still exits non-zero on the pre-existing #752 red, so read its file
  list rather than only its exit code.
- Host Playwright run against the stack (unchanged, still correct):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- The `restore-test`/`restore` endpoints take a **basename**, not the full
  path `/api/backup/perform` returns.
- Older open findings from earlier sittings: #733, #734, #735.

## Recommended next steps

**None queued** — Dennis was asked mid-run whether to keep pulling on the
rename family or return to the original queue order, and has not
answered. Do not assume either.

For whoever picks it up: **#769 and #768** are the two most serious open
bugs and both are small, well-traced fixes with the corroborating sources
already identified above. The six remaining original-queue items are all
still valid and none is blocked.

**#765 is closed but not proven in a container.** Its e2e assertion
(`pipeline-continuity.spec.ts:1214`) is unchanged and is the real proof;
it re-runs at whenever the next Docker gate happens. If it does not go
green there, reopen #765.

`ship-integration-branch` remains premature — #752 still needs a decision
on intended behaviour, and the Docker gate has not run since #738's
follow-ups landed.
