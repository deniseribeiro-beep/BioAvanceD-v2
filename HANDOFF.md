# HANDOFF

**Written:** 2026-08-25 (fifth sitting of the day). Dennis asked for a
group of 5-10 issues with **Docker on**, then twice pushed the session to
keep going. Ran `issue-loop` **queue mode** over a self-picked 9-issue
queue and took it to the end.

**All 9 closed. The Docker gate ran, from scratch, and was green.** This
is the first sitting in several where the gate actually executed rather
than being owed forward.

## What closed

Each landed as its own `fix/<slug>` branch, merged `--no-ff`, closed,
branch deleted local + remote (9/9 remote deletions succeeded, no prompt).

**The `e2549bee` rename family — now fully closed** (#758/#767 last
sitting, these three this one):

- **#769** (`5bb10207` → `ac3d1c3e`) — two RF008 report handlers sorted
  samples on `registrationDate`, absent from every document, so ordering
  fell through to `createdAt` and `.limit(100)` returned **the wrong 100
  rows**, not the right 100 misordered. **Not upstream drift** —
  `origin/main`'s newest commit for that file *is* `e2549bee` and main's
  copy carries the same bug.
- **#768** (`ad77495f` → `9901194a`) — the `collectedAt` specimen legs
  were dead, so biomarker rows with no date column got **import time**.
  The two leg pairs are **genuinely different**: the `specimen` legs are
  unreachable and were deleted; the **`rawRow` legs are live** (a CSV
  column literally spelled `registrationDate` reaches them) and were kept
  with their own test, which was green before the fix — that is what
  proved the distinction. **Do not sweep them away later as "more of the
  same."**
- **#770** (`c093b5df` → `0df33522`) — three CSV date aliases repointed;
  duplicate `idpaciente` key removed.

**The #736 string-concat family:**

- **#757** (`3074c147` → `5581466b`) — `seedStorageBoxLocation()` wrote a
  `RF004-e2e-EQ-<ts>` string into **two** fields both declared numeric.
  The issue knew only about `equipmentID`; `StorageContainer.js:6`
  declares `containerID: { type: Number }` too, and they **cannot be
  typed independently** because `sample.service.js:244` joins them.
- **#756** (`b2a3bbc2` → `65444411`) — the four sibling ID generators got
  #736's `$type: 'number'` filter. `makeEquipmentDbMock` generalized to
  `makeIdDbMock(field, docs)` rather than copied four times.

**Guards and docs:**

- **#755** (`b61d976a` → `2e6da724`) — new
  `tests/architecture/env-declarations.arch.test.js`: three guards
  against an `env.<NAME>` read env.js never declares.
- **#777** (`32c6ee72` → `93bca8b0`) — **defect in #755's own guard**,
  found an hour later: it walked `src/` only, missing `app.js` and
  `server.js`, both real `config/env` importers.
- **#754** (`e8107e32` → `51d2965a`) — the schedule cron variables
  documented in the example files.

**Docker-proven:**

- **#658** (`a7a4f016` → `9cffa8dc`) — `backend-unit-runner` had no
  `docs/` mount. Mount point is **`/docs`, not `/app/docs`**: in-container
  `__dirname` is `/app/scripts` and `REPO_ROOT`'s `../../..` clamps at the
  filesystem root.
- **#766** (`3a1159b0` → `bc2c86a0`) — restore test now reports a
  **document** count, not just a collection count, on both the
  mongorestore and JSON-fallback paths, normalized onto one shape.

## The Docker gate — what actually ran

Genuinely from scratch: all four named volumes removed first, 24 images
cold-rebuilt, 12 core services + `admin-bootstrap-test` + the full
17-service reference-data chain (all `Exited (0)`).

