# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (seventh sitting of the day), after queue item 1
of 5. Dennis asked for the next group of issues and confirmed **Docker
is on**. This file is a mid-run snapshot; **4 of 5 queue items remain**
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
| **786** | `results.total` under-counts a partial import | fix-bugs | pending |
| **780** | `log.service.js` unvalidated `sortBy` sort spec | fix-bugs | pending |
| **782** | intake wizard 200 when every clinical entity failed | fix-bugs | pending |
| **787** | RNF011 AC#4 staging/quarantine for the LGPD import | build-loop | pending |

Ordered smallest-first with #787 last: it is the Docker-gated build with a
real-backend test, and #786 corrects a counter in the same file #787 will
restructure.

**Deliberately excluded, all still open:** #779 (owner's call on sequence
gaps), #772 (researched last sitting — a one-line decision for Denise),
#774/#752/#761/#751/#753 (each blocked on a decision).

**Flagged to Dennis, not queued:** **#684** is the highest-severity item
on the board — any authenticated user, including the lowest-privilege
role, can revoke any patient's consent by enumerating a Mongo `_id`, and
`authConsent.js` then blocks that participant's data. Left out because
the fix depends on RF010/RF021's intended actor model (admin-gated vs.
self-service-with-ownership-check), a product call. A docs check might
settle it the way #772's did. Dennis was offered the swap and has not
taken it.

## Item 1 — #785, closed

`21070172` → merged `9c3074bf`. Branch deleted local **and remote**
(remote deletion succeeded with no prompt — another data point for
pack #410).

`GET /api/samples` built `patientID: req.query.patientID` while
`listSamples` reads only `filters.participantId`. It failed in the worst
direction: a 200 with a full page of other participants' samples.

- **The issue's suggested fix was wrong and was deliberately not
  taken.** It proposed `req.query.participantId || req.query.patientID`.
  But `validateCreateSamplePayload`, 360 lines above in the same file,
  rejects `patientID` with a **422 NON_CANONICAL_FIELD** — it is on the
  create path's explicit non-canonical list. Re-admitting it as a query
  alias would have the same endpoint family accept a name its sibling
  refuses and would move the participantId migration (#773/#146)
  backwards. **Re-running the trace instead of trusting the body is what
  caught this.**
- No compatibility burden: **no caller sends either name.**
  `frontend/src/services/api.ts:278` is a bare `api.get('/samples')` with
  no params, and nothing in `frontend/` or `tests/e2e/` sends a filter to
  this endpoint.
- The reproduction was a new **route-boundary** test — the service layer
  was already correct and well covered; the whole bug lived in the key
  the route handed over. Confirmed red first: the call went through with
  a `patientID: undefined` entry and no `participantId` key at all.

## Pending deferred proof — read before the gate

`tests/e2e/lgpd-sample-import.spec.ts` was **un-weakened** this
iteration. #759's spec had worked around #785 with client-side matching
and an explicit "do not simplify this back to a server-side filter until
#785 is fixed" comment. It now queries through the real filter and
asserts **every** returned row belongs to the requested participant.

**That assertion has not run yet** — it only executes against the Docker
stack. It is scheduled for this sitting's gate (running anyway for #787).
#785 was closed on the native proof because the fix itself is fully
proven natively; **if the gate comes back red on that spec, reopen #785.**

## Filed this sitting so far

- **#788** — `GET /api/samples` computes every sample's consent badge
  from `sample.patientID`, a field **no writer sets**
  (`RegisterSample.js:128` writes `participantId`; `Sample.js:31`
  declares only `participantId`; `import-lgpd.service.js` has zero
  occurrences). So the per-row patient lookup degenerates to matching on
  null for both legs. **Third instance of the #533/#785 class in that one
  handler.** Includes a static-trace caveat: the observable prediction
  (every row `PATIENT_NOT_FOUND`) has **not** been checked against a live
  stack — worth doing at this sitting's gate.
- **#789** — the mechanism behind #533/#785: `GET /api/samples` silently
  ignores non-canonical query params while `POST /api/samples` 422s them.
  Split out of #785 so it does not only live on a closed thread.
- **pack #440** — `fix-bugs`' un-weaken-pinned-tests step and its
  native-only verification contract don't compose when the pinned test is
  an e2e spec. Improvised a resolution this iteration (close on the
  native proof, flag the deferred assertion here and in the close
  comment); it would not generalize to a sitting with no gate planned.

## Repo state

- On `feature/docker-e2e-backend-integration` at `9c3074bf` + this
  rotation, pushed, in sync. **No `fix/` branches from this sitting
  remain**, local or remote.
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
- **Native suites: the known #752 red is unchanged and pre-existing**
  (`backup.service.test.js`'s legacy-JSON restore assertion). Not
  re-checked this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker

**On, authorized by Dennis for this sitting. Nothing started yet.**

The four named volumes still hold the previous sitting's e2e fixture
data. A genuinely from-scratch gate needs `docker volume rm` on
`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first.

Carried forward, re-confirmed across three prior sittings:

- **The gate recipe in `docker-workflow`'s overlay is accurate as
  written** — 12 core services (with `--build` when `api/backend/src` was
  touched, which it now has been), then `admin-bootstrap-test`, then the
  17-service reference-data chain.
- Host Playwright command (unchanged): see the previous rotation's
  verbatim line — `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_API_BASE_URL`,
  `PLAYWRIGHT_SKIP_WEBSERVER=1`, `TEST_USER=admin`, `TEST_PASS=Admin@123`,
  the `directConnection=true` Mongo URI, `E2E_MONGO_DB=bioavanced_test`,
  `E2E_NEO4J_DATABASE=neo4j`, `TEST_SUPPORT_SECRET=e2e-test-support-secret`,
  then `npx playwright test [spec] --workers=1`.
- **Stop `playwright-runner` before any host-side run**, and **one
  workload at a time against one stack, whoever starts it** (pack #437).
- `TaskStop` on a backgrounded `docker compose` reports success while
  `docker ps` still shows the container `Up`.

## Working rules holding this sitting

- **Do not push escapes through the Bash layer.** Confirmed twice more
  this iteration: a large heredoc for this very file died with
  `unexpected EOF while looking for matching quote` and had to be written
  with the `Write` tool instead. Use `Write`/`Edit` for file content and
  the `Grep` tool for patterns.
- **Never chain gated steps in one compound command.** A
  `cat > body.md <<EOF ... && gh issue create` died as one unit to the
  missing-`--label` hook, taking the heredoc with it, so the retry failed
  on a file that had never been written.
- **`routing-gate.cjs` is re-armed by tracker reads for other issues,
  including in a different repository.** Closing #785 was blocked because
  intervening `gh issue list`/`create` calls (some against the *pack*
  repo) reset the gate; the fix is a fresh `fix-bugs` Skill invocation.

## Recommended next steps

**Continue the queue — #786 is next**, then #780, #782, #787. Nothing
about the remaining four has changed as a result of item 1.

Then the Docker gate, which must cover: the un-weakened
`lgpd-sample-import.spec.ts` assertion (above), #787's new real-backend
test, and — worth the extra minute — a live check of **#788**'s
prediction that every `GET /api/samples` row comes back
`PATIENT_NOT_FOUND`.
