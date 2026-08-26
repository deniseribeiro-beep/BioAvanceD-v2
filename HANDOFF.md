# HANDOFF

> **INTERIM — THIS SESSION IS STILL RUNNING.** Written after iteration 3 of
> a self-picked 5-item queue. **3 of 5 worked, 2 remain.** A progress
> snapshot, not the definitive rotation. If you are reading this cold, the
> session ended unexpectedly mid-queue — treat the remaining two items as
> untouched and re-verify before assuming anything about them.

**Written:** 2026-08-26, first sitting of the day.

## ⚠ One decision is waiting on Dennis

**#796 is deliberately still OPEN.** Half of it shipped; the other half is a
genuine design fork that needs his call. See "Iteration 3" below for the
three options and the evidence. Nothing else in the queue is blocked on it.

## The queue

Dennis asked for the next 5 issues and left the pick to me. Theme: **make
the LGPD import quarantine usable, and close out the "field nothing writes"
cluster.** Docker was *not* authorised and has not been touched.

| # | Item | Route | State |
|---|---|---|---|
| 1 | **#799** FHIR reader serves LGPD quarantine batches | fix-bugs | **closed** `5d2e8cfc` / merged `ca8e01d3` |
| 2 | **#795** `Paciente ID: undefined` in the RF004 audit trail | fix-bugs | **closed** `377bb297` / merged `6d7cf459` |
| 3 | **#796** `persistConsentDeliveryFailure` no-op | fix-bugs | **partial** `b36d971c` / merged `e3b722f4`; **OPEN, awaiting Dennis** |
| **4** | **#792** import deletes the source file even when rows quarantined | build-loop | **next, not started** |
| 5 | **#794** items 2–3: quarantine UI + correct-and-resubmit | build-loop | not started |

**Ordering is load-bearing between 4 and 5:** #792 (retain the uploaded
file) is a hard dependency of #794 item 3 (correct-and-resubmit) — you
cannot resubmit a corrected row from a file that has been deleted. Do not
swap them.

Classification for all five was done **once, up front**, per `issue-loop`'s
closed-list rule. Don't re-derive it per item.

## Iterations 1–2, briefly

**#799** — `getBatch` discriminated on `_id` only, so every FHIR endpoint
resolved LGPD quarantine batches across a permission boundary. The body
missed two things: `validateBatch` is a **write** (it overwrote the batch's
`QUARANTINED` status and file-level counts), and `attachExternalDocument`
never calls `getBatch` at all — the pre-fix run reproduced it releasing an
LGPD row to `COMMITTED`/`RELEASED`/`AVAILABLE`. Fixed with an allow-list via
a shared `findFhirBatch`, 404 not 403.

**#795** — three reads of `sample.patientID`, all `undefined`; the RF004
audit row read literally `Amostra criada - Paciente ID: undefined` for every
sample ever created. The body's file citation was wrong
(`RegisterSample.js` is not in the call path; the route uses
`RegisterSampleUseCase`). The attached naming question was **already settled
by the repo's docs** — see Working rules.

## Iteration 3 — #796, and what Dennis needs to decide

**Shipped:** `sendConsentEmail`'s compliance metadata read
`patientData.patientID`, which no caller sets, so **every**
`RF_CONSENT_NOTIFICATION` row in `notification_compliance_logs` was written
with no link to the participant it was sent for. Now carries
`participantId`. No reader of `metadata.patientID` anywhere, so the rename
strands nothing.

**Open, needs a decision.** `persistConsentDeliveryFailure` is confirmed a
permanent no-op exactly as filed. But tracing surfaced evidence the body
didn't have: the three fields it writes (`consentDeliveryStatus`,
`consentDeliveryFailedAt`, `consentDeliveryErrorCode`) are **absent from
`PatientModel`'s canonical allowlist** (`models/Patient.js:8`), and the
function reaches Patient through a raw driver `updateOne` that bypasses the
model. So "just wire it up" is not neutral — it means writing non-canonical
fields onto Patient, which is what PR 100 removed. `docs/` has nothing
mandating a delivery-failure record, so unlike #795 the docs do **not**
settle this.

Three options, laid out on the issue thread: (1) delete, (2) wire up and
widen the allowlist, (3) record the failure on the notification side, which
is now queryable per participant thanks to the metadata fix. I lean 3, then
1, and did not guess.

