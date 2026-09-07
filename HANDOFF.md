# HANDOFF

**Written 2026-09-07, twentieth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff
and pick the next groups of issues. I proposed three groups plus the previous
note's own recommendation; he chose **"just #1093 first"**. That shipped —
one commit, one issue closed, three filed here plus one on the pack.

## What shipped: #1093, and its open question is now answered

`d77cde86` — `POST /api/iot/telemetry` now audits its accepted ingest.
**Direction 1** (mirror #1080's `auditLogger` call), but not for the reason
the issue gave. #1093 left `[not established]` *whether the canonical
requirements treat MQTT and HTTP telemetry as one ingestion surface or two*.

**They answer it, and it is worth carrying forward as a fact rather than a
re-derivation.** `[read it]` `dict-02_DICIONARIO.md:762`, **P1X-0331**:
`AuditEvent.source` is a **1..1 Core** field whose vocabulary is
*"api, frontend, worker, mqtt, scheduler ou system"*. One audit surface with
a transport discriminator — not two trails. That also kills #1093's own
suggested `source: 'http'`: an HTTP route is **`api`**, already in the
vocabulary.

`[read it]` And direction 2's stated advantage does not hold:
`integrityCheckService#buildMerkleForDate` folds **every** `logs` row into the
same daily Merkle root as the `mqtt_ingestion_audit` leaves
(`allLeaves = leaves.concat(biomarkerLeaves, mqttLeaves)`), so an
`auditLogger` row is already tamper-evident with no second chained
collection.

## Three direction decisions are now SETTLED — this is the thing a query cannot carry

Dennis chose these in chat this sitting. **All three issues are still OPEN and
unworked**; the direction is recorded as a comment on each, so don't
re-litigate:

- **#1085** → direction 3, **warn always, refuse in production**.
- **#1086** → direction 1, **previous-key slot only** (`ENCRYPTION_KEY_PREVIOUS`
  / `_PREVIOUS_ID`, `isActive: false`). No re-encryption migration.
- **#1072** → direction 1, **encrypt AND rename to `mfaSecretCiphertext`
  together**. **#1086 must land first** — its slot is what stops a later
  rotation turning every enrolled secret into a `decryptValue` `null`, which
  #1072's body traces into the two unauthenticated first-login guards.

That is a ready-to-work chain of three with no forks left in it.

## Issue state

Query it — `gh issue list --state open`. What a query cannot carry:

- **#1093 closed.** Filed this sitting: **#1094, #1095, #1096**, plus
  **dyeallpies-skills-pack#809**.
- **#1095 inverts a test if it is resolved in favour of auditing.**
  `iot.controller.test.js`'s `'#1093: an invalid payload is refused before
  anything is audited'` deliberately pins today's behaviour and says so
  in-file. That is the intended signal, not a regression.
- **#1096 is the sharpest of the three filed.** `[read it]`
  `log.service#createLog` **rethrows** on a failed primary `logs` insert, on
  purpose — and `auditLogger.log`'s outer catch converts it to a bare
  `console.error`. The repo already escalates the *narrower* failure (the
  `audit_events` mirror) to a critical `AUDIT_TRAIL_WRITE_FAILURE`, with an
  in-code comment saying a warn line alone hid it for ~4 weeks (#369/#394).
  The escalation guards the copy and not the original.
- **#1094 and #1096 are both about `auditLogger`/`log.service`, a shared
  helper on every audited path.** They are a natural pair and neither is
  route-specific.

## Gates

- **Targeted native only. `[ran it]`** `iot.controller.test.js` 23/23;
  two-hop consumer sweep **84 derived / 80 ran / 2329 passed / exit 0** (the
  four unrun are two `tests/architecture/` files, a generator and
  `vitest.setup.js` — none are vitest suites); `npm run test:architecture`
  **124/124**.
- **Docker NOT run this sitting, deliberately** — the gate order is
  end-loaded and this was one slice. Dennis noted Docker is on; nothing was
  started, and `docker ps` was not checked, so treat the stack's state as
  **unknown** rather than as the previous note's torn-down end state.
- **Full backend native suite NOT run this sitting.** The previous note's
  464 files / 8681 tests stands as the last measurement, not as a fresh one.

## The judgment a query cannot carry

- **An 84-file consumer sweep exceeds the Bash tool's 120s foreground
  ceiling** and gets auto-backgrounded. `[ran it]` this sitting. Not a
  failure — but read your own redirect when it lands, not the harness's task
  `.output`.
- **`full-suite-guard` reads the consumer-list file at PreToolUse, i.e.
  BEFORE your command runs.** So writing the list and running the sweep in
  one compound command blocks every time — the file does not exist yet.
  `[ran it]`, cost one retry. Filed as pack#809; it is the third distinct
  way the derived-list idiom composes into a block (after #758 and #796).
- **`iot.controller.js` and its test are both CRLF; `mqtt-ingestion-audit.service.js`
  is too.** Detect per file, as always — the EOL-aware bounded-anchor script
  shape worked cleanly here for all three edits.
- **The iot unit test harness drives the controller through
  `createRequire` + `require.cache`, not vitest's module graph.** A
  `vi.spyOn` on the `auditLogger` singleton required at the test file's top
  level therefore IS the object the controller's lazy `require` gets —
  `vi.resetModules()` does not clear Node's own cache. That is why the
  reproduction worked without mocking the module.
- **`resourceType` for this route is `TelemetryReading`, not `Temperature`.**
  `[read it]` `contracts/canonical/v1/index.js:218` already maps
  `POST /api/iot/telemetry` to it (ELM-0357..0365). The sibling route's
  `'Temperature'` names the Mongo record *that* route creates.

## Recommended next

Dennis said "**first**", so more was expected; nothing is queued by name.
In dependency order, and the first item is unusually cheap right now:

1. **#1085 → #1086 → #1072**, in that order. All three directions are
   settled above, so this is implementation with no design round trips.
   `[unverified]` as a sizing claim — I read the issues but did not open
   `keyRegistry.js` or `auth.service.js` this sitting.
2. **#1094 + #1096 together** — same two files (`auditLogger.js`,
   `log.service.js`), both filed an hour ago, context is cheapest now.
   #1096 carries a real availability trade (fail-closed machine ingest) that
   is Denise's call; #1094 does not.
3. **#1092**, unchanged from the previous two notes and still untouched. One
   query against a populated database answers it.
