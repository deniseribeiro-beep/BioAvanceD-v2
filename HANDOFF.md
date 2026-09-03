# HANDOFF

**Written 2026-09-03, eleventh queue sitting. INTERIM — no end signal
from Dennis.** He asked for "the next 10 issues, Docker is on." **6 closed,
1 partially shipped, 12 issues filed.** 7 commits pushed.

**The Docker gate RAN GREEN: 22 passed (20.8s), none skipped.** Native gates
green too. Re-derive every count below rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, tree clean and
  matching origin. `main` untouched, no PR.
- Last substantive commit: the `#1023` import-row-number fix.
- **No new npm scripts, dependencies or env keys.**
- New test file: `api/backend/tests/integration/storage-allocation.api.test.js`
  — the first integration coverage of any storage mutation route.

## Docker state

- **Stack is DOWN.** Brought up from `compose.test.yml` with `--build`
  (backend source changed), gated, then `down --remove-orphans`. Zero
  containers.
- **Both bootstraps ran and exited 0** against the current volumes:
  `admin-bootstrap-test` and `foundation-bootstrap-test`.
- **Service names are NOT what they look like.** `[ran it]` The backend is
  `backend-app-test`, the frontend `frontend-app-test` — a guessed
  `backend-test` fails with `no such service` **after** the whole build
  finishes, and the background wrapper still reports exit 0. Take names from
  `docker compose -f compose.test.yml config --services`.
- Cleanup: `docker builder prune -af` reclaimed **1.047GB**. Images back to
  the pre-existing **33 / 4.683GB**. **Local volumes are now 65 / 1.852GB,
  up from 56 / 1.537GB** — compose-managed, near-empty, left alone. The five
  `bioavanced-test-*` named volumes are **kept**; dropping them, or any
  machine-wide prune, still needs Dennis's consent.

## What closed (6)

`#933` `#1018` `#1025` `#1023` `#1031`, plus `#1006` **partially** (3 of its
4 writable sites; it stays OPEN for auto-assign, which is blocked on #1026).

## The judgment a query cannot carry

- **`[ran it]` `#986` item 1 already shipped in `490077f4`, and its fix
  traded a password oracle for a cheaper enumeration one.** The enrolment
  guard now runs *before* `bcrypt.compare`, so `POST
  /auth/two-factor/qr-first-login` returns `'MFA já configurado…'` for an
  enrolled account with **any** password — unauthenticated account-existence
  and enrolment disclosure. `processLogin`'s own comment in the same file
  says *"enumeration is the worse leak."* Filed as **#1032**; #986 now tracks
  item 2 only.
- **`[ran it]` `create-db.js` almost certainly aborts on its FIRST
  collection.** `createFirstAdmin.js` builds `users.email`/`username`
  unnamed+unique; `create-db.js` builds the same keys unnamed with no
  options. Measured on `mongo:7`: `IndexKeySpecsConflict` **(86)**. `users`
  is `COLLECTIONS[0]` and the loop has no per-index catch. **If it holds,
  #983's field drift has never been reachable** — so #1027 sequences before
  #983. `[not established]` end-to-end via `npm run create-db`; that needs a
  seeded DB.
- **`[read it]` A naive #1023 fix would have been a data-integrity
  regression.** `quarantineRejectedSampleRows` derived the array index back
  out of the displayed row number (`rows[row - 2]`). Changing only the three
  `rowNumber` lines would have attached the wrong row — or `null` — to every
  quarantined record in a file with an earlier blank row. Fixed by carrying
  the index separately; **no fallback**, because `row - 2` on a physical line
  computes a wrong index silently.
- **`[ran it]` `#941`'s body is four corrections stale.** Nine `Schema.index`
  sites survive, **two** unique (not nine over ten files); `StorageBox`'s
  `sparse` hazard no longer exists; and building `sensorMetadata.macAddress`
  would be a **regression**, since the upsert keys on `sensorId` and nothing
  reads macAddress. `Model.createIndexes()` avoids the drop objection the
  whole thread is organised around — nobody had said so.
- **`[ran it]` `#956`'s audit half already shipped in `e0b175a1`**, and its
  frontend has a `TEMPERATURE_READING_DISABLED = true` kill switch, so the
  success branch is unreachable and a backend fix alone is invisible.

## Conventions this sitting relied on / established

- **`| head` on a completeness-oriented read is the sitting's most expensive
  habit.** Three instances; one produced a materially stale agent brief that
  sent a research agent to re-investigate shipped work. Pack **#717**.
- **`[ran it]` A bare `git checkout --` during a can-it-fail probe destroyed
  a delegated worker's UNCOMMITTED fix** — pack #663's exact trap, in a
  sitting that had followed it correctly twice hours earlier. A delegated fix
  arrives already-written, so the probe lands *before* the commit by
  construction. Pack **#719**, with a hook proposal.
- **`docker compose ps` after `--wait`, never the exit code** — and note the
  background wrapper's exit code is not compose's either.
- **The two-hop consumer sweep paid again**: the #1023 worker's scoped run
  was green while `import-lgpd.persistImportOptions.unit.test.js` was red,
  found only by sweeping importers of the changed module.

## Filed this sitting

Here: **#1027 #1028 #1029 #1030 #1032 #1033 #1034 #1035** open; **#1031**
filed and closed in the same sitting.
On the pack: **#717 #718 #719**.

**Worth reading first: #1032** (unauthenticated enumeration oracle,
security), then **#1027** (the abort that gates #983), then **#1030**
(decision record — my #933 change widened what one admin may do to another,
and wants Dennis's confirm-or-reverse).

Query the board for everything else: `gh issue list --state open`.

## Recommended next

**None queued by Dennis.** The queue he named still has unworked members:
**#983** (blocked on #1027), **#986** item 2 (a missing IP-attempt store,
`0..1 Condicional` so deferring is spec-compliant), **#989** (key *delivery*
is his call; the swallow is not), **#941** and **#956** (both now have a
decided direction on-thread and are the cheapest unblocked work).
