# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (eighth sitting of the day), after queue item 1
of 4. Dennis asked for the next group of issues and confirmed **Docker
is on**. **3 of 4 queue items remain** and the session is still going.
Do not read this as the sitting's final word.

## The queue

Self-picked this sitting, explicitly numbered in the `issue-loop`
invocation's args so `queue-continue-checkpoint.cjs` can see it. Theme:
**finish RNF011 AC#4, and stop the sample list from lying about
consent** — all four items sit on the LGPD-import / sample-list path the
last two sittings have been living in.

| # | What | Route | Status |
|---|---|---|---|
| **0** | the inherited Docker gate | gate | **done, green** |
| **787** | RNF011 AC#4 LGPD import quarantine | build-loop | **closed** (code was already merged `00fee0a8`) |
| **788** | consent badge read from `sample.patientID`, a field no writer sets | fix-bugs | **next** |
| **790** | `importSamples` has no empty-row guard | fix-bugs | queued |
| **794** | slice 1: `GET /api/import/lgpd/batches/:batchId` | build-loop | queued |

**Deliberately excluded, all still open:** **#789** (its own body says
which of three options to take is a product call), **#793** (`question`
— retention for `import_staging_records`), **#792** (its body says it
should be decided together with #793).

**Flagged to Dennis, not queued:** **#684** — highest-severity item on
the board; any authenticated user can revoke any patient's consent by
enumerating a Mongo `_id`. Still blocked on RF010/RF021's intended actor
model, a product call. Offered again this sitting as a swap for #794;
not taken so far.

## What the previous sitting left, and what was actually true

The inherited `HANDOFF.md` was **one step stale in two places** — worth
knowing because both were only caught by checking rather than reading:

- It listed **#787 as "next"**. #787's code had in fact been built,
  committed (`f425848b`) and merged (`00fee0a8`), and three follow-ups
  (#792/#793/#794) filed off it. Only the *issue* was still open,
  pending the gate. The last `HANDOFF.md` edit (`cc48fb82`) touched only
  the Docker paragraph and never refreshed the queue table.
- It said the branch was **"pushed, in sync"**. It was, and still is,
  **ahead 2** (`859d3bfa`, `cc48fb82`).

## The gate (queue item 0) — green

**The stack was up but was NOT gate-ready.** `docker ps -a` showed no
`admin-bootstrap-test` container and no reference-data chain containers
at all — the previous sitting brought up the 12 core services and
stopped. Without those, every `realLogin` spec 401s and
`lgpd-sample-import.spec.ts` cannot resolve its seeded MIABIS ids
(`PLASMA`/`VENOUS_BLOOD`/`TUBE_EDTA`, from `foundation-bootstrap-test`).
Fixed in ~50 s; filed as pack **#445**, because "warm" was recorded where
"gate-ready" was meant.

Result, host-side Playwright, `--workers=1`:

```
5 passed (4.0s)
```

- **#785's** deferred `?participantId=` assertion — **passed**, first
  ever execution.
- **#786's** two deferred `results.total` assertions
  (`{1,0,1}` and `{2,1,1}`) — **both passed**.
- **#787's** two new quarantine cases — **passed**.

**No reopens.** #785 and #786's native-proof closes are confirmed live.

## #788 — live-checked, and the issue body is wrong

Its headline prediction (every `GET /api/samples` row returns
`PATIENT_NOT_FOUND`) is **refuted**. All 4 rows returned
`NO_ACTIVE_CONSENT`, which per `sample.routes.js:535` means the `findOne`
**matched a patient**. It resolves to the *wrong* one:

```
total patients: 7      with no patientID field: 7
buggy filter returns : participantId "64404470"
the sample's real one: participantId "53117577"
```

Every patient lacks `patientID`, so `{ patientID: null }` matches all
seven and `findOne` returns whichever comes first. **Every sample on
every page is badged from one arbitrary patient's consent record.**

This is the "or, worse" branch #788 itself flagged, and it is **more**
severe than what the issue leads with: today that patient has no active
consent so everything reads `canUse: false` (conservative, and
indistinguishable from correct), but if the first-yielded patient
carried an active consent, **every specimen in the biobank would badge
`canUse: true`**. Which way it fails is decided by document order.
Full evidence is on the #788 thread.

**The pattern from the last queue held for a fifth time:** the issue
body was wrong in some respect, and re-running the trace is what caught
it. This time it was wrong in the direction of *understating* severity.
**Assume #790's and #794's bodies need the same treatment.**

## Filed this sitting

**Pack:** **#444** (`push-wrapup-checkpoint.cjs` fires on a gh command
that *failed*, and its message asserts the command succeeded), **#445**
(a stack left up for a pending gate is recorded as "UP" with no record
of its bootstrap state), **#446** (#407's fix is correct, filed in the
right place, and still unreachable two prose pointers deep from a
`build-loop` iteration — I reproduced both halves of #407 anyway).

