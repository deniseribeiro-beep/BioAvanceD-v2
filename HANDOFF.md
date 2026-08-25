# HANDOFF

**Written:** 2026-08-25 (fifth sitting of the day). Dennis asked for a
fresh group of 5-10 issues and confirmed **Docker is on**. Ran
`issue-loop` **queue mode** over a self-picked 9-issue queue. **Three
closed, a fourth (#757) merged but deliberately left open, five remain**
— the queue is paused mid-run at the point where the native-verifiable
work ends, not because anything blocked.

The three closed complete the **`e2549bee` rename family**, which the
previous sitting had paused on pending a decision from Dennis. His "pick
the next group" answered it implicitly, and the family is now **fully
closed**: #758, #767 (last sitting), #768, #769, #770 (this one).

**The Docker gate still has not run.** Daemon up, no containers, **zero
`bioavanced-test-*` images** — the next gate pays a full cold rebuild of
all 24. Nothing this sitting was verified in a container.

## What closed this sitting

Each landed as its own `fix/<slug>` branch, merged `--no-ff`, closed,
branch deleted local + remote (3/3 remote deletions succeeded, no prompt).

- **#769** (`5bb10207`, merged `ac3d1c3e`) — two RF008 report handlers
  sorted samples on `registrationDate`, absent from every document, so
  ordering fell through to `createdAt` and `.limit(100)` returned **the
  wrong 100 rows**, not the right 100 misordered. Both now sort
  `registeredAt`, `createdAt` tiebreaker kept deliberately.
  **Not upstream drift** — `origin/main`'s newest commit for that file
  *is* `e2549bee` and main's copy carries the same bug. Four sources
  corroborated the canonical name; the strongest was previously unknown:
  **the same file already queries `registeredAt` at line 237-241**, with
  a comment explaining `createdAt` is the fallback for legacy/import rows.
- **#768** (`ad77495f`, merged `9901194a`) — the `collectedAt` specimen
  legs in `buildBiomarkerObservationPayloads` were dead, so every
  biomarker row without a date column got **import time** instead of the
  specimen's registration date. Resolved the issue's open keep-or-delete
  sub-question by tracing rather than guessing, and **the two leg pairs
  are genuinely different**: the `specimen` legs are unreachable
  (specimen is `createSample()`'s return value, which always carries
  `registeredAt`) and were deleted; the `rawRow` legs are reachable
  (persistSample gets the **un-canonicalized** CSV row, so a column
  literally spelled `registrationDate` still arrives) and were kept
  **with their own new test**, which was already green before the fix —
  that is what confirmed the distinction. Do not delete them in a future
  sweep as "more of the same."
- **#770** (`c093b5df`, merged `0df33522`) — three CSV date-header
  aliases repointed at `registeredAt`; duplicate `idpaciente` key removed.

**#757 (`3074c147`, merged `5581466b`) is merged but INTENTIONALLY STILL
OPEN**, and its branch `fix/757-fixture-numeric-equipment-id` is
intentionally still present local + remote. `seedStorageBoxLocation()`
wrote a `RF004-e2e-EQ-<ts>` string into two fields both declared numeric
— `StorageContainer.containerID` (`type: Number`) and
`Equipment.equipmentID` (rejects a non-number). A raw `insertOne`
bypassed both. #757 only knew about the equipment half; the two **cannot
be typed independently**, because `sample.service.js:244` joins them
(`equipmentID: { $in: buildIdVariants(freezer.containerID) }`, the RF004
gate). Type settled by three sources: both schemas plus
`legacy-location-migration-mapping.md:26`/`:97`.

**Why it is open:** the fixture only executes under Playwright against a
live stack. Typecheck and unit suites prove nothing else broke; they
cannot prove the thing the fix is for. **Close it only when these five
specs go green at the Docker gate** — `intake-wizard`,
`sample-files-section-ui`, `sample-storage-lifecycle`,
`scientific-data-access`, `specimen-quality-inventory`. If they are red,
the analysis in the issue comment is where to restart.

## #770's trace was wrong — read this before trusting an issue body here

#770's body stated, specifically and confidently, that
`canonicalizeHeader`'s output reaches `import.controller.js:115`.
**It does not.** That line returns
`import.service.js#validateCSVStructure`'s headers — a **different
service that never calls `canonicalizeHeader`**. The repo has two import
services with parallel `validate` methods, and `/api/import/validate`
routes to the *async* one. Easy to conflate; a grep for the right string
lands in the wrong file.

The real path, and it changes the severity in both directions:

    canonicalizeHeader -> getHeadersFromFile (182, 227)
      -> import-async.service#validateFile:61 -> metadata.headers
      -> import-async.controller:109/118 -> client
      -> ALSO persisted onto the importJobs document (line 271)

So the values **are** written to the database, contradicting the issue's
"no sample data is written through this path." But its *conclusion*
still holds, for a reason it did not know: **`metadata.headers` has one
writer and zero readers.** The worker never consults it to map columns,
and the frontend hook that would (`useAsyncImport.ts`) is imported by no
component at all.

Generalized as pack#426: `fix-bugs` treats an issue's *label* as
hypothesis-grade but says nothing about its *body's* file-and-line
traces, which read as more authoritative, not less.

## Filed this sitting, all open

- **#771** — the mock weakness that hid #769 is **not** confined to one
  file: **165 sort-swallowing mock sites across 80 test files**
  (`sort() { return chain; }` / `sort: () => cursor`). The whole "query
  orders on a field nothing writes" class is structurally invisible to
  the backend suite. **Suggested an architecture test over `.sort({...})`
  literals as the higher-value fix** — it catches the product half
  directly and is independent of upgrading 80 test files.
- **#772** — `useAsyncImport.ts` is dead code (imported by nothing), and
  `useImportJob.ts:286` carries a comment asserting a caller relationship
  that does not exist. Delete-vs-wire-in is the owner's call; the backend
  it targets is live and tested, so it reads as "never mounted" rather
  than "abandoned."
- **#774** — `Equipment.EQUIPMENT_STATUS` (allow-list:
  `Calibrado/Maintenance/Active/Inactive/Needs Calibration`) and
  `BLOCKED_EQUIPMENT_STATUSES` (deny-list, **triplicated** across
  `sample.service.js:31`, `intakeWizard.js:292`,
  `import-lgpd.service.js:36`) share **no vocabulary**. The fixture's
  `status: 'operational'` is in neither — it passes the RF004 gate
  precisely because it is unrecognized, while the model would refuse to
  persist it. `error`/`retired` are blocked but cannot be produced.
  Needs a decision, not a type fix.
