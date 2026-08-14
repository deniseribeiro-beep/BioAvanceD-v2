# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

Opened by reading the prior handoff, then asked Dennis where to focus.
He picked triaging `#575` for a possible `issue-loop` split.

### `#575` triage — confirmed it does not split

`#575`'s own text is explicit the removal is "some changes are only
correct applied whole, not a chunkable one." No dependency chain to
extract. `#570`/`#571` are separate, "recommended not hard-blocking"
issues — no real blocked-sibling shape either.

### Backlog scan for a live blocked-item-skip shape (`#279` dogfooding)

Scanned the wider backlog per the prior handoff's fallback suggestion.
Found `#331` (Wave 2 e2e integration tracker) — 7 of 9 children closed,
2 open (`#325`, `#326`), both referencing a shared blocker `#320` that
was already closed — so no live block existed either. Two dead ends for
`#279` this session; asked Dennis what to do next, he chose to just work
`#331`'s remaining queue via `issue-loop` queue mode despite the lack of
a chain shape.

### `#325` (RF020) and `#326` (RF021) — both closed against narrowed deliverables

Both followed the same shape: scoping against the real acceptance
criteria found most of each RF's actual requirement unimplemented, per
`divide-and-conquer`:

- **`#325`**: `organization.routes.js` has only `GET`/`POST` (no
  update/delete), `Collection.js` is explicitly "Fase 1... não o
  conjunto MIABIS completo." Filed **`#576`** for the missing capability
  (org update/delete, full MIABIS fields, a management UI). Narrowed to
  organization create+list, added to
  `tests/e2e/study-protocol-collection-crud.spec.ts` (with an
  `AuditEvent` assertion). Merged `3e6e04de`, closed.
- **`#326`**: `approvalStatus` is set at protocol creation and never
  read anywhere else; no CAAE/validity-period field exists; consent and
  participant have no `studyId` linkage at all (only Sample does). Filed
  **`#578`** for the missing capability. Narrowed to a
  `protocolVersion`/`approvalStatus` round-trip test (the one real gap
  in existing coverage — the rest was already proven by `#320`'s spec
  and `specimen-quality-inventory.spec.ts:267-360`). Merged `7b2341d3`,
  closed.

Each closure ran its own `wrap-up`+`handoff` cycle per `test-loop`'s
every-iteration rule. `wrap-up` after `#325` found one finding: filed
**`#577`** (docs) — `E2E_TRACEABILITY_PLAN.md`'s grouping table still
names an un-created `participant-consent-studies.spec.ts` file; actual
coverage for that RF group landed in topic-specific files instead.

### `#331` gate-check — left open, not closed

All 9 Wave 2 sub-issues are now closed, but `#331`'s own Definition of
Done requires a green full real-backend run (same bar `#318` met before
closing). Ran the full suite against a freshly-brought-up
`compose.test.yml` stack: **69 of 109 tests failed.** Isolated the
likely root cause to a systemic bug — a module-level `MongoClient`
singleton pattern duplicated across `seedParticipant.ts`, `seedSensor.ts`,
`queryFoundationData.ts`, and `queryFhirImport.ts` throws
`MongoTopologyClosedError` mid-operation, confirmed via a clean isolated
repro (`scientific-data-access.spec.ts:51`, single worker, fails every
time). Filed **`#579`** with the full blast-radius breakdown. This
session's own work (`#325`/`#326`) and RF003 (`auth-access-security.spec.ts`)
are cleanly green both isolated and inside the full run — the failures
don't implicate this session's changes, but `#323`/`#324` (RF007/RF011,
already-closed Wave 2 issues) are among the specs now failing via
`#579`'s bug, reading as environment regression since their original
closure. Commented the full status on `#331` and left it open — `#579`
is what actually gates the close.

### Skills-pack findings filed

Two, both in `DyeAllPies/dyeallpies-skills-pack`:

- **`#293`**: `session-cleanup-checkpoint.cjs`'s `#250` fix (exempt Stop
  when the *last* tool call was backgrounded) breaks if any
  non-backgrounded bookkeeping call (a `TodoWrite`, a misfired
  `ScheduleWakeup`, a plain status echo) follows the backgrounded
  launch — that later call becomes the new "last tool use" and defeats
  the exemption. Hit live this session while waiting on the full e2e
  suite. User explicitly asked this be filed while waiting.
- (Referenced, not newly filed: `#250` itself, the original fix this
  refines.)

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, at `7b2341d3`
  (before this handoff commit). Working tree clean.
- **Docker test stack torn down** (`docker compose -f compose.test.yml
  down`, no `--volumes` — named data volumes preserved) — nothing left
  running. `test-results/`, `playwright-report/`, and the scratchpad's
  full-run log were deleted this session per `clean-up`.
- Both `test/325-...` and `test/326-...` branches merged, deleted
  locally (never pushed remotely).

## Next steps

**`#579`** (systemic `MongoTopologyClosedError` in the shared e2e Mongo
helpers) is the most concrete, well-scoped next pickup — it's blocking
real-backend verification for RF007, RF011, and likely RF009/RF022/
RF023/RF028 specs too (see its body for the full list and the shared
singleton pattern across 4 helper files). Fixing it is what would let
`#331` actually close.

**`#331`** stays open — re-run the full suite after `#579` lands and
close per its own DoD if green (or comment an updated status if not).

**`#575`** (the atomic Patient civil-identity field removal) is still
the queue's other big remaining item — untouched this session beyond
triage. Its own body carries full scope.

**`#368`** (tracking issue) stays open — `#575` is what finishes it.

**Skills-pack [`#279`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/279)**
(dogfooding `issue-loop`'s queue mode against a real multi-issue queue,
specifically the blocked-item-skip mechanism) — confirmed still **open**
as of this session's end. Still zero live data after this session's two
dead-end checks (`#575` doesn't split; `#331`'s remaining children
weren't actually blocked on each other). Worth a short follow-up comment
next session; consider whether the mechanism needs to be manufactured
deliberately rather than found organically in this repo's current
backlog shape. Don't let this one drop — it's been carried across
multiple sessions now with no real progress toward closing it.

- **pack-repo `#280`/`#281`** (long-carried) — still open, unchanged,
  not checked this session.
- **pack-repo `#283`** — same shape as `#280`, unchanged.
- **pack-repo `#248`/`#270`** — still open, unchanged; only remaining
  lever is a long loaded real session, not a dedicated debugging pass.
- **pack-repo `#286`** — per prior handoffs, Dennis was going to fix
  this directly in the pack repo. Not checked this session — carry the
  same "check if it landed" note forward again.
