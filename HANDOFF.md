# HANDOFF

**Written 2026-09-07/08, twenty-third queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff and pick the next *group* of issues, and said Docker was on. I took the
previous note's recommendation #1 plus its "together" pair — **#1102, #1094,
#1096** — and all three shipped and closed. A fourth slice (#1106 direction 3)
was split out and shipped too. Five commits.

**The FULL end-loaded gate ran and is GREEN, Docker included** — native
466/8773 and Docker e2e 223/223, both against these five commits.

## What shipped

| commit | issue | what |
|---|---|---|
| `f1f1e800` | **#1102** | `participantIdentities` indexed at last — three non-unique indexes, latched in `collectionResolver.js` |
| `46f56160` | — | corrects `f1f1e800`'s stale issue reference to #1104 |
| `13fcea1a` | **#1094** | `AuditEvent.source` stamped `'api'`, not the HTTP Origin header |
| `0f2804ad` | **#1096** | a failed PRIMARY audit write now raises the critical alert, not just a failed mirror |
| `7d9fa26b` | Refs **#1106** | that alert now says *which* kind of failure it was |

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

## The one thing a next session must not undo

**`0f2804ad` and `7d9fa26b` keep BOTH audit-failure kinds at `severity:
'critical'`, and a test pins it.** The tempting cleanup is to downgrade the
validation case to `error` because it is "only" a caller defect. Don't: the
audit row is unwritten either way, which is the whole #369/#394 lesson — a
quieter signal for a missing audit row is exactly what hid the last one for
~4 weeks. `details.failureKind` carries the diagnosis; severity carries the
urgency, and they are not the same axis.

- **#1094 stamps `'api'` EXPLICITLY rather than letting `Log.js:124`'s default
  fire.** `[ran it]` the no-`req` path was never broken — `extractRequestInfo`
  returns `{}`, so the default already applied. Only the HTTP paths were wrong.
- **#1102's two hash indexes buy nothing until #1104 lands** — both matching
  sites still `$or` against a live plaintext arm, and Mongo serves an `$or`
  from indexes only when every arm is indexed. The `participantId` index is
  the part that pays today. Do not "optimise away" the hash indexes as unused.

## Issue state

Query it — `gh issue list --state open`. What a query cannot carry:

- **Closed this sitting: #1102, #1094, #1096.** Filed: **#1104, #1105, #1106,
  #1107**, plus dyeallpies-skills-pack **#823, #824, #825, #826**.
