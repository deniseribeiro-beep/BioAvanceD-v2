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

**Closed: #1079, #1095, #1119.** #1095 closed `premise-corrected`.
**Open and awaiting someone: #1089, #1118, #1120, #1121.**
Query the tracker for state — `gh issue list --state open`.

## Two gates did NOT run — read this before trusting anything below

- **The full backend suite was STILL RUNNING when this was written.** It
  was launched backgrounded and its result is *unknown*. Its log is at
  `<scratchpad>/backend-full.log`; the scratchpad is session-scoped and
  may be gone. **Re-run it.** Every commit above is covered by targeted
  runs (below), but nothing has confirmed the whole suite green.
- **The Docker e2e gate did NOT run.** `[ran it]` `docker ps -a` is empty:
  stack DOWN, no containers, volumes still gone from the previous
  sitting's prune. **Bootstrap state: NONE.** The next gate starts cold —
  12 core services **with `--build`**, then `admin-bootstrap-test`, then
  the 17-service chain, then `--workers=1`.
  - **`--build` is not optional this time**: `api/backend/src` changed
    (`temperature.service.js`, `audit.middleware.js`), and
    `backend-app-test` is build-not-mount, so a plain `up -d --wait`
    reuses a stale image. That trap is recorded three times already.

## What targeted runs DO cover

- **#1079**: `temperature.service.test.js` 31/31; consumers 10 files / 175
  tests; architecture 131/131.
- **#1119**: consumers 34 files / 1179 tests; architecture 131/131.
- **Frontend**: 32 files / 264 tests, exit 0.

## #1121 is the one thing a gate must settle

`b04cb00c` is `Refs`, not `Fixes`, and **#1121 stays open until an e2e run
takes `auth-access-security.spec.ts` green.** Its assertion is a static
trace plus a typecheck, not an observation.

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

The honest candidates, in order: **finish the two gates above** (the
backend suite and the Docker e2e run, which together also close #1121);
then **#1089** if its four questions get answers. `ship-integration-branch`
is premature until the gates are green — the PR to `main` is Dennis's call,
never yours.
