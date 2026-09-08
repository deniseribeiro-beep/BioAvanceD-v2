# HANDOFF

**Written 2026-09-08, twenty-eighth queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff and pick the next *group* of issues, and said Docker was on but had
been off between sessions. I took the **reachability group** — code that
cannot take effect on a running stack: **#941, #1125, #1124**.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `524592a5` | Refs **#941** | `stagingImports.jobId` built natively by `utils/stagingImportIndexes.js`, wired at `createStagingImport` |
| `4d9c220d` | Refs **#1125** | `migrate:user-role-assignments` exposes `backfillUserRoleAssignments.js` |

**Filed: #1126** (project), **pack #852**, plus a recurrence comment on
closed pack #648. **Closed: nothing.** Query the tracker for state —
`gh issue list --state open`.

## Gates

- **Targeted native only, per the end-loaded gate order.** `[ran it]`
  6-file consumer set 120/120; 21-file consumer set 551/551;
  `npm run test:architecture` **131/131** twice. All exit 0.
- **NOT run this sitting: the full backend suite, the frontend suite, and
  the Docker e2e gate.** The last known-green figures are the previous
  sitting's — backend 467/8818, frontend 32/264, Docker e2e 223/223 — and
  **five commits have landed since that backend run** (`d96ae079`,
  `da6346a0`, `a66b5a9c`, and this sitting's two). Whoever gates next
  should not treat those numbers as covering the current tree.
- **Docker: Desktop is ON, no stack up, no volumes, bootstrap NONE.** The
  previous sitting tore down with `down --volumes`. The next gate starts
  cold, and `--build` is not optional after any `api/backend/src` change —
  `backend-app-test` is build-not-mount.

## The correction that matters most

**#941's own most recent comment (2026-09-04) says "BOTH call sites are
currently unreachable", and `[ran it]` both halves are false at
`a66b5a9c`.** `linkSensorMetadata` is called from `sensor.service.js:57`,
wired into `POST /api/sensors` by `be435d6c` on 2026-07-28 — five weeks
*before* that comment; the sweep that reported one hit appears to have
counted only a code comment. And `backfillLocationStorage.js` gained its
npm script in `a66b5a9c`.

So **both indexes from `9c190b1b` are on live paths**, and the
`sensorMetadata.sensorId` upsert race that comment calls "load-bearing" is
live on `POST /api/sensors` today. **The severity is higher than #941's
latest word on it, not lower.** Corrected on #941; #1070 already carried
the other half on the closed side.

The reusable part: **a "zero callers" sweep that returns only comment lines
has not established anything.** Read what the hits actually are.

## Things a next session must not undo

1. **`stagingImports.jobId` is built UNIQUE deliberately, against #941's own
   wording.** That thread says the unique half "guards nothing worth
   guarding" and only the lookup index is wanted. It is built unique anyway
   because `StagingImport.js` *declares* `unique: true`, and an index built
   non-unique would leave the declaration reading as a guarantee while
   enforcing nothing — #941's own trap one level down. Pinned by value.
2. **`sensorMetadata.macAddress` stays UNBUILT.** The upsert filter is on
   `sensorId`, so two sensors may already legitimately share a MAC; building
   it converts a tolerated state into a hard `E11000`.
3. **`backfillUserRoleAssignments.js` is npm-only on purpose** — a one-shot
   legacy migration, not a seed, so placement 3 of the conventions' "Where a
   new seed belongs". Don't promote it to a boot path or compose service.

## The judgment a query cannot carry

- **#941 is now down to its non-unique half.** All four unique specs are
  resolved (three built, `macAddress` deliberately not). What remains is the
  performance declarations at `Facility.js:48`, `Room.js:52`,
  `StorageBox.js:97/98`, `StorageContainer.js:100/101/102` — still never
  built, nothing *incorrect* without them. The title's "nine unique
  constraints across 10 models" is still the wrong number for that
  remainder.
- **#1125 is 11 of 19 now, and the eleven are two populations, not one.**
  `[ran it]` **six already have a unit test** (`migrateClinicalUnitOrganizations`,
  `migrateRoleAssignmentScopes`, `migrateUserAnonIds`, `migrateUserOrganizations`,
  `seedDiseaseValidationRules`, `testEnvironment`) and five do not. A
  dedicated test is a *consumer*, so the six are not deletion candidates
  under `fix-bugs`' dead-code default — their question is "wire it or invoke
  it", and only the other five carry a keep-or-delete question.
  `[not established]` whether those six tests exercise the CLI wrapper or
  only the service beneath it; that decides whether the test would even
  notice the script being deleted, and it should be checked per script.
- **#1124 was NOT worked** — it is the group's third member and its core is
  a capability decision (should the API create a StorageContainer at all?),
  which is Denise's. Its premise was established fresh by `a66b5a9c` last
  sitting; it does not need re-deriving, it needs an answer.
- **#1126 is the wiring gap this sitting's own fix avoided.** `[ran it]`
  nothing asserts either `utils/storageIndexes.js` helper is ever *called*,
  so deleting both call sites leaves the suite green. Test-only work; an
  `unit-test-loop` slice, not a `fix-bugs` one.

## Recommended next

**None queued by name.** Dennis named no specific issue.

1. **The group's remainder**: #1125 direction 1 (triage the other eleven,
   now split into two populations above) and #1126. Both are small and both
   have their direction settled.
2. **`ship-integration-branch`** — still Dennis's call, never yours, and
   note the gate caveat above: the full suites have not run against the last
   five commits.
3. **#1089 / #1118 / #1120 / #1123 / #1124** all still need someone; the
   first has four unanswered questions on it and should not be started
   without them.
