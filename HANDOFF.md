# HANDOFF

**Written:** 2026-08-26, end of the first sitting of the day. The self-picked
5-item queue is **worked — 3 closed, 2 deliberately left open with reasons
below.** This is the definitive rotation for this sitting.

## What this sitting did

Dennis asked for the next 5 issues and left the pick to me. Theme: **make the
LGPD import quarantine usable end-to-end, and close out the "field nothing
writes" cluster.** Docker was never authorised and never started.

| # | What | Route | Outcome |
|---|---|---|---|
| **799** | FHIR reader served LGPD quarantine batches | fix-bugs | **closed** `5d2e8cfc` / merged `ca8e01d3` |
| **795** | `Paciente ID: undefined` in the RF004 audit trail | fix-bugs | **closed** `377bb297` / merged `6d7cf459` |
| **796** | `persistConsentDeliveryFailure` permanent no-op | fix-bugs | **half fixed** `b36d971c` / merged `e3b722f4`; **OPEN — needs Dennis** |
| **792** | import deleted the source file despite quarantine | build-loop | **closed** `dbf3b31b` / merged `eaaebe47`; throw case → **#806** |
| **794** | quarantine UI (item 2) | build-loop | **item 2 landed** `9a548974` / merged `321e7a52`; **OPEN — item 3 remains** |

RNF011 AC#4 is now genuinely met for the rejections path: rows survive (#787),
are readable by API (#794 slice 1), the source file is kept (#792), and an
operator can reach and review both from `/import/quarantine` (#794 item 2).

## ⚠ Two decisions waiting on Dennis

### 1. #796 — wire it up, delete it, or move it

`persistConsentDeliveryFailure` is a confirmed permanent no-op, exactly as
filed. **New evidence the body did not have:** the three fields it writes
(`consentDeliveryStatus`/`FailedAt`/`ErrorCode`) are **absent from
`PatientModel`'s canonical allowlist** (`models/Patient.js:8`), and it reaches
Patient through a raw driver `updateOne` that bypasses the model. So "just
wire it up" means writing non-canonical fields onto Patient — what PR 100
removed. `docs/` has nothing mandating a delivery-failure record, so unlike
#795 the docs do **not** settle it.

Three options are on the thread. I lean: record it on the notification side
(now queryable per participant thanks to this sitting's metadata fix), else
delete. **I did not guess.**

### 2. #684 / #800 / #801 — object ownership

Unchanged from the last sitting except that **#800 got worse this sitting, and
I caused it**: #794 item 2 added `GET /api/import-lgpd/batches`, so the
ownership gap went from "any batch *if you know its id*" to "enumerate every
operator's batches". Deliberate and I would do it again — without a list there
is no navigable entry point at all — but recorded on #800, and any ownership
scoping must cover both routes.

## The issue-body reliability pattern, again

**All five bodies read this sitting were wrong or incomplete somewhere.** Last
sitting's tally was five of six. The rule remains *check*, not distrust — the
re-trace is cheap and caught, in order:

- **#799** understated severity twice: `validateBatch` is a **write** that
  overwrote the batch's `QUARANTINED` status and file-level counts, and
  `attachExternalDocument` never calls `getBatch` at all and went unmentioned
  — the pre-fix run reproduced it releasing an LGPD row to
  `COMMITTED`/`RELEASED`/`AVAILABLE`.
- **#795** cited `RegisterSample.js`, which is **not in the call path** (the
  route uses `RegisterSampleUseCase`). Two parallel files, body picked the
  unwired one. Conclusion still correct after re-tracing from the route.
- **#796** missed that its own file contains a worse bug 30 lines up (#805).
- **#792**'s suggested `sourceFile: { path }` implied retaining in place;
  `uploads/temp/` is a directory any cleanup routine may empty, so the file
  had to move.
- **#794 item 2**'s entire premise was false — see #808 below.

## Filed this sitting

**Project:**

- **#805** — *the most severe find.* `buildConsentLink` emails
  `/patients/undefined/consent?token=…`: the id segment is undefined for the
  same rename reason as #788/#795/#796, **and** the token sits in a query
  string the target page never reads (it reads route params). Affects **all
  four bulk consent-invitation paths** (template publication, both LGPD
  imports, the CSV/FHIR import). The working `eConsent.js` flow builds its
  link separately and correctly — two builders, and the bulk paths use the
  broken one.
- **#808** — the LGPD import has **no frontend caller at all**;
  `importLGPDService` in `api.ts` is dead code, and `/import` posts to the
  *async* importer instead. This is why #794 item 2 needed its own entry point.
- **#803** — test mocks returning shapes production never emits (**25
  candidate sites**); the enabler for #795, #796 *and* #788, and the
  output-side mirror of #797. Its own `tests/factories/sample.factory.js`
  emits `patientID`/`registerDate`/`locationID` — three prohibited aliases the
  API 422s (corrected by comment).
- **#801** (`attachExternalDocument` marks any record `COMMITTED`/`RELEASED`
  with no validation-state check, and ignores `matchedCount: 0`), **#802**
  (`validateImportConsentToken`, the one query #799 left undiscriminated),
  **#804** (`sampleID` still emitted though prohibited — populated, so
  renaming breaks callers), **#806** (#792's throw case; needs a row-less
  batch, contradicting #787's "no empty batch" decision), **#807**
  (quarantined civil identifiers stored in **plaintext**, both the staged
  `row` and the retained file, while #566 encrypts the same data at rest
  everywhere else).