- **#773** — the same `canonicalizeHeader` map still targets `patientID`,
  also on `ASPIRATIONAL_FORBIDDEN`. **Deliberately not folded into #770**:
  different rename family (#146), and only one corroborating source was
  available for it versus `registeredAt`'s two.

**Skills-pack** (`DyeAllPies/dyeallpies-skills-pack`): **#424**
(`fix-bugs`' mirror-case bullet says to tighten a mock ignoring its
*query filter*; the file that hid #769 had already done that and still
could not see it, because the bug was in the `.sort()` spec one method
over), **#425** (the routing-gate displacement below), **#426** (the
issue-body-trace gap above), **#427** (`branch-guard.cjs` blocks a bare
read-only `git branch` when the next command is newline-separated — it
reads the following command's first token as a start-point; `&&` is
fine, newline is not), **#428** (`handoff` gives no rotation cadence for
a long multi-iteration run, so "once at the end" is a plausible reading
that leaves the note stale the whole time — the Stop checkpoint had to
fire this sitting because of it), **#429** (`fix-bugs` has no
close-discipline branch for a fix whose only proof runs at a gate that
has not happened yet — the `Refs`/merge/leave-open pattern used for #757
was improvised). Commented a 5th remote-delete data point on **#410**
(tally now 3 denials / 5 successes, still no predictor).

## Process note worth carrying — the routing gate fired for real