**Product:** none new. #788 gained a substantial live-evidence comment.

## Repo state

- On `feature/docker-e2e-backend-integration`, **ahead 2, unpushed**
  (`859d3bfa`, `cc48fb82`) — inherited, not created this sitting.
- **Nothing committed to the repo this sitting yet** beyond this
  rotation. No working-tree edits (`git diff --stat` empty).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- No `fix/` or `build/` branches from this sitting exist yet.
- Older local branches unchanged: `fix/599-ci-trigger-integration-branch`
  and `fix/599-hold-ci-trigger-for-milestone` are merged (safe to
  delete); `test/377-docs-on-main` and `test/human-showcase-video` are
  not merged.
- Two stale *remote* branches left alone deliberately (they predate this
  session): `origin/fix/705-seed-active-terminology-concept-cleanup` and
  `origin/test/377-docs-on-main`. **Verify merge status *and* per-commit
  authorship before deleting** (precedent #332).
- The known **#752** red is unchanged and pre-existing; not re-checked.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker

**On, authorized by Dennis for this sitting. The stack is UP and now
genuinely gate-ready** — record both axes, per pack #445:

- **Services:** 12 core, all healthy, up since ~19:26 on 2026-08-25
  (inherited from the previous sitting, not started by this one).
- **Bootstrap:** `admin-bootstrap-test` **has run** this sitting, and so
  has the **full 17-service reference-data chain**. All 18 one-shots
  verified `Exited (0)` via `docker ps -a` — not by the compose exit
  code, which lies for one-shots.
- **Volumes:** the four named fixture volumes are untouched and still
  hold prior sittings' data. The gate was deliberately run **warm**; a
  genuinely from-scratch run needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first, and
  then the whole bootstrap chain again.
- `playwright-runner` has never been started on this stack — nothing to
  stop before a host-side run. **Stop it if that changes**, and keep to
  **one workload at a time against one stack** (pack #437).
- Host Playwright command (verbatim, works):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **#788's and #790's fixes touch `api/backend/src`** — rebuild
  `backend-app-test` before re-running any spec against them.
  `backend-app-test` is build-not-mount; a bare `up -d` reuses the stale
  image and the failure looks like a real bug.

## Working rules holding this sitting

- **`gh issue close` has NO `--body-file` flag** — it takes `--comment`.
  Post a long close comment first with `gh issue comment --body-file`,
  verify, then close in a **separate** command. Tripped this sitting
  despite being documented in `resolve-issue`; see pack #446.
- **A hook-blocked Bash call writes none of its files, and the block is
  atomic over the whole tool call — separator is irrelevant.** A
  heredoc and a `gh issue create` on two separate newline-separated
  lines were lost together to the `--label` hook. The repo's own prior
  note framed this as an `&&`-chaining rule; that framing is too narrow.
- **Every `gh issue create` must carry `--label`** (pack #148 hook).
- **Route file content through `Write`, not Bash heredocs, above roughly
  100 lines** — a truncation, not an escaping bug (pack #433).
- **Budget for re-invocations:** `routing-gate.cjs` re-arms between the
  fix and the close, and `push-wrapup-checkpoint` fires again at the
  close after the audit already ran (pack #442) — and now also fires on
  commands that *failed* (pack #444).

## Recommended next steps

**Continue the queue — #788, then #790, then #794 slice 1.**

For **#788** specifically, the live check above changes the fix:
`{ patientID: <value> }` is a **dead leg** against this database (no
patient document carries the field), so matching should key on
`participantId`; and the fix must stop a missing value from degenerating
into `{ field: null }` and silently matching — guard before querying,
don't just change which value is fed in. The unit fixtures at
`tests/unit/sample.routes.test.js:1318,1344,1370,1405,1452` build
`samples: [{ patientID: 'P1' }]`, a shape the product never produces,
and must be corrected in the same change or they will keep endorsing the
broken reader.