- Commented scope extensions on **#793** (now covers retained files too; they
  must expire together, and a disposal job must delete
  `sourceFile.storedPath`) and **#800** (above).

**Pack:** #463 (routing gate blocks a queue-level `AskUserQuestion`), #464
(ending-sequence checkout dumps every touched file into context, per
iteration), #465 (`fix-bugs`' bundled-sub-points rule has only one ending,
which loses the thread when the *unresolved* half is the issue's subject),
#466 (the overlay's two proof bars have nothing for a mixed backend+frontend
slice). Recurrence comments on #401 and #398.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`321e7a52` + this rotation). No open PR; nothing pushed to `main`, which
  stays frozen and 99 behind.
- **All five fix/test branches deleted local *and* remote, no prompt any
  time** — five more data points for pack #410's tally, which still has no
  reliable predictor.
- **Correction carried from the previous handoff:**
  `test/787-lgpd-import-staging` is still present local **and** remote, fully
  merged into the integration branch. The previous note's "no outstanding
  `test/` branches" was true only of the branches created that sitting. Safe
  to delete after verifying merge status *and* per-commit authorship
  (precedent #332).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Older local branches unchanged: `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are merged (safe to delete);
  `test/377-docs-on-main` and `test/human-showcase-video` are not merged.
- Two stale *remote* branches predating this session left alone deliberately:
  `origin/fix/705-seed-active-terminology-concept-cleanup` and
  `origin/test/377-docs-on-main`.
- The known **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Never started this sitting. Stack DOWN, volumes still absent, nothing
seeded.**

- **Services:** none running, none stopped. **Docker Desktop itself is not
  running** — verified at the `clean-up` checkpoint, where `docker ps -a`
  failed with `open //./pipe/dockerDesktopLinuxEngine: The system cannot find
  the file specified`. That is the engine being down, not a broken install:
  start Docker Desktop before the first compose command or the error reads
  like a corrupted setup.
- **Bootstrap:** none. The four named volumes
  (`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data`) were dropped at
  the *previous* sitting's teardown and have not been recreated.
- A next e2e gate therefore needs the **full cold sequence**: the 12-service
  recipe with `--build`, then `admin-bootstrap-test`, then the entire
  17-service reference-data chain. The chain is not optional.
- **`backend-app-test`'s image is now four merges stale** — it carries
  #788/#790/#794-slice-1 but **none of #799, #795, #796 or #792**.
  Build-not-mount: rebuild before any e2e run or a stale image serves old code
  with no error.
- **No deferred e2e proof is outstanding.** Every fix this sitting was proven
  natively against code that actually executes, per the overlay's documented
  bars. Nothing is waiting on a gate to be believed.
- **`build-loop`'s "Docker on by default per iteration" does NOT apply to
  backend-internal slices here** — its own overlay carves them out ("real
  backend" = a mock with real query-matching semantics). Both build-loop
  iterations ran on that, correctly.

## Working rules confirmed this sitting

- **Read the routed skill's `local-env/` overlay *before* scoping, not
  after.** For #792 it settled the Docker question outright and named the
  branch-prefix constraint (`branch-guard.cjs` allows only
  `feature/docker-e2e-backend-integration`, `fix/<slug>`, `test/<slug>`;
  build-loop work uses `test/<slug>`). I asserted #794 needed a Docker
  decision *before* reading it, and had to correct that — the overlay's
  pure-frontend-UI bar needs no stack.
- **Read `canonical-data-contract-v1.md` and `canonical-data-cleanup.md`
  before escalating any field-naming question.** #795's apparent design fork
  was settled there outright (`patientID` is on a "Legacy Fields Prohibited"
  list). #796's came back **empty** — which is what made it a real escalation
  rather than a deferral. Run the check either way; the empty result is
  itself evidence.
- **Check the red run per-test, not in aggregate.** A not-yet-built
  capability's negative paths pass vacuously (pack #449). Three iterations
  this sitting had exactly one legitimately-passing test in their red run.
- **Anything multi-line or carrying shell metacharacters goes to a file
  first**, never inline into a Bash argument. A 190-line quoted heredoc
  failed at parse time; `gh issue comment --body "…"` failed on an escaped
  backtick. `--body-file` always works; `--body-file -` fed by a quoted
  heredoc works for shorter bodies.
- **The routing gate re-arms on the closed-list body read** — `issue-loop`
  tells you to read all N bodies up front, which lands *after* the
  `issue-loop` call, so the next `AskUserQuestion` blocks. Route the next
  item first. Pack #463.
- **A user-controlled `originalname` must never reach a filesystem path.**
  #792's retained files are named by batch id for this reason, with the
  original name kept only as metadata.

## Recommended next steps

**None queued — Dennis has not named the next group.** When he does, in the
order I would argue for them:

1. **#805** — a dead consent-invitation link across all four bulk paths.
   Concrete, no design question on the id half, and it means participants
   invited via template publication or any import cannot act on the email.
   The highest-severity *unblocked* item on the board.
2. **#796's decision** — cheap for Dennis to answer, and it unblocks a small
   fix either way.
3. **#684 / #800 / #801** — still the highest-severity item overall, still
   blocked on the RF010/RF021 actor model. One object-ownership decision
   unblocks all three, and #800 is now easier to reach than it was.
4. **#794 item 3** (correct-and-resubmit) — finishes RNF011 AC#4. Its
   dependency is discharged: #792 retains the file a corrected row would be
   resubmitted from.
5. **#803 / #797** — the two halves of the mock-blindness problem that hid
   #788, #795 and #796. An architecture test banning prohibited-list keys from
   fixtures would catch the whole class at once.
