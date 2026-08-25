# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (eighth sitting of the day), after queue item 2
of 4. Dennis asked for the next group of issues and confirmed **Docker
is on**. **2 of 4 queue items remain** and the session is still going.
Do not read this as the sitting's final word.

## The queue

Self-picked this sitting, explicitly numbered in the `issue-loop`
invocation's args so `queue-continue-checkpoint.cjs` can see it. Theme:
**finish RNF011 AC#4, and stop the sample list from lying about
consent.**

| # | What | Route | Status |
|---|---|---|---|
| **0** | the inherited Docker gate | gate | **done, green** |
| **787** | RNF011 AC#4 LGPD import quarantine | build-loop | **closed** (code had merged `00fee0a8`) |
| **788** | consent badge read from a field no writer sets | fix-bugs | **closed** `28629279` / merged `8547134e` |
| **790** | `importSamples` has no empty-row guard | fix-bugs | **next** |
| **794** | slice 1: `GET /api/import/lgpd/batches/:batchId` | build-loop | queued |

**Deliberately excluded, all still open:** **#789**, **#793**, **#792** —
each blocked on a decision by its own body.

**Flagged to Dennis, not queued:** **#684** — any authenticated user can
revoke any patient's consent by enumerating a Mongo `_id`. Highest
severity on the board, still blocked on RF010/RF021's actor model.
Offered again this sitting as a swap for #794; not taken.

## #788 — what it actually was

The issue's headline prediction was **wrong**, and the truth was worse.
It predicted every `GET /api/samples` row returning `PATIENT_NOT_FOUND`.
Live, every row returned `NO_ACTIVE_CONSENT` — meaning the lookup
*matched a patient*, just the wrong one. All 7 patient documents lack
`patientID`, so `{ patientID: null }` matched all of them and `findOne`
returned whichever came first: **every sample on every page was badged
from one arbitrary patient's consent record.**

Direction of failure was decided by document order, not data. That
patient had no active consent, so everything read `canUse: false` —
conservative, and indistinguishable from correct. Had it carried one,
every specimen in the biobank would have badged `canUse: true`. The
second new unit test shows the sharp end: **before the fix, a sample with
no participant identifier at all returned `canUse: true`, "TCLE
Assinado".**

Fix keys off `sample.participantId` and **guards the missing-value case**
so the filter can never degenerate to `{ field: null }` again. Both legs
of the old `$or` were dead — `Patient.js`'s `CANONICAL_FIELDS` has no
`patientID` either, so the issue's suggested `{ patientID: ... }` leg was
dropped rather than kept.

**Live proof:** seeded one ACTIVE consent for participant `61778985`;
exactly that participant's sample flipped to `canUse: true`, the other
three stayed false. Probe fixture removed afterwards.

**The pattern has now held five times running:** the issue body was wrong
in some respect and re-running the trace is what caught it. **Assume
#790's and #794's bodies need the same treatment.**

## Filed this sitting

**Product:** **#795** (`POST /api/samples` writes `Paciente ID:
undefined` into the RF004 audit trail and drops the key from its 201
body — three more reads of the same non-existent field), **#796**
(`persistConsentDeliveryFailure` is a permanent no-op: both callers pass
`participantId`, it reads `patientID`/`patientId`/`id`, so consent
delivery failures are never recorded anywhere), **#797** (520
filter-ignoring `findOne` mocks across 56 files — the #771 blindness one
method over, and what kept #788 green through five tests covering it).

**Pack:** **#444** (checkpoint hook fires on *failed* gh commands and
asserts they succeeded), **#445** (a stack left up for a gate is recorded
as "UP" with no bootstrap state), **#446** (#407's fix is correct and
still unreachable two prose pointers deep), **#447** (the logical→physical
collection-name map needed for hand-seeding), plus a 4th no-denial
data point on **#410**.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (the 2 previously-unpushed commits went up with #788's merge).
- No `fix/` branches outstanding — `fix/788-samples-consent-badge-participantid`
  deleted local **and** remote, no prompt.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
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

**On, authorized by Dennis. Stack is UP and gate-ready** — record both
axes, per pack #445:

- **Services:** 12 core, healthy, up since ~19:26 on 2026-08-25.
- **Bootstrap:** `admin-bootstrap-test` **and** the full 17-service
  reference-data chain have run this sitting. All 18 one-shots verified
  `Exited (0)` via `docker ps -a` — not by the compose exit code, which
  lies for one-shots.
- **`backend-app-test` was rebuilt** with #788's fix (`up -d --build
  --wait backend-app-test`). It is build-not-mount: **any further
  `api/backend/src` change needs another rebuild before an e2e run**, or
  the stale image serves old code with no error.
- **Volumes:** the four named fixture volumes are untouched and hold
  prior sittings' data. A from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first, then
  the whole bootstrap chain again.
- `playwright-runner` has never been started on this stack. **Stop it
  before any host-side run if that changes**, and keep to one workload
  at a time against one stack (pack #437).
- Host Playwright command (verbatim, works):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **Hand-seeding Mongo needs the logical→physical name map** (pack #447):
  `getCollection(db, 'consents')` reads the collection physically named
  **`patientConsents`**, per `api/backend/src/config/collections.js`, and
  the map is env-overridable. Seeding the wrong name does not error —
  `insertOne` creates a stray collection and the verification reads as a
  failed fix. Cost one wasted probe this sitting.

## Working rules holding this sitting

- **`gh issue close` has NO `--body-file` flag** — it takes `--comment`.
  Post the long comment first with `gh issue comment --body-file`, then
  close in a **separate** command.
- **A hook-blocked Bash call writes none of its files, and the block is
  atomic over the whole tool call — the separator is irrelevant.** A
  heredoc and a `gh issue create` on two newline-separated lines were
  lost together to the `--label` hook. Framing this as an `&&`-chaining
  rule is too narrow.
- **Every `gh issue create` must carry `--label`** (pack #148 hook).
- **Route file content through `Write` above roughly 100 lines** — a
  truncation, not an escaping bug (pack #433).
- **Budget one re-invocation per close:** `routing-gate.cjs` re-arms
  between the fix and the close, every time (pack #442). It fired on
  #788 exactly as the previous sitting predicted.

## Recommended next steps

**Continue the queue — #790, then #794 slice 1.**

For **#790**, note its own body already flags the open question: should a
blank row be silently skipped (matching `importPatients`) or reported as
a distinct rejection? Its suggested fix — lift `importPatients`' two
guards into a shared helper called by all three loops before their
`results.total` increments — is the safe reading, since silent skipping
is the established behaviour in that file. `importPatientsSmart` has
neither guard either, so "all three loops" is the right scope.
