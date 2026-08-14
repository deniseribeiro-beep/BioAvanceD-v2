# HANDOFF

**Written:** 2026-08-13, mid-session on `feature/docker-e2e-backend-integration`.
Session in progress — this rotation is a checkpoint after closing `#325`,
not the session's final one; `#326` is still queued for this same
sitting via `issue-loop` queue mode.

## What happened this session

Opened by reading the prior handoff, then asked Dennis where to focus
(three options: start `#575` directly, triage `#575` for an `issue-loop`
split, or check the long-carried pack-repo backlog). He picked triaging
`#575`.

### `#575` triage — confirmed it does not split

`#575`'s own text is explicit that the removal is "some changes are only
correct applied whole, not a chunkable one" (a half-applied version
breaks `PatientModel.create()` immediately). No dependency chain to
extract there. `#570`/`#571` are separate, pre-filed, "recommended not
hard-blocking" issues — no real blocked-sibling shape either.

### Backlog scan for a live blocked-item-skip shape (the `#279` dogfooding gap)

Per the prior handoff's fallback suggestion, scanned the wider backlog
for a tracking issue with a real blocked-on-sibling shape. Found `#331`
(Wave 2 e2e integration tracker) — 7 of 9 children closed, 2 open
(`#325`, `#326`). Both referenced a shared blocker, `#320` (Study/
Protocol/Collection CRUD gap) — but `#320` was already closed, so no live
block existed either. Net: two dead ends this session for `#279`'s
zero-data blocked-item-skip mechanism; asked Dennis what to do next, he
chose to just work `#331`'s remaining queue (`#325`/`#326`) via
`issue-loop` queue mode despite the lack of a chain shape.

### `#325` (RF020 Metadados institucionais e MIABIS) — closed against a narrowed deliverable

Pre-work scoping (a backgrounded `Explore` agent, gated through
`agent-delegation` first, plus my own spot-checks) found the full RF020
capability doesn't exist: `organization.routes.js` has only `GET`/`POST`
(no update/delete), and `Collection.js`'s own header comment says "Fase
1: apenas identidade/atributos essenciais — não o conjunto MIABIS
completo." Per `divide-and-conquer` (and per `#325`'s own issue text,
which named this exact scenario as the expected move):

- Filed **`#576`** — carries the missing capability (Organization
  update/delete route, full MIABIS field set on Organization/Collection,
  a management UI).
- Commented on `#325` narrowing its scope to what's actually testable:
  Study/Protocol/Collection CRUD (already covered by `#320`'s existing
  spec) plus Organization create+list.
- Routed the narrowed issue through `test-loop` → `e2e-test-loop`. Added
  an `organizations create+list (#325)` block to
  `tests/e2e/study-protocol-collection-crud.spec.ts` — create+list, a
  validation-rejection case, and an `AuditEvent` assertion (via
  `watchAuditTrail`/`assertAuditEventRecorded`) proving the global audit
  middleware records the create.
- Brought up the `compose.test.yml` stack fresh this session (Docker
  Desktop wasn't running) to verify: all 11 tests in the file pass
  (9 pre-existing `#320` tests + 2 new).
- Committed on `test/325-rf020-institutional-metadata-crud`, merged into
  `feature/docker-e2e-backend-integration` (`3e6e04de`), pushed, branch
  deleted locally (never pushed remotely, so nothing to delete there).
- Closed `#325` against the narrowed deliverable, naming `#576` as the
  carried remainder.
- `wrap-up` found one finding: `E2E_TRACEABILITY_PLAN.md`'s
  "Grouping strategy" table still names an un-created file
  (`participant-consent-studies.spec.ts`) for the RF004/RF005/RF010/
  RF020/RF021 group — actual coverage landed in topic-specific files
  instead (`intake-wizard.spec.ts`, `tcle-dinamico.spec.ts`,
  `study-protocol-collection-crud.spec.ts`). Filed as **`#577`**
  (documentation, low priority).

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, at `3e6e04de`.
  Working tree clean.
- **Docker test stack is up** (`compose.test.yml`, brought up this
  session for `#325`'s verification) — `mongodb-test`, `neo4j-test`,
  `redis-test`, `mqtt-test`, `influxdb-test`, `smtp-test`, `tsa-test`,
  `witness-test`, `backend-app-test`, `worker-test`, `frontend-app-test`,
  `admin-bootstrap-test` all healthy. `playwright-runner` was stopped
  per the docker-workflow overlay's gotcha before the manual run. **Left
  running** — `#326` (next in this same sitting) is also a real-backend
  e2e slice and can reuse this stack; tear down with `docker compose -f
  compose.test.yml down` (add `--volumes` for a from-scratch reseed) once
  the session's e2e work is actually done, not mid-queue.
- `test/325-rf020-institutional-metadata-crud` — merged, deleted
  (local only; never pushed).

## Next steps

**`#326`** (RF021 Estudos, protocolos e ética — real-backend spec, Wave
2) is next, same sitting, via `issue-loop` queue mode continuing on
`#331`'s queue. Not yet scoped this session — check whether its
capability already exists (same kind of check `#325` needed) before
assuming it's a plain `test-loop` slice; `#326`'s own issue text already
flags "same CRUD-gap overlap as RF020... see #320" and suggests
"consider scoping both together if the underlying API surface is the
same slice of work." Given `#325` closed narrow and `#576` now carries
the actual institutional-metadata gap, re-check `#326`'s own scope
against current code rather than assuming the `#320` overlap note is
still the live blocker (it wasn't, for `#325`).

After `#326`: per `issue-loop` queue mode, walk `#331`'s parent chain —
if both children are now closed (narrowly or otherwise), check whether
`#331` itself is closeable (it explicitly requires **all** Wave 2 issues
closed or superseded by tracked follow-ups, which both `#325`→`#576` and
a to-be-determined `#326` outcome would satisfy under the "superseded by
follow-up" clause).

**`#575`** (the atomic Patient civil-identity field removal) is still
the queue's actual big remaining item — untouched this session beyond
triage. Its own body carries full scope.

**`#368`** (tracking issue) stays open — `#575` is what finishes it.

**Skills-pack `#279`** (dogfooding, queue-mode blocked-item-skip) —
still zero live data after this session's two dead-end checks (`#575`
doesn't split; `#331`'s remaining children weren't actually blocked on
each other). Worth a short follow-up comment on `#279` next session
noting these are two more negative results, and considering whether the
mechanism needs to be manufactured deliberately rather than found
organically in this repo's current backlog shape.

- **pack-repo `#280`/`#281`** (long-carried) — still open, unchanged,
  not checked this session.
- **pack-repo `#283`** — same shape as `#280`, unchanged.
- **pack-repo `#248`/`#270`** — still open, unchanged; only remaining
  lever is a long loaded real session, not a dedicated debugging pass.
- **pack-repo `#286`** — per prior handoffs, Dennis was going to fix this
  directly in the pack repo. Not checked this session — carry the same
  "check if it landed" note forward again.
