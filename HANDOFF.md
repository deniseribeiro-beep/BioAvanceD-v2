# HANDOFF

**Written 2026-09-03, twelfth queue sitting. INTERIM — no end signal from
Dennis.** He asked for "the next 10 issues, Docker is on." **4 closed, 6 still
open with verified research posted on each, 9 issues filed.** 4 commits pushed.

**Read #1037 first. It is an unauthenticated privilege escalation and it is
reproduced, not inferred.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, tree clean and
  matching origin. `main` untouched, no PR.
- Last substantive commit: the `#1034` db.factory commit.
- **No new npm scripts, dependencies or env keys.** No new test files; two
  existing ones gained cases.
- Re-derive every count below rather than trusting it.

## Docker state

- **Nothing left running.** No stack was brought up this sitting.
- The only container used was a **throwaway `docker run --rm mongo:7`** to
  reproduce #1027 end to end, stopped and auto-removed. `[ran it]` no
  `bioav-*` containers remain.
- **The full Docker gate has NOT run against this sitting's four commits.**
  All four are natively verified; none of them touches compose, e2e fixtures
  or anything gate-shaped, so no proof is deferred — but the gate is still
  owed before shipping.

## What closed (4)

`#1032` `#1033` `#1027` `#1034`.

## The judgment a query cannot carry

- **`[ran it]` #1037 is real and reproduced end to end.** An unauthenticated
  `POST /api/auth/register` with `accessType: 4` returns 201 and inserts
  `{roleId:'role-administrator', scopeType:'global', assignmentStatus:'active'}`,
  with `mfaEnabled:false, mfaSecret:null` on the user. The #998 hierarchy
  floor — whose own comment describes this exact attack — sits on
  `user.routes.js`, and `auth.routes.js:67` reaches the same service with no
  `authenticate`, no permission gate and no floor. The frontend calls
  `/users/register`, not this route; it appears to have no legitimate caller.
  **Direction 4's floor (never honour a caller-supplied privilege level on an
  unauthenticated route) is not a design question; whether the route should
  exist at all is Denise's.**
- **`[ran it]` #1027's abort is now measured end to end, and my own fix made
  #983 REACHABLE for the first time.** Before: `IndexKeySpecsConflict`, exit 1,
  **0 of 18 collections created** on any stack with an administrator. After:
  exit 0, 18 collections, 44 of 46 indexes. So #983's drifted indexes now
  actually get built by anyone running `npm run create-db` — its priority went
  up, not down.
- **`[ran it]` #941's recommended call cannot run today, for two separate
  reasons**, both filed: `SensorMetadata` declares `sensorId`/`macAddress`
  twice so `schema.indexes()` emits 4 specs with 2 duplicated auto-names
  (#1039), and mongoose's index-build errors escape `try/catch` via
  `model.emit('error')` and would crash the process on Node 22 (#1040). Its
  load-bearing claim — `createIndexes()` does not drop — **holds**, verified
  against mongoose 9.2.1's actual source.
- **`[read it]` #1028's direction 1 is refuted, not merely costly.**
  `withMongoTransaction` has no topology guard (that is a separate opt-in
  export it never calls), and only `compose.test.yml` is a replica set — so
  adopting it breaks user creation on dev and prod **while the gate stays
  green**. A fourth direction (widen #435's pre-write guard) dominates.
- **`[ran it]` #1029 is ~4x its stated size**: `requireOrganizationScope`
  only gates org-less callers and attaches a scope; none of the five ungated
  handlers consumes it, so middleware alone ships a false sense of security.
  Plus `organizationId` is on the update allowlist, letting a correctly-scoped
  caller re-stamp a sensor into another org — which no direction listed there
  closes.
- **`[read it]` #956's direction 2 is a two-file change whose empty path
  re-creates the exact "realizada com sucesso: N/A°C" alert the issue is named
  for**, because `useSensors.ts:59` unwraps with `||` and the page has no
  absence branch. Its un-weakening set is **one** hard pin, not two.
- **`[ran it]` The two import drifts INVERT between the two importers**
  (#1041): #1035's *".xlsx is unaffected"* and #1023's blank-row framing are
  both true of `import-lgpd.service.js` and **false** of
  `batch-validation-engine.service.js`.

## Conventions this sitting relied on / established

- **A leaf-worker brief must not name `git stash`.** `fix-bugs` mandates it
  for the can-it-fail probe; the leaf-worker guard refuses every git mutation.
  Composing the two produces an instruction the worker cannot run. Pack #726.
  Ask for a hand-edited revert/restore instead.
- **`[ran it]` The sanctioned whole-suite regression now exceeds the Bash
  600s ceiling** (615s) and gets auto-backgrounded — and the harness's own
  capture held **only the summary**, no failure detail. The independent
  redirect is what saved the run. Pack #730. Always redirect and read your own
  file.
- **`[ran it]` The full backend suite is 458 files / 8427 tests**, and
  `auth-rate-limiter.test.js` consumes 79% of its 5000ms timeout on an idle
  machine — so it reds the suite and greens when investigated alone (#1038).
  Expect exactly that one failure and do not attribute it to your change.
- **Verify an agent's claim before filing on it (#712).** Two of this
  sitting's returns were partly wrong in the safe-sounding direction; both
  were caught by re-deriving before filing.

## Filed this sitting

Here: **#1036 #1037 #1038 #1039 #1040 #1041**.
On the pack: **#726 #727 #728 #729 #730**, plus a recurrence comment on #687.

Verified research posted as comments on **#1028 #941 #1029 #956 #983** —
each corrects its own issue's body or newest comment. **Read the comment
before scoping any of them; several bodies are wrong in both directions.**

Query the board for everything else: `gh issue list --state open`.

## Recommended next

**None queued by Dennis** — he named no successor to the ten.

Of the six queue members still open, **every one now turns on a decision
rather than on missing information**, which is why they are open rather than
worked:

- **#1037** — direction is partly Denise's (should the route exist), but the
  no-caller-supplied-privilege floor is not.
- **#983** — blocked on "should `create-db.js` exist at all"; it is
  simultaneously dead as code (zero callers) and load-bearing as documentation
  (`app.js` ×4 and four MIABIS models cite it).
- **#1029** — wants a `divide-and-conquer` split, sketched on-thread.
- **#956** — blocked on whether the manual-reading button stays.
- **#941** — sequenced behind #1039, which is a two-line subtractive fix.
- **#1028** — direction 4 is unblocked and shippable now.
- **#1035** — disposition (fix vs close-with-a-template-rule) is a judgment
  call; #1041 carries the half that is unconditionally wrong.