Iteration 2 (#768) reached `gh issue close` **without ever having invoked
`fix-bugs` for that issue number**, and the routing gate blocked it there
— after the fix was already written, tested, merged and pushed.

The cause is specific and will recur: the `work-issue` overlay says
rename-family issues should "check route 7 (`verify-intent`) first."
That check ran, concluded *"not drift, this is a plain bug"* — and that
conclusion **read as the routing decision having been made**. It had not.
Iteration 1 did it correctly ten minutes earlier with the same overlay
and same check; the difference was purely that the negative result felt
conclusive the second time.

`issue-loop`'s existing warning only pictures a session that invokes
*nothing*, so it does not cover this displacement case. Filed as
pack#425. **Until that lands: after `verify-intent` returns "not drift,"
invoke the actual route before the first edit.**

## Repo state

- On `feature/docker-e2e-backend-integration` at `5581466b`, pushed, in
  sync. **`fix/757-fixture-numeric-equipment-id` is retained local +
  remote on purpose** — `clean-up`'s branch domain only deletes a merged
  branch once its issue is closed, and #757 is deliberately open pending
  the Docker gate. Delete it when #757 closes. The other three fix
  branches from this sitting are gone, local and remote.
- **Four older local branches**, unchanged for four sittings:
  `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged into the integration
  branch (safe to delete); `test/377-docs-on-main` and
  `test/human-showcase-video` are **not** merged. #599 is intentionally
  open, held by the CI milestone's sequencing.
- **Three stale *remote* branches with no local counterpart**, unchanged
  and **still left alone deliberately**:
  `origin/fix/696-intake-wizard-clinical-entities-real-backend-e2e`,
  `origin/fix/705-seed-active-terminology-concept-cleanup`,
  `origin/fix/project-issues-stabilization`. They predate this session,
  so `clean-up`'s scope rule puts them out of scope, and its authorship
  check applies. Precedent: #332, where 5 of 13 stale remote branches
  about to be deleted on merge+closed state alone turned out to be
  someone else's work. **Verify merge status *and* per-commit authorship
  before deleting any of them.**
- **Native suites:** one known red, unchanged — `backup.service.test.js`'s
  legacy-JSON restore assertion (**#752**, red since #738 merged). Not
  caused by this sitting. Everything run this sitting was green:
  61/61 architecture every iteration, plus the targeted suites.
- Two untracked paths still deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A` a directory
  containing them** — every commit this sitting named its files
  explicitly.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker / cleanup

- Daemon up, **no containers running, zero `bioavanced-test-*` images**.
  The next gate pays a full cold rebuild of all 24 images.
- The four named volumes are still present
  (`bioavanced-test_mongodb-test-data`, `..._neo4j-test-data`,
  `..._influxdb-test-data`, `..._redis-test-data`). A sitting before last
  ran its gate on *fresh* volumes, which is what made #744/#745/#746
  pass; a run inheriting these may see them fail again. **A genuinely
  from-scratch run needs `docker volume rm` on the four first.**
- Nothing was built or started this sitting, so there is no new Docker
  debris.

## The queue as it stands

Dennis authorized "a group of 5-10 issues, Docker on" but **did not name
individual numbers** — the nine below were picked from the 51 open,
filtered to what is resolvable without a call from him or Denise.

**Done:** #769, #768, #770. **#757 merged, awaiting live proof** (above).

**Remaining, in the intended order:**

1. **#756** — four sibling ID generators carry #736's string-concat bug
   latently. One-line `$type: 'number'` filter each; generalize
   `makeEquipmentDbMock` over the field name rather than writing four.
   **Do not reuse the pre-existing `makeDbMock`** — it ignores its query
   filter, which is exactly why the existing tests could not see this.
2. **#755** — architecture guard for `env.<NAME>` reads with no `env.js`
   declaration. Note the author's warning: exclude `process.env.<NAME>`
   or the sweep produces ~75 false positives.
3. **#754** — document the five schedule cron vars in `.env.*.example`.
   Confirm each default against the code; the issue's list was read off
   `||` fallbacks, not audited.
4. **#658** — `backend-unit-runner` has no `docs/` mount, so
   `dictionary:validate` ENOENTs. **Docker-verifiable now.** Worth doing
   before #599 lands, or #599 becomes an instant red build.
5. **#766** — restore-test asserts a *collection* count, not a document
   count. Needs `runControlledRestoreTest` to report one and
   `restoreTestHistory` to carry it. **Docker-verifiable.**

**Excluded at pick time and still excluded:** #764 is a genuine owner
decision (delete the dead root `test:browser*` scripts vs. wire a root
vitest). #763 is pure cosmetics — the leftover if the queue runs short.
#752, #761, #751, #762, #733, #686, #687, #662, #680, #753 all need a
call from Dennis or Denise, not code. #759 (e2e LGPD import spec) remains
a stretch item that would use the Docker stack well.

## Carried forward, re-confirmed this sitting

- `npm run test:smoke` selects affected files automatically and is the
  cheapest wide net — used every iteration. It still exits non-zero on
  the pre-existing #752 red, so **read its file list, not only its exit
  code**.
- `npm run test:architecture` (61 tests) is fast and worth running on any
  canonical-naming change — it is the `ASPIRATIONAL_FORBIDDEN` source.
- **The two independent sources that settle canonical field names:**
  `api/backend/tests/architecture/canonical-fields.arch.test.js` and
  `sample.routes.js#validateCreateSamplePayload`'s `NON_CANONICAL_FIELD`
  rejection (test at `sample.routes.test.js:211`).
- **Routes and controllers are not siblings** — `src/interface/routes/`
  vs `src/controllers/`. Cost a wrong guess again this sitting.
- Host Playwright run against the stack (unchanged, still correct):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- The `restore-test`/`restore` endpoints take a **basename**, not the
  full path `/api/backup/perform` returns.
- Older open findings from earlier sittings: #733, #734, #735.

## Recommended next steps

**Continue the queue at #756**, per the ordering above — Dennis's "pick
5-10, Docker on" is a standing instruction and the run is paused
mid-queue, not blocked. Nothing in items 1-5 needs a decision from him.

**The Docker gate now owes three confirmations, not one:** #757's five
specs (above), #658, and #766. Batch them into the single cold rebuild
rather than paying it per item.

**#765 remains closed but unproven in a container.** Its e2e assertion
(`pipeline-continuity.spec.ts:1214`) is the real proof and re-runs at the
next Docker gate. If it does not go green there, reopen #765. #766 (queue
item 5) touches that exact assertion, so the two want doing together.

`ship-integration-branch` remains premature — #752 still needs a decision
on intended behaviour, and the Docker gate has not run since #738's
follow-ups landed.
