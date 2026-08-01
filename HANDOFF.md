# HANDOFF

**Written:** 2026-08-01, after closing #369 (audit logger canonicalization
flood, `fix-bugs`, Docker authorized but not needed — native tests fully
proved the fix) on `feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the same day's prior session (which closed #393).
Dennis picked #369 directly by name and said Docker was on for the
iteration; it ended up not being needed — the bug reproduced and was
fixed with native vitest alone.

**#369's problem:** `docker logs bioavanced-backend-1` showed a
sustained flood of `[WARN] ... Falha ao espelhar log em audit_events:
Tipo não suportado na canonicalização JSON: object`.

**Root cause:** `AuditV2Service.ingestLogRecord()`
(`api/backend/src/services/audit-v2.service.js`) passed
`logRecord.createdAt` straight through as `recordedAt`. `LogModel.create()`
(`api/backend/src/models/Log.js`) always sets `createdAt` to a real
`Date` instance, but `audit-canonicalization.service.js`'s
`assertJsonValue()` only accepts JSON-safe types and rejects `Date`
(`typeof` is `'object'`, `Object.prototype.toString.call()` returns
`'[object Date]'`, not `'[object Object]'`). This meant **every single
audit log write** threw inside `createEvent()`'s `digestCanonical(event)`
call — caught and logged as a warning by `log.service.js`'s
`createLog()`, which is exactly the flood reported. The existing unit
test for `ingestLogRecord` had masked this because its fixture used a
string for `createdAt` instead of a real `Date`.

**Fix** (`fix/369-audit-canonicalize-recordedat-date`, merged into
`feature/docker-e2e-backend-integration` at `1ca68874`, fix commit
`7027b1c4`): convert `Date` → ISO string at the leak point —
`recordedAt: (logRecord.createdAt instanceof Date ?
logRecord.createdAt.toISOString() : logRecord.createdAt) || new
Date().toISOString()`. Checked the other `createEvent`/`createTreeHead`
call sites (`audit-migrate-v2.js`, `audit-e2e-real.js`,
`daily-merkle.job.js`) — all already pass ISO strings; this was the only
broken call site.

**Verified:** added a reproduction test in
`tests/unit/audit-v2.service.test.js` using a real `Date` fixture
matching `LogModel.create()`'s actual shape — confirmed red before the
fix, green after. Targeted run across the audit/log chain (
`audit-v2.service.test.js`, `audit-logger.unit.test.js`,
`logger-audit-trail.test.js`, `log.service.test.js`,
`log.service.unit.test.js`, `auditLogger.test.js`,
`auditRoot.service.test.js`, `logs.routes.test.js`, `logs.api.test.js`)
— 262 tests, all green, both on the fix branch and re-run after merging.
`npm run lint` clean (311 files).

**Issue #369 closed** (comment noting merge commit `1ca68874`). Fix
branch deleted (local + remote).

**Two follow-on issues filed** while closing out #369 (wrap-up's
shipping-addendum gate — the original root-cause comment on #369 named
both as unaddressed, which isn't a valid resting place once the issue
closes):
- **#394**: the `audit_events` V2 Merkle audit trail
  (`audit-v2.service.js`, introduced 2026-07-03, only two commits ever
  in that file's history) was silently non-functional for **all real
  request traffic** for the ~4 weeks until today's fix — every
  `ingestLogRecord()` call threw and was swallowed as a warning. Only
  script-driven paths that pass pre-formatted ISO strings directly
  (`audit-e2e-real.js`, `audit-migrate-v2.js`, `daily-merkle.job.js`)
  could have written real `audit_events`/`audit_tree_heads` entries in
  that window. Needs an owner call: whether any real deployment during
  that window needs a compliance-trail gap investigated, and whether the
  silent-warning failure mode should be made louder (metric, not just a
  log line).
- **#395**: `intake-wizard.spec.ts`'s intermittent **mocked**-auth
  redirect to `/login` on a long-running stack (the second, unconfirmed
  observation from #369's original report) is **not** addressed by
  #369's fix — that spec makes no real backend calls, so it can't be
  caused by the audit-mirroring failure. Root cause still unknown; not
  investigated this session.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `1ca68874`, **in sync
  with origin** (nothing outstanding to push). Working tree clean except
  the pre-existing `catalog.1.3.0.json` phantom line-ending diff (#391 —
  still open/unfixed, still a no-op, untouched again this session).
- Issues: **#369 closed** (`1ca68874` / `7027b1c4` noted in the close
  comment). **#394 and #395 newly opened** (both `bug`-labeled, both
  unstarted).
- `fix/369-audit-canonicalize-recordedat-date` (merged) deleted, local +
  remote.
- Untouched from before: **#389** (storage/custody separation, open),
  **#390** (multi-consumer migration, open, depends on #383+#388+#389),
  **#391** (`.gitattributes` phantom-diff fix, open, small/mechanical),
  **#392** (dict-02's fuller SpecimenPreanalytics fields, open,
  build-loop sized). Local branch hygiene unchanged: everything merged
  except `test/377-docs-on-main`, tracked by still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. Candidates, roughly by
size/readiness:
- **#391** (`.gitattributes`): smallest, mechanical.
- **#395** (intake-wizard mocked-auth flakiness): needs investigation
  first — root cause genuinely unknown, no pinned test.
- **#394** (audit_events historical gap): an owner-judgment question
  more than a code fix — read it and decide whether backfill/monitoring
  work is wanted before treating it as a coding task.
- **#389**/**#390**/**#392**: unchanged from prior handoffs, see below.

## Which skills to use

- **#391** (`.gitattributes`): small, mechanical `resolve-issue`.
- **#395** (intake-wizard flakiness): `fix-bugs`, budget time for
  investigation — likely a mocked-auth/`page.route` or client-side
  session-timing issue, not yet reproduced.
- **#394** (audit_events historical gap): not a `fix-bugs` candidate as
  filed — it's asking for an owner decision (backfill? louder failure
  mode?) before any code change. Surface it to Dennis rather than
  picking an implementation approach unprompted.
- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice (28 files, already half-separated
  via `storageBoxes`). Check dict-02's "Entidade" column for the
  canonical name before naming anything (dyeallpies-skills-pack#179).
- **#390**: blocked on #389.
- **#392**: `build-loop`, needs new parsing logic, not just a wrapper.
- Backlog unchanged otherwise from prior handoffs: **#384–#387** (four
  architecture-gap issues), older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`) — untouched this session.
