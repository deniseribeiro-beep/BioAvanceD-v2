# HANDOFF

**Written:** 2026-08-25 (sixth sitting of the day). Dennis asked for a
group of issues with **Docker on**, explicitly to exercise the
skills-pack updates that landed at the end of the previous sitting. Ran
`issue-loop` **queue mode** over a self-picked, explicitly-numbered
7-issue queue and took it to the end.

**6 of 7 closed; the 7th is open on a decision only Denise can make.**
**The Docker gate ran from scratch and was green.**

## The queue

Numbers were named directly in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` could see the queue — that hook only
recognizes a closed, explicit list. Classification ran **once up front
for the whole list**, per queue mode's closed-explicit-list rule.

| # | What | Route | Outcome |
|---|---|---|---|
| **775** | `generateUniqueBarcode` ceiling past 999/year | fix-bugs | closed |
| **771** | arch guard over `.sort({...})` keys | unit-test-loop | closed |
| **772** | `useAsyncImport.ts` dead code | resolve-issue | **open — Denise's call** |
| **763** | drop inert two-step `find()` workaround | resolve-issue | closed |
| **764** | delete dead root `test:browser*` scripts | resolve-issue | closed |
| **778** | delete dead consent-sync env declarations | resolve-issue | closed |
| **759** | e2e spec for the LGPD sample-import path | e2e-test-loop | closed |

Each landed as its own `fix/`/`test/` branch, merged `--no-ff`, closed,
branch deleted local + remote (**5/5 remote deletions succeeded, no
prompt** — five more data points for pack #410).

**Deliberately excluded from the queue, all still open:** #774 and #753
(each needs Denise's call), #752 (needs Dennis's behaviour decision, and
is the one red in the native suite).

## What closed

- **#775** (`bab7abf5` → `1ea99f5a`) — the year's highest barcode was
  found with `sort: { barcode: -1 }` on a *string*, so `BR-2026-999`
  outranked `BR-2026-1000` and generation threw **permanently from the
  1002nd sample of a calendar year**. Took option 2 (numeric max in JS):
  format and existing rows untouched. The two-attempt race guard became
  a bounded 10-attempt loop.
  - **The format question the issue left to the owner was settled by
    docs, not by a decision** — `dict-02` ELM-0116 constrains
    `barcodeValue` only to a unique string.
  - **A test asserting the numeric max needs a *gap* to discriminate.**
    With only `1000` present the buggy code also returns `1001`, by
    collision-bump luck. Use `...999` + `1005`.

- **#771** (`556d3a05` → `07eb4f4b`) — new
  `tests/architecture/sort-keys.arch.test.js`. Architecture suite
  **70/70** (was 65).
  - **The issue's stated design was not buildable as written.** It asked
    for "a field the target model declares", but only **14 of the 85**
    files in `src/models` are mongoose schemas; the rest are validator
    classes declaring no field list, and the audit-chain and outbox
    collections have *no model file at all* while sorting on real
    fields. A models-only vocabulary flags every one of those.
  - Invariant used instead: **a query must not order on a field nothing
    writes** — object-literal keys + `x.field = ...` + schema paths,
    **with sort specs blanked out of that sweep** so a spec cannot vouch
    for its own keys.
  - **Proven before being trusted:** `registrationDate`/`registerDate`
    are absent from the vocabulary, so #769 would have failed here with
    no mock changes.
  - **Its synthetic-source test caught a live defect in the guard on the
    first run** — the key extractor sliced onto the opening `{`, so the
    anchor never matched, zero keys came out, and the main assertion
    passed by seeing nothing. **Any future static guard needs its own
    does-it-still-match test.**
  - 110 sort specs, 47 distinct keys, **zero offenders** — a regression
    guard, not a bug sweep.

- **#763** (`0ce355aa` → `8e86e99c`) — the four two-step `find()` sites
  rewritten to the chained form.
  - **The issue's premise was wrong: the workaround was not inert.** A
    *second* fake still had the pre-#694 `async find()` shape
    (`intakeWizard.clinicalEntities.test.js:95`). The chained form broke
    it, and `recordClinicalEntities`' per-entity try/catch swallowed the
    throw — the intake returned **200 with no Condition recorded**, and
    the test failed as `expected [] to have a length of 1`, not as an
    error. Fake now matches the driver; a tree-wide sweep confirms **no
    other `async find()` stub remains**.

- **#764** (`e0815beb` → `4cfb73c1`) — the three dead root
  `test:browser*` scripts deleted, after re-verifying all three
  conditions (no root `vitest` dep, no config, no root test files).

- **#778** (`fa627d42` → `1da295e2`) — the three dead consent-sync env
  declarations removed.
  - **The issue missed one reference:** `tests/unit/config/env.test.js`
    listed `CONSENT_SYNC_CRON` among "every cron expression
    `scheduler.service.js` reads off the env module" — it never read that
    one. **The declaration and the test pinning it were mutually
    reinforcing**, and it is the same false premise #754 nearly
    published to the `.env.*.example` files.

- **#759** (`24e7dcd1` → `1bc290f4`) — new
  `tests/e2e/lgpd-sample-import.spec.ts`, three tests against the live
  stack. The valid-row test is the **#702 guard**: it pushes real MIABIS
  ids through the reference lookup and reads the sample back through the
  API, so under #702's bug the row is rejected and it fails.
  - **Assertion order matters here:** `errorsDetails` is asserted before
    the counts, because #702 returned a well-formed 200 with the
    rejections *inside* it.
  - **The obvious negative test does not reach #702's code path.**
    `SampleModel.validate` (MIABIS constants) rejects an unknown
    `sampleType` *before* the seeded-reference lookup at
    `import-lgpd.service.js:1011`, with a message that does not echo the
    input. Only the positive test covers that path.

## Open, with a decision owed

- **#772** — re-traced from scratch; **two of the body's factual claims
  are wrong**. The `useImportJob.ts:286` comment is *accurate*
  (`useAsyncImport.ts:3` imports it), and `useImportJob` is not "the hook
  actually wired up" — **nothing imports either; they are dead as a
  pair**. The live import UI is `components/v2/ImportForm.jsx`
  (`App.tsx:129`) via `uploadBatch()` → `POST /import/batch` +
  `BatchProgressViewer` polling `GET /import/status/:jobId`. So this is
  a **superseded parallel implementation**, not unfinished wiring.
  - **Dennis then asked whether the decision was already answered
    somewhere. Partly — and the answer moved the default to "delete".**
    Checked, in order: `docs/docs-7-31-2026/` (newest batch) then
    `docs-7-27-2026/`, `docs/architecture/`, both root plan docs,
    milestones, the tracker `--state all`, and git history.
    - **RNF011** (Qualidade de dados, **F1-F3, Crítica**, identical in
      both batches) already requires imported data be *validated before
      canonical persistence*, with invalid imports staged or
      quarantined. It does **not** say that must be a pre-upload screen —
      server-side rejection satisfies it on its face.
    - **RNF032** (staging/validação/quarentena/limiar) is scoped
      **F2 — referências**, and **RNF024 AC#5** to the FHIR boundary —
      neither governs this path. **No RF covers this UI at all**: RF028
      is reference-data import, RF029 operational/scientific ingestion.
    - **No prior decision in the tracker**, open or closed — #770's
      thread traced the mechanism and explicitly stopped short.
    - **Git is the closest thing to recorded intent:** Denise added
      `useAsyncImport.ts` **2025-12-11** and the superseding
      `ImportForm.jsx` **2026-03-24**, three months later. The hook's
      one later touch (`ddc54ac1`) is a mechanical
      `startLocationID`→`startBoxId` rename inside backend migration
      #459 — **not** evidence anyone considers it live.
  - **Recommendation: delete both hooks** unless Denise says the
    validation preview is still wanted. The requirement that *does*
    exist is missing somewhere else — see **#787**.
  - #700 (`HPOAutocomplete.jsx`) may have the same resolution — check
    before treating it as an independent call.

## Filed this sitting — product

- **#779** — #775's fix reads the year's whole barcode set per sample
  creation; `import-lgpd.service.js:1133` calls it **per row**.
- **#780** — `log.service.js:289` builds its sort spec from an
  **unvalidated `filters.sortBy` request parameter** on a *paginated*
  query.
- **#781** — #771's option 1 (shared cursor-mock helper).
- **#782** — the intake wizard returns **200 even when every clinical
  entity failed to record**; only signal is a server-side log line.
- **#783** — four more root devDependencies with no reference anywhere.
- **#784** — the inverse of #755's guard (every declared env key is read
  somewhere). Deliberately not built: needs an allow-list, and that
  allow-list is the real design question.
- **#785** — **`GET /api/samples` accepts a `patientID` filter that
  `listSamples` never reads**, so it silently returns everything. Second
  instance of the class the adjacent #533 comment documents.
- **#786** — `importSamples`' `results.total` counts only rows reaching
  the end of the loop, so a partially-failed import reports
  **total < success + errors**, and those numbers reach
  `auditLogger.logImport`. `importPatients` in the same file is correct.

- **#787** — **RNF011 AC#4 is unmet on the LGPD import path**: rejected
  rows live only in the HTTP response and the uploaded file is deleted
  immediately after, so a partial import loses both the rejected rows
  and the source file. Zero occurrences of `staging`/`quarantine` in
  `import-lgpd.service.js`. The **FHIR path already satisfies the same
  AC** (`fhir-import-staging.service.js`, proven by e2e per
  `E2E_TRACEABILITY_PLAN.md`'s RF011 row) — so this is one import path
  having it and the other not, and the one missing it is the path a
  technician uses for bulk intake.

#785 and #786 were both found **by #759's new spec**, on its first run.
#787 came from the docs check Dennis asked for on #772.

## Filed this sitting — skills-pack

**#432** (`full-suite-guard` blocks a genuinely targeted one-file vitest
run when the downstream pipe is `grep -B5 -A 20 "FAIL\|Unhandled\|Error"`
— deterministic, reproduced twice), **#433** + comment (backslash
stripping is **not** confined to `node -e`: a quoted heredoc wrote `\d`
where the source needed `\\d`, which in a JS template literal collapses
to a literal `d` — a regex that compiles and matches **nothing**; also
hit as a bash `grep` `Trailing backslash` and a heredoc dying with
`unexpected EOF`), **#434** + refinement (`resolve-issue`'s mandated
pre-close `gh issue view --json state` re-arms `routing-gate.cjs`; the
check only matters on the *default* branch, so it is unnecessary in this
repo), **#435** (the `bioavanced-v2-conventions` bullet describing the
now-deleted `test:browser*` scripts is stale), **#436** (spec-inventory
entry for the new e2e spec + two gotchas), **#437** (`docker-workflow`'s
don't-poll advice collides with the stack-contention gotcha — see below).
Plus a data-point comment on **#426**.

**Working rule that held up all sitting: do not push escapes through the
Bash layer at all.** `Grep` tool for patterns, `Write`/`Edit` for file
content, `[0-9]` instead of `\d`.

## The Docker gate — what actually ran

Genuinely from scratch: all four named volumes removed first, 12 core
services cold-rebuilt with `--build`, `admin-bootstrap-test`, then the
full 17-service reference-data chain — **all 18 one-shot services
`Exited (0)`**.

| Check | Result |
|---|---|
| Full e2e suite, `--workers=1` | **202 passed, 1 failed** |
| The 1 failure (`tcle-dinamico.spec.ts:19`) | **my own contention** — re-run in isolation **4/4 green**, including that exact test |
| `backend-unit-runner` | **exit 0**; architecture 69/70 in-container (the documented `.github/workflows/` skip), `dictionary:validate` 929/929, no ENOENT — #658's mount still holding |

**The contention was self-inflicted and worth not repeating:** I started
`backend-unit-runner` while the e2e suite was still running, filling the
wait per `docker-workflow`'s don't-poll rule. Filed as pack #437 — the
existing gotcha is written only about the auto-started
`playwright-runner`, so "is that stopped?" reads as the whole
requirement. It is not: **one workload at a time against one stack,
whoever starts it.**

`TaskStop` on the backgrounded `docker compose run` reported success
while `docker ps` still showed the container `Up` — already documented
for `docker build`, confirmed again for `compose run`.

## Repo state

- On `feature/docker-e2e-backend-integration` at `1bc290f4` + this
  rotation, pushed, in sync. **No `fix/`/`test/` branches from this
  sitting remain**, local or remote.
- **Four older local branches**, unchanged for six sittings:
  `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged (safe to delete);
  `test/377-docs-on-main` and `test/human-showcase-video` are **not**
  merged. #599 is intentionally open, held by the CI milestone.
- **Two stale *remote* branches** with no local counterpart, still left
  alone deliberately: `origin/fix/705-seed-active-terminology-concept-cleanup`
  and `origin/test/377-docs-on-main`. They predate this session, so
  `clean-up`'s scope rule excludes them. **Verify merge status *and*
  per-commit authorship before deleting** (precedent #332: 5 of 13 were
  a collaborator's work).
- **Native suites: the known #752 red is unchanged and pre-existing**
  (`backup.service.test.js`'s legacy-JSON restore assertion). Not
  re-checked this sitting — last sitting confirmed it against a stashed
  tree. Architecture suite **70/70** natively.
- Two untracked paths still deliberately untouched: `.claude/skills/`
  and `api/backend/storage/assays/`. **Never `git add -A`** — every
  commit this sitting named its files explicitly.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker / cleanup

- **Stack torn down** (`docker compose down`), 0 containers, all **25**
  session-built `bioavanced-test-*` images removed, builder cache pruned
  with `-af` (**1.208GB → 0B**).
- **The four named volumes were left in place** — they are the caching
  design and `docker-workflow` forbids clearing them as routine hygiene.
  **But they now hold this sitting's e2e fixture data.** A genuinely
  from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first, as
  was done at the start of this one.
- **WSL2 vhdx is 14.53GB physical against ~3.75GB logical** (~10.8GB of
  air) — essentially unchanged from last sitting's 13.93GB. Still short
  of the "34GB behind 4GB" bar `docker-workflow` sets for a reset, and a
  reset wipes base images. Flagged, not acted on.
- 6 base images (2.839GB) left: not session-built, and machine-wide
  prunes need Dennis's fresh consent.
- Session scratch files removed.

## Carried forward, re-confirmed this sitting

- **The gate recipe in `docker-workflow`'s overlay is accurate as
  written** — 12 core services (with `--build`, since this sitting
  touched `api/backend/src`), then `admin-bootstrap-test`, then the
  17-service chain. Used verbatim, worked first time. Third sitting
  running.
- Host Playwright command (unchanged, still correct):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **Stop `playwright-runner` before any host-side run** — and now also:
  don't start anything else against the stack mid-run (pack #437).
- **Routes and controllers are not siblings** — `src/interface/routes/`
  vs `src/controllers/`.
- Older open findings from earlier sittings: #733, #734, #735.

## Recommended next steps

**None queued** — the queue Dennis authorized is complete and he named
no successor.

Strongest candidates from what this sitting filed: **#786** (the audit
trail records incoherent import totals — small fix, compliance-relevant)
and **#785** (a sample list filter that silently returns other
participants' samples). **#772** needs Denise, not more tracing.

**`ship-integration-branch` is closer still.** The Docker gate is green
from scratch and the queue is clear. The remaining blocker is unchanged:
**#752** still needs a decision on intended behaviour, and it is the one
red in the native suite.