- **#1104 is the sharpest of the four, and it is not what its ancestor says.**
  `[read it]` **#574 is TITLED "cut ParticipantIdentity's civil-identity fields
  over to ciphertext-only" and is CLOSED** — it closed on its own stated
  *precondition* ("Only once all of the above are repointed does dropping the
  plaintext fields become safe"), and the drop never happened. `[ran it]` the
  precondition is now satisfied: all 8 writers route through
  `encryptIdentityFields`, every reader goes through `decryptIdentity`. So the
  cutover is unblocked. **#1102's body cited "#574/#1072" for this; both are
  closed and #1072 is about `mfaSecret`.** Trust #1104, not that reference.
- **#1107 is a SECURITY finding and is the highest-severity thing filed.**
  `POST /api/logs/register` is `authenticate`-only while every other route in
  `logs.routes.js` also carries `requireAuditReader`, and `userId`, `timestamp`
  and `source` all come from the request body — so any logged-in user can write
  a misattributed, backdated row into the immutable Merkle-hashed audit trail.
  Write-side mirror of the closed #1056. `[not established]` whether the route
  has any consumer; check that first, since a zero-consumer answer makes the
  rest moot.
- **#1106 stays OPEN deliberately.** Direction 3 shipped as `7d9fa26b`;
  direction 2 (fail closed on machine ingest) is an availability trade for
  cold-chain telemetry and is **Denise's call**, not a session's.
- The four pack issues can only be worked from a `dyeallpies_skills_pack`
  session — Rule 0, enforced mechanically by `junction-write-guard`.

## Gates

- **`npm run test:architecture` 124/124** after every iteration.
- **Per-iteration consumer sweeps, all green:** #1102 53 files / 1394;
  #1094 53 / 1627; #1096 59 / 1758; #1106 5 / 205.
- **Can-it-fail probes on every slice, executed count checked against the
  green baseline both runs (#804):** #1102 1 red/8 then 4 red/8 across both
  sites; #1094 2 red/80; #1096 2 red/84; #1106 3 red/136 across both sites.
- **Full native suite: `[ran it]` 466 files / 8773 tests, 0 failures, exit 0.**
  Supersedes the previous note's 465/8754. Backgrounded — 589s, past the 600s
  foreground ceiling in practice.
- **Docker e2e: `[ran it]` 223/223 passed, `--workers=1`, 2.1 minutes, zero
  failures, exit 0.** Recipe as the `docker-workflow` overlay documents it,
  with `--build` (mandatory — four commits touched `api/backend/src`). All 12
  core services healthy and none restarting (#664), `admin-bootstrap-test`
  `Exited (0)` (compose reported 1 — gotcha 3's known false negative), and all
  **17 bootstrap-chain services `Exited (0)`**, verified as a count of
  non-zero-or-still-running rather than by eye.

**Stack is DOWN and cleaned.** `[ran it]` at rotation: **zero containers**,
33 images / 8.697GB, 33 volumes / 939.9MB, **build cache 0**. `builder prune
-af` reclaimed **1.048GB** — `system df` had reported only 9.2MB of build
cache, the exact gap `-af` exists to close, and the second sitting running to
reproduce it. `test-results/` and every `/tmp` redirect target and scratchpad
script were removed.

**Not done, needs Dennis:** **28 anonymous Docker volumes** remain (21 at the
previous rotation, so ~7 are this sitting's). `docker volume prune` would take
the other 21 too, so it was left alone rather than guessed at — unchanged in
kind from the previous note, just larger. The 33 images are kept deliberately:
they share layers (33 images = 8.697GB total, not the naive sum of the
per-image figures) and the component that actually bloats, the build cache, is
at zero.

## The judgment a query cannot carry

- **A closed issue's TITLE is not evidence its title's work happened.** #574
  closed on its precondition, and three sessions since have cited it as though
  the cutover shipped — including #1102's body, which sent me at a `mfaSecret`
  issue. When a fix's value depends on another issue's outcome, re-read that
  issue's own close comment against its body's exit condition.
- **`[ran it]` a helper called fire-and-forget must issue all its work before
  the first `await` yields.** `#1102`'s first version `await`ed three
  `createIndex` calls in a `for` loop; the resolver does not await it, so
  indexes two and three were never issued. The wiring test caught it — 1 call
  instead of 3. `Promise.all` over per-index `try`/`catch` fixes both that and
  the #1027 one-catch-per-index lesson.
- **`[ran it]` `node --check` is CJS-only and reports a FALSE `SyntaxError` on
  an ESM test file** in a package without `"type": "module"` — which is every
  vitest file here. #813's rule reads as content-independent; it is not. Pack
  **#823**.
- **`[ran it]` `<cmd> | head -N; echo "exit=$?"` reports the PIPE's status.**
  Measured side by side: real exit 1, laundered exit 0. #760 binds its rule to
  `&&`, so a `;`-separated diagnostic echo does not see itself. Pack #823.
- **`full-suite-guard` resolves the consumers-list path against ITS cwd, so the
  write and the run must share one.** Writing `api/backend/consumers.txt` from
  the repo root and running from `api/backend` blocks, with a message about
  breadth that names none of the real cause. Pack **#825**.
- **`[ran it]` a 53-file consumer sweep takes ~138s here — past the 120s Bash
  default** — and ~99s of it is vitest *import* time, so the cost scales with
  file count, not test count. Only the whole-suite ceiling is documented. Pack
  **#826**.

## Recommended next

Dennis named a *group* and the group is finished; **nothing further is queued
by name.** In rough order of value:

1. **#1107** — the security finding, the only one with a real exposure, and
   **now fully scoped: both halves of the dead-code bar are met.** `[ran it]`
   the route has a frontend binding (`api.ts:692` → `useLogs.ts:145`) but
   **zero live callers** — `LogsPage.tsx:40` is the only consumer of `useLogs`
   and never destructures `registerEvent`. `[ran it]` the docs are silent on
   any client-submitted audit event (searched the Portuguese concept, not the
   identifier, per this repo's rule); the RF/RNF hits are RNF009's append-only
   server-side trail and outbox projection. So **direction 3 — remove the
   route — is available and is the cheapest fix**, taking three dead frontend
   symbols with it. Start here.
2. **#1104** — the ciphertext cutover, now unblocked. Directions 1 and 2 both
   end correctly and differ only in sequencing, so no design round trip is
   needed. This is what makes #1102's hash indexes start paying.
3. **#1105** — smallest of the three: a validated caller-declared `source`,
   plumbed through the `logImport`/`logError` wrappers.
4. **#1098** — pins the four `startServer()` boot postures;
   `RUN_SERVER_IN_TEST=1` already exists and nothing uses it. Unchanged from
   the previous two notes.
5. **#1092** — unchanged across five notes now. One query against a populated
   database answers it.
