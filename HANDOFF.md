# HANDOFF

**Written 2026-09-08, twenty-seventh queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff, pick the next *group* of issues, and said Docker was on. I took a
cold-chain telemetry group — **#1089, #1079, #1095** — and the two issues
that work turned up, **#1119** and **#1121**.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `213567d1` | **#1079** | threshold alerts carry `type: 'threshold_breach'`, auto-resolve on the first in-range reading, and `getActiveAlerts` is bounded |
| `60b62093` | **#1119** | `auditRequest` resolves the audit row's entity from the path captured at middleware entry |
| `79b62087` | Refs #1095 | corrects `iot.controller.test.js`'s wrong prediction that its rejection test would invert |
| `b04cb00c` | Refs **#1121** | the RF014 criterion-7 e2e query asks for `SecurityConfiguration` |

**Closed: #1079, #1095, #1119, #1121.** #1095 closed `premise-corrected`.
**Open and awaiting someone: #1089, #1118, #1120.**
Query the tracker for state — `gh issue list --state open`.

## Gates

- **Backend full suite: GREEN.** `[ran it]` **467 files / 8818 tests**,
  exit 0, 621.91s (was 466/8806 before this sitting's additions). Covers
  every commit above.
- **Frontend: GREEN** — 32 files / 264 tests, exit 0.
- **Architecture: 131/131.**
- **Docker e2e gate: GREEN.** `[ran it]` **223 passed (2.0m)**, exit 0,
  `--workers=1`, zero failures, on a cold stack built this sitting with
  `--build`. Verified per container, not by `--wait`'s exit code: 12 core
  services `Up (healthy)`, `mongo-rs-init-test` `Exited (0)`,
  `admin-bootstrap-test` `Exited (0)`, all 17 bootstrap-chain containers
  `Exited (0)`.
  - **The stack is DOWN again and its volumes are gone** — `down
    --volumes` at cleanup, containers 0, volumes 0, build cache pruned
    (1.048GB; `docker system df` claimed 433.3MB, `docker buildx du` had
    it right). **Bootstrap state: NONE.** The next gate starts cold.
  - **Images KEPT** — 33, 8.697GB, none active. Removing them buys 8.697GB
    against a multi-minute rebuild of a 12-service stack plus the
    17-service chain on the next gate; a machine-wide prune is Dennis's
    call, not a session's.
  - **`--build` is not optional after any `api/backend/src` change**:
    `backend-app-test` is build-not-mount, so a plain `up -d --wait`
    reuses a stale image. Recorded three times already; it held again.

## Per-issue targeted runs, for attribution if the full suite ever reds

- **#1079**: `temperature.service.test.js` 31/31; consumers 10 files / 175
  tests. Probe: reverting the product file reds 6 of 48 across the two
  files, one per behaviour site.
- **#1119**: consumers 34 files / 1179 tests. Probe: reverting the
  middleware reds 5 of 33 — the 5 new cases at both levels — with all 11
  pre-existing middleware cases green.

## #1121 is CLOSED, and how it was proven is the reusable part

The gate took `auth-access-security.spec.ts` green. Then, because a green
spec does not show the fix caused it, the pre-fix query was restored to
that one file and re-run against the same live stack: **1 failed**, at
exactly `expect(requireMfaEntry).toBeTruthy()`, line 619. Red with
`SecurityConfig`, green with `SecurityConfiguration`, same stack.

**The finding behind it matters more than the fix**: the previous handoff
cleared `4a51a916` as having no e2e surface because *"no spec references
`SecurityConfig`"*. `[ran it]` that is false — `auth-access-security.spec.ts`
referenced it as a **URL query parameter**, which an emitting-side search
does not see. Treat "no e2e surface" claims about a rename as unproven
unless the search covered spec *query strings*, not just symbols.

## Things a next session must not undo

1. **#1119's fix is `const requestPath = req.path` captured at middleware
   ENTRY**, before `next()`. Moving that read back inside the `res.send`
   wrapper reinstates the bug — Express has stripped the mount prefix by
   then. The `ignoredPaths` check above it deliberately still reads
   `req.path` directly and is correct.
2. **`audit-entity-coverage.arch.test.js` proves the MAP, not the
   composition.** It feeds `determineEntity` the full `/api/<mount>` path,
   which the runtime never supplies; it was green for the entire period
   the behaviour was broken. Its new SCOPE note says so and names the two
   files that pin the composition. Don't "simplify" it back.
3. **`iot.controller.test.js`'s `#1093` rejection test is CORRECT and must
   stay green.** It asserts the *controller* audits nothing on a 400. The
   request is audited anyway, by middleware that unit test never mounts.

## The judgment a query cannot carry

- **#1117 should not be answered until someone re-reads it.** Its premise
  is that `Sistema` rows are a closed historical population before
  `a84eaa63`. `[ran it]` 57 of 61 mounted prefixes were still recording
  `Sistema` after it; the real boundary is `60b62093`. `ENTITY_MAP`'s
  `HISTORICAL CUTOFF` docblock still names the wrong commit — deliberately
  not edited, because that is #1117's own subject. Commented there.
- **#1089 is atomic, not chunkable, and both its `[not established]`
  items are now settled.** `temperaturePolicies` is canonical; `Policy.js`
  is temperature-only by its own docblock and untouched since the initial
  commit. `[ran it]` the blocker: feeding `PolicyModel.create()`'s output
  to `TemperaturePolicy` fails on **four** required fields and drops
  **eight**, and dict-02's `profileName` (P1X-0106, 1..1 Core) has no API
  source. Four questions on the issue; **do not start it without answers**.
- **A premise-wrong issue can be worth more than a correct one.** #1095's
  central claim was false, and establishing that is what found #1119 —
  a defect four times its size. Re-running a body's trace is not overhead.
- **`docker compose config --services` before naming services**, and
  `docker ps -a` per container rather than `--wait`'s exit code. Unchanged.

## Recommended next

**None queued by name.** Dennis named no specific issue; "pick the next
group" was the whole instruction.

**Every gate is green** — backend 467/8818, frontend 32/264, architecture
131/131, Docker e2e 223/223 — and the tree matches origin, so the branch is
at its cleanest since the last ship.

The honest candidates, in order:

1. **`ship-integration-branch`.** The PR to `main` is where real CI signal
   comes from, and it is **Dennis's call, never yours**. This is the first
   sitting in a while where nothing is unproven.
2. **#1089**, but only once its four questions have answers — the issue
   carries them and the reasoning for why no slice stands alone.
3. **#1118 / #1120**, both filed this sitting and both still needing their
   own `[not established]` items established before a direction is chosen.
   Neither is an owner's call yet; nobody has done the tracing.

**#1117 is not on this list on purpose** — read the note above before
answering it.
