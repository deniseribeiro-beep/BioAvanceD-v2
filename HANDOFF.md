# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (seventh sitting of the day), after queue item 2
of 5. Dennis asked for the next group of issues and confirmed **Docker
is on**. This file is a mid-run snapshot; **3 of 5 queue items remain**
and the session is still going. Do not read it as the sitting's final
word.

## The queue

Self-picked, explicitly numbered in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` can see it. Classification ran **once up
front for the whole list**, per queue mode's closed-explicit-list rule.

Theme: **accepted-but-unenforced request parameters, and partial failures
that report as success**, on the LGPD import and sample/log query paths.
Four of the five came out of #759's e2e spec last sitting, so they share
context across `import-lgpd.service.js`, `sample.routes.js`, and
`sample.service.js`.

| # | What | Route | Status |
|---|---|---|---|
| **785** | samples list `patientID` filter never applied | fix-bugs | **closed** |
| **786** | `results.total` under-counts a partial import | fix-bugs | **closed** |
| **780** | `log.service.js` unvalidated `sortBy` sort spec | fix-bugs | **next** |
| **782** | intake wizard 200 when every clinical entity failed | fix-bugs | pending |
| **787** | RNF011 AC#4 staging/quarantine for the LGPD import | build-loop | pending |

Ordered smallest-first with #787 last: it is the Docker-gated build with a
real-backend test.

**Deliberately excluded, all still open:** #779 (owner's call on sequence
gaps), #772 (researched last sitting — a one-line decision for Denise),
#774/#752/#761/#751/#753 (each blocked on a decision).

**Flagged to Dennis, not queued:** **#684** is the highest-severity item
on the board — any authenticated user, including the lowest-privilege
role, can revoke any patient's consent by enumerating a Mongo `_id`, and
`authConsent.js` then blocks that participant's data. Left out because
the fix depends on RF010/RF021's intended actor model, a product call. A
docs check might settle it the way #772's did. Dennis was offered the
swap and has not taken it.

## Item 1 — #785, closed

`21070172` → merged `9c3074bf`. Branch deleted local and remote.

`GET /api/samples` built `patientID: req.query.patientID` while
`listSamples` reads only `filters.participantId` — a 200 with a full page
of other participants' samples.

- **The issue's suggested fix was wrong and was deliberately not taken.**
  It proposed `req.query.participantId || req.query.patientID`. But
  `validateCreateSamplePayload`, in the same file, rejects `patientID`
  with a **422 NON_CANONICAL_FIELD**. Re-admitting it as a query alias
  would move the participantId migration (#773/#146) backwards.
  **Re-running the trace instead of trusting the body caught this.**
- No compatibility burden: **no caller sends either name.**
- The reproduction was a new **route-boundary** test; the service layer
  was already correct and well covered.

## Item 2 — #786, closed

`cd98a160` → merged `c42fc8de`. Branch deleted local and remote.

`results.total++` sat at the bottom of the per-row loop, after the
try/catch. **Seven** `continue` paths reject a row before reaching it, so
a partial import reported `total < success + errors` — numbers passed
straight to `auditLogger.logImport`.

- **The under-count was specific to the `continue` paths.** Because the
  increment was after the try/catch rather than inside the try, a row
  that *threw* was still counted. That is why the numbers looked
  plausible on files that either fully succeeded or fully threw.
- **Matched `importPatientsSmart`'s placement, not `importPatients`'.**
  The issue said to match `importPatients`, which increments after an
  empty-row guard — but `importSamples` has no such guard, so before the
  `try` is the true analogue.
- **`importPatientsSmart` was already correct** (the issue flagged it as
  a suspect third copy); so is `importPatients`. Only `importSamples` was
  wrong.
- The completion log line can finally show a partial failure — it reads
  `success/total`, so it previously printed `1/1`, `5/5`, `0/0`, never
  `5/7`.
- No existing test asserted `result.total` at all, which is how this
  survived.

## Pending deferred proof — read before the gate

`tests/e2e/lgpd-sample-import.spec.ts` now carries **three** un-weakened
assertions that have never been executed, because they only run against
the Docker stack:

1. **#785** — the samples list is now queried through the real
   `?participantId=` filter, asserting every returned row belongs to the
   requested participant.
2. **#786** — a wholly-rejected one-row file must report
   `{ total: 1, success: 0, errors: 1 }`.
3. **#786** — a mixed two-row file must report
   `{ total: 2, success: 1, errors: 1 }`.

All three previously asserted the *wrong* values on purpose so the spec
would not go red when the fixes landed. **Both issues were closed on
their native proofs; if the gate comes back red on this spec, reopen the
corresponding issue.**

## Filed this sitting so far

- **#788** — `GET /api/samples` computes every sample's consent badge
  from `sample.patientID`, a field **no writer sets**. **Third instance
  of the #533/#785 class in that one handler.** Static trace only — the
  prediction that every row returns `PATIENT_NOT_FOUND` has **not** been
  checked live; worth doing at this sitting's gate.
- **#789** — the mechanism behind #533/#785: `GET /api/samples` silently
  ignores non-canonical query params while `POST /api/samples` 422s them.
- **#790** — `importSamples` has no empty-row guard while
  `importPatients` has two, so a trailing blank row (routine Excel
  output) becomes a spurious identity-resolution rejection. Deliberately
  not folded into #786: skipping a row is a behaviour change, not a
  counting fix.
- **pack #440** — `fix-bugs`' un-weaken-pinned-tests step and its
  native-only verification contract don't compose when the pinned test is
  an e2e spec.
- **pack #441** — a branch guard parses the file descriptor in `2>&1` as
  a `git push` target and blocks a correct push.
- **pack #434 comment** — `routing-gate.cjs` is re-armed by tracker reads
  for other issues, including in a *different repository*.

## Repo state

- On `feature/docker-e2e-backend-integration` at `c42fc8de` + this
  rotation, pushed, in sync. **No `fix/` branches from this sitting
  remain**, local or remote (both remote deletions succeeded with no
  prompt — two more data points for pack #410).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`** — every commit
  this sitting named its files explicitly.
