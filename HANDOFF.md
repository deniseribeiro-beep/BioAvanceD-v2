# HANDOFF

**Written:** 2026-08-05, after landing #441 (retention sweep job, RF014)
on `feature/docker-e2e-backend-integration`.

## What happened this session

Dennis picked #441 explicitly ("Pick #441"). Routed `build-loop`, which
this issue's own body flagged as needing its own design pass before
implementation ("the hard part").

**Design decision (the hard part):** `audit_events` (`audit-v2.service.js`)
is hash-chained per `logId` (`sequenceNumber` + `previousEventHash`) and
anchored by immutable `audit_tree_heads` snapshots — deleting an expired
event would break inclusion proofs for every later event in its chain.
Resolved by making the sweep support **only** `postRetentionAction:
'archive'` for `AuditEvent` scope: matching events move verbatim into a
new `audit_events_archive` collection instead of being deleted, so
nothing is ever mutated and the chain stays fully verifiable (tree heads
untouched, archived events still hash/proof-checkable). Any other
`postRetentionAction` (`destroy` in particular) is refused for
`AuditEvent` — logged and skipped, not silently downgraded. `Log` has no
such constraint, so plain timestamp-based `deleteMany` applies there
under any `postRetentionAction`.

**Built** (branch `test/441-retention-sweep-job`, merged into
`feature/docker-e2e-backend-integration` at `b176f75b`):
- `api/backend/src/services/retentionSweep.service.js` — reads the
  active `RetentionPolicy` (#440's `retentionPolicy.service.js`), applies
  the archive-not-delete logic above per `applicableEntityTypes`, writes
  a critical AuditEvent recording what was archived/deleted and under
  which policy version (RF014 #7).
- Wired into `scheduler.service.js` as a third node-cron job
  (`RETENTION_SWEEP_CRON`, default `0 4 * * *`), following the existing
  `temperatureTask`/`backupTask` registration pattern (init/stop, timezone,
  try/catch-and-log).
- 4 new unit tests on the sweep service (stateful mocks with real
  query-matching semantics — cutoff filtering, archive-vs-refuse
  branching) + `tests/unit/scheduler.service.test.js` updated (task
  count/indices shifted from 2→3 scheduled tasks, plus 3 new tests for
  the sweep task's cron callback). All passing.
- **Backend-internal-slice exception used** (same as #440's session): no
  literal Docker — mocked-Mongo with real query semantics, per the
  testing overlay's exception for slices proving service/query logic
  rather than one of the milestone's own e2e specs.
- Full native backend suite run clean otherwise — same pre-existing,
  unrelated `user.model.unit.test.js` failure (`UserModel.getRoleName is
  not a function`) noted in #440's handoff, confirmed present here too
  (still not filed — likely already known; check before assuming new).

**Filed:**
- **BioAvanceD-v2#443** — found during this session's `wrap-up`:
  `retentionPolicy.service.js#createPolicy` doesn't reject a policy with
  `applicableEntityTypes: ['AuditEvent']` + `postRetentionAction:
  'destroy'` at creation time; the sweep silently no-ops on it instead
  (correct behavior for safety, but the admin gets no validation error
  when saving the unsafe policy). Suggested fix: reject that combination
  in `createPolicy`. Low severity, no data-integrity risk.

**Closed:** #441, comment includes merge commit + design rationale + test
summary.

## Repo state

- **`feature/docker-e2e-backend-integration`**: has #441's merge commit
  (`b176f75b`) and is **pushed to origin** (confirmed this session).
- `test/441-retention-sweep-job` branch still exists locally (merged, not
  deleted) — safe to delete once confirmed no longer needed.
- Issues: **#441 closed**. **#443 open** (new this session, validation
  gap). **#442 still open** (dictionary gap for `retentionDurationDays`,
  from #440's session — Denise still needs to decide the canonical
  name/type). **#439 still open** (alias-removal follow-up, untouched
  again). dyeallpies-skills-pack#216 open (hook fix suggestion, from
  #440's session).
- Backlog otherwise unchanged: older backlog (`#371`/`#373`/`#374`/
  `#378`/`#379`), **#389**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.
- The `user.accessType` grep sweep carried forward eight handoffs now —
  still not done, and `user.model.unit.test.js`'s `getRoleName` failure
  (confirmed pre-existing again this session) might be related — not
  investigated.

## Dev stack state

Untouched this session — no Docker involved (backend-internal-slice
exception, see above). Last known state (from #425's session): dev stack
torn down, named volumes kept, RBAC catalog seeded on that stack
instance, 0 real users.

## Blocking next step

None. Branch is pushed and clean.

## Recommended next steps

Dennis picked #441 explicitly but didn't name a next pick after it, so
per this skill's own rule: **none queued** as an explicit instruction.
Backlog candidates:
- **#443** (new this session) — small, well-scoped validation fix in
  `retentionPolicy.service.js#createPolicy`.
- **#442** (dictionary gap) — blocked on Denise's decision, not
  actionable by a session alone.
- **#439** (alias removal, 131 call sites, atomic) — still open from
  three sessions back.
- Older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), or **#389**
  (route through `divide-and-conquer` first, 28 files)
- The carried-forward `user.accessType` grep sweep (eight handoffs now)
  — maybe worth pairing with a look at the `user.model.unit.test.js`
  failure noticed again this session.

## Which skills to use

- #443: `fix-bugs` or `resolve-issue` — small, single-file validation
  change with a clear repro (create a policy with `AuditEvent` +
  `destroy`, assert it's rejected).
- #439: `resolve-issue`, atomic per the note left on the issue itself —
  no incremental chunking, confirm the canonical field set before
  touching any of the 131 call sites.
- Otherwise unchanged from prior handoffs for older backlog/#389.
- No local-env gotchas changed — the `gh repo view --json
  nameWithOwner -q .nameWithOwner` note still holds (repo slug is
  `deniseribeiro-beep/BioAvanceD-v2`, not `DieAllPies/...`); skills-pack
  issues go to `DyeAllPies/dyeallpies-skills-pack`.