## Filed this sitting

**Project:** **#801** (`attachExternalDocument` marks any record
`COMMITTED`/`RELEASED` with no validation-state check), **#802**
(`validateImportConsentToken`, the one query #799 left undiscriminated),
**#803** (test mocks return shapes production never emits — **25 candidate
sites**; the enabler for #795, #796 *and* #788, and the output-side mirror
of #797), **#804** (`sampleID` still emitted though prohibited; unlike
#795's key it is populated, so renaming breaks callers), **#805** —
**the most severe find of the sitting**: `buildConsentLink` emails
`/patients/undefined/consent?token=…`, with the token in a query string the
target page never reads, affecting **all four bulk consent-invitation
paths** (template publication, both LGPD imports, the CSV/FHIR import). The
working `eConsent.js` flow builds its link separately and correctly, so
there are two builders and the bulk paths use the broken one.

**Pack:** **#463** (routing gate blocks a queue-level `AskUserQuestion`),
**#464** (ending-sequence checkout dumps every touched file into context,
per iteration; plus the `git pull --ff-only` multi-branch failure),
**#465** (`fix-bugs`' bundled-sub-points rule only has one ending — "close
the original" — which loses the thread when the *unresolved* half is what
the issue is about; that is exactly #796's shape). Recurrence comments on
**#401** and **#398**.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`e3b722f4` + this rotation). No open PR; `main` frozen, 99 behind.
- All three fix branches deleted local **and** remote, no prompt any time
  (three more data points for pack #410's tally).
- **Correction to the pre-session handoff:** `test/787-lgpd-import-staging`
  is still present local and remote, fully merged. Its claim of "no
  outstanding `test/` branches" was true only of branches created that
  sitting. Safe to delete after the authorship check (precedent #332).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- `fix/599-*` (both merged), `test/377-docs-on-main` and
  `test/human-showcase-video` (not merged) unchanged.
- The known **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Still down, still cold — nothing started this sitting.**

- **Services:** none. **Bootstrap:** none. The four named volumes were
  dropped at the previous sitting's teardown and never recreated, so
  **nothing is seeded.**
- A next e2e gate needs the full sequence from scratch: 12-service recipe
  with `--build`, then `admin-bootstrap-test`, then the entire 17-service
  reference-data chain. Not optional.
- `backend-app-test`'s image carries #788/#790/#794 from the previous
  sitting but **none of #799, #795 or #796** — all three merges are
  host-side only. Build-not-mount: rebuild before any e2e run.
- Verification ran on the documented default — native only, gate end-loaded
  per `ship-integration-branch`. **Item 5 (#794 items 2–3) is frontend UI
  and cannot be proven natively**; raise the Docker decision with Dennis
  when that item comes up.

## Working rules confirmed this sitting

- **Read `docs/architecture/canonical-data-contract-v1.md` and
  `canonical-data-cleanup.md` before escalating any field-naming question.**
  #795's apparent design fork was settled outright there (`patientID` is on
  a "Legacy Fields Prohibited" list). #796's was **not** — the same check
  came back empty, which is what makes it a real escalation rather than a
  deferral. Run the check either way; the empty result is itself evidence.
- **Re-trace every issue body's file citations.** Three for three this
  sitting had errors: #799 understated severity and missed a write path,
  #795 named a file not in the call path, #796 missed that its own file
  contains a worse bug 30 lines up (#805).
- **Anything multi-line or carrying shell metacharacters goes to a file
  first**, never inline into a Bash argument. A 190-line heredoc failed at
  parse time; `gh issue comment --body "…"` failed on an escaped backtick.
  `--body-file` works; `--body-file -` fed by a quoted heredoc works for
  shorter bodies.
- **The routing gate re-arms on the closed-list body read** — route the next
  queue item before asking anything. Pack #463.
- **Check the red run per-test, not in aggregate.**

## Recommended next steps

**Continue the queue at item 4 (#792), then item 5 (#794).** Do not re-pick
or re-plan — the five were chosen and classified together, and #792 must
precede #794.

**Then bring #796's fork to Dennis**, if he has not answered by then.

Not in this queue, still the highest-severity item on the board: **#684**
(any authenticated user can revoke any patient's consent). Blocked on the
RF010/RF021 actor model. **#800 and #801 are the same class** — one decision
about object-ownership scoping unblocks all three.