- Older local branches unchanged (seven sittings now):
  `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged (safe to delete);
  `test/377-docs-on-main` and `test/human-showcase-video` are not merged.
- Two stale *remote* branches still left alone deliberately:
  `origin/fix/705-seed-active-terminology-concept-cleanup` and
  `origin/test/377-docs-on-main`. They predate this session, so
  `clean-up`'s scope rule excludes them. **Verify merge status *and*
  per-commit authorship before deleting** (precedent #332).
- **Native suites: the known #752 red is unchanged and pre-existing.**
  Not re-checked this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker

**On, authorized by Dennis for this sitting. Nothing started yet.**

The four named volumes still hold the previous sitting's e2e fixture
data. A genuinely from-scratch gate needs `docker volume rm` on
`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first.

Carried forward, re-confirmed across three prior sittings:

- **The gate recipe in `docker-workflow`'s overlay is accurate as
  written** — 12 core services (with `--build`, since `api/backend/src`
  has been touched twice this sitting), then `admin-bootstrap-test`, then
  the 17-service reference-data chain.
- Host Playwright command: see the sixth sitting's rotation for the
  verbatim line (`PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_API_BASE_URL`,
  `PLAYWRIGHT_SKIP_WEBSERVER=1`, `TEST_USER`/`TEST_PASS`, the
  `directConnection=true` Mongo URI, `E2E_MONGO_DB=bioavanced_test`,
  `E2E_NEO4J_DATABASE=neo4j`, `TEST_SUPPORT_SECRET`, then
  `npx playwright test [spec] --workers=1`).
- **Stop `playwright-runner` before any host-side run**, and **one
  workload at a time against one stack, whoever starts it** (pack #437).
- `TaskStop` on a backgrounded `docker compose` reports success while
  `docker ps` still shows the container `Up`.

## Working rules holding this sitting

- **Do not push escapes through the Bash layer.** A large heredoc for
  this very file died with `unexpected EOF while looking for matching
  quote`; it is written with the `Write` tool instead. Use `Write`/`Edit`
  for file content and the `Grep` tool for patterns. Short heredocs for
  issue bodies have been fine.
- **Never chain gated steps in one compound command.** Hit twice: a
  `cat > body.md <<EOF ... && gh issue create` died as one unit to the
  missing-`--label` hook (taking the heredoc with it, so the retry failed
  on a file that had never been written), and a
  `git add && git commit && git push -q 2>&1 | tail` died to pack #441's
  false positive with nothing committed.
- **`routing-gate.cjs` re-arms between the fix and the close.** Both
  closes this sitting needed a fresh `fix-bugs` Skill invocation first.
  Budget for it as a normal step of the ending sequence, not a surprise.

## Recommended next steps

**Continue the queue — #780 is next**, then #782, #787.

Then the Docker gate, which must cover: the **three** un-weakened
`lgpd-sample-import.spec.ts` assertions listed above, #787's new
real-backend test, and — worth the extra minute — a live check of
**#788**'s prediction that every `GET /api/samples` row comes back
`PATIENT_NOT_FOUND`.