| Check | Result |
|---|---|
| `backend-unit-runner` (#658) | **exit 0**, `dictionary:validate` verified 929/929 elements, no ENOENT |
| `pipeline-continuity.spec.ts` (#766, #765) | **58/58 passed** |
| The five `seedStorageBoxLocation` specs (#757) | **70/70 passed** |

**#765's carried-forward caveat is resolved.** Two handoffs said "if
`pipeline-continuity.spec.ts:1214` does not go green at the next gate,
reopen #765." It went green. **Do not reopen #765.**

**#757's proof is the join, not the absence of failure.** Four of the five
specs push `boxId`/`positionCode` through `createSample` (61 references in
`specimen-quality-inventory` alone), each hitting the RF004 equipment
join. Zero occurrences of `não está cadastrado` in the Playwright output
*or* `backend-app-test`'s container logs across the whole run.

## Filed this sitting, all open

- **#771** — **165 sort-swallowing mock sites across 80 test files**. The
  whole "query orders on a field nothing writes" class is structurally
  invisible to the backend suite. **The suggested fix is an architecture
  test over `.sort({...})` literals in `src/`, not upgrading 80 test
  files** — it catches the product half directly and would have caught
  #769 with no mock changes. Bigger than a queue item.
- **#772** — `useAsyncImport.ts` is dead code (imported by nothing), and
  `useImportJob.ts:286` claims a caller relationship that does not exist.
- **#773** — `canonicalizeHeader` still targets `patientID`. Deliberately
  not folded into #770: different rename family (#146), only one
  corroborating source available.
- **#774** — `Equipment.EQUIPMENT_STATUS` (allow-list) and
  `BLOCKED_EQUIPMENT_STATUSES` (deny-list, **triplicated** across three
  files) share **no vocabulary**. The e2e fixture's `status: 'operational'`
  is in neither and passes the gate *because* it is unrecognized.
- **#775** — `generateUniqueBarcode` **throws permanently from the 1002nd
  sample of a calendar year**: `padStart(3,'0')` overflows to 4 digits and
  `'BR-2026-999'` sorts above `'BR-2026-1000'` lexicographically. For a
  biobank that is an ordinary year, and it fails late.
- **#776** — the four sibling generators have **no caller in `src/`**;
  their models promise auto-generation nothing performs.
- **#778** — `ENABLE_CONSENT_SYNC` / `CONSENT_SYNC_CRON` /
  `CONSENT_SYNC_BATCH_SIZE` are declared but the schedule they configure
  was deleted. The mirror image of #749.

**Skills-pack** (`DyeAllPies/dyeallpies-skills-pack`): **#424** (mock
bullet names only query filters, not `.sort()`), **#425**
(`verify-intent` returning "not drift" reads as the routing decision),
**#426** (an issue body's file-and-line traces are treated as fact, not
hypothesis), **#427** (`branch-guard.cjs` blocks a bare read-only `git
branch` when the next command is newline-separated), **#428** (`handoff`
has no rotation cadence for multi-iteration runs), **#429** (`fix-bugs`
has no close-discipline branch for a fix only provable at a deferred
gate), **#430** (**queue mode stops and asks permission** — Dennis's
two-tier session-end proposal is on the thread), **#431** (`npx node
--test` downloads a Node distribution). Also two substantial comments on
**#419** and a consolidated tally on **#410**.

## Repo state

- On `feature/docker-e2e-backend-integration` at the #766 merge, pushed,
  in sync. **No `fix/` branches from this sitting remain**, local or
  remote.
- **Four older local branches**, unchanged for five sittings:
  `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged (safe to delete);
  `test/377-docs-on-main` and `test/human-showcase-video` are **not**
  merged. #599 is intentionally open, held by the CI milestone.
- **Two stale *remote* branches** with no local counterpart, still left
  alone deliberately: `origin/fix/705-seed-active-terminology-concept-cleanup`
  and `origin/test/377-docs-on-main`. They predate this session, so
  `clean-up`'s scope rule excludes them, and its authorship check applies
  — precedent #332, where 5 of 13 turned out to be a collaborator's work.
  **Verify merge status *and* per-commit authorship before deleting.**
- **Native suites: one known red, unchanged** — `backup.service.test.js`'s
  legacy-JSON restore assertion (**#752**). Confirmed present on the
  unmodified tree by stashing this sitting's changes and re-running, so it
  is definitively not from this work. Architecture suite is **65/65**.
- Two untracked paths still deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`** — every commit
  this sitting named its files explicitly.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker / cleanup

- **Stack torn down** (`docker compose down`), 0 containers, all 25
  session-built `bioavanced-test-*` images removed, builder cache pruned
  with `-af` (1.208GB reclaimed, now 0B).
- **The four named volumes were left in place** — they are the caching
  design and `docker-workflow` forbids clearing them as routine hygiene.
  **But they now hold this sitting's e2e fixture data.** A genuinely
  from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first, as was
  done at the start of this one.
- **WSL2 vhdx is 13.93GB physical against ~3.7GB logical** (~10GB of air).
  Short of the "34GB behind 4GB" bar `docker-workflow` sets for a reset,
  and a reset wipes base images — flagged, not acted on.
- 6 base images (2.839GB) left: not session-built, and machine-wide prunes
  need Dennis's fresh consent.

## Carried forward, re-confirmed this sitting

- **The gate recipe in `docker-workflow`'s overlay is accurate as
  written** — 12 core services, then `admin-bootstrap-test`, then the
  17-service chain. Used verbatim, worked first time.
- Host Playwright command (unchanged, still correct):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **`npm run test:smoke` selects by *working-tree diff*** — it reports
  "nothing to run" once a merge is committed. Useful before committing,
  useless after. Read its file list, not its exit code (#752 red).
- **One architecture test is deliberately SKIPped in-container** (the
  `.github/workflows/` reachability check) — so 64 pass in-container vs
  65 natively is correct, not a stale image. Its own skip message says so.
- **Two independent sources settle canonical field names:**
  `canonical-fields.arch.test.js` and `sample.routes.js`'s
  `NON_CANONICAL_FIELD` rejection.
- **Routes and controllers are not siblings** — `src/interface/routes/`
  vs `src/controllers/`.
- **`node -e` with a regex is unsafe here** — backslashes are stripped
  above the quoting layer and can produce a pattern that parses fine and
  matches *nothing*, which reads as a valid negative result. One sweep
  this sitting reported 100/100 env keys as dead before being caught.
  Use a script file, or `chr(92)`. (pack#419)
- Older open findings from earlier sittings: #733, #734, #735.

## Recommended next steps

**None queued** — the queue Dennis authorized is complete and he named no
successor.

For whoever picks it up, the strongest candidates from what this sitting
filed are **#775** (a hard production ceiling at ~1000 samples/year, in
the core sample-creation path) and **#771** (the 165-mock blind spot,
whose suggested arch-test fix would retroactively cover the whole
`e2549bee` family's query-side failures).

**`ship-integration-branch` is now closer than it has been.** The Docker
gate is green and #738's follow-ups are proven. The remaining blocker is
**#752** — it still needs a decision on intended behaviour, and it is the
one red in the native suite.
