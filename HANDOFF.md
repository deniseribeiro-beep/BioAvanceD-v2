# HANDOFF

**Written 2026-09-22, thirty-seventh queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction: read the
handoff, Docker is on, pick the next group. **The group picked was #941, the
unbuilt-index inventory, on the strength of Denise's own classification
comment settling the direction question that had stalled it through twelve
comments.**

## Repo state

`feature/docker-e2e-backend-integration`, tree clean and matching origin.
Four commits this sitting, all pushed. Last substantive commit is the
wiring-assertion one; this note is the fifth commit and rides alone.

## What shipped

**#941 is NOT closed and should not be** — see "the correction" below.

- **`5e21ee19`** — `sensorMetadata.macAddress` unique, PARTIAL on
  `$type: 'string'`. Closes a live inconsistency: `sensor.service.js`
  documents, catches and returns a *"macAddress duplicado"* failure, and the
  upsert filter is `{sensorId}`, so that E11000 was one the database could
  not produce. The handler was unreachable; it is reachable now.
- **`d248af51`** — three storage lookup indexes BUILT, two DELETED.
- **`a9c1300c`** — `facilities.name` and `rooms.{facilityId,name}` BUILT.
  Inventory of the `Schema.index()` call form complete: seven built, two
  deleted.
- **`a9b94615`** — pins the three wiring lines that could be deleted with the
  suite staying green. A recurrence of #1126 that this sitting caused.

## The method, because it is the reusable part

**Every BUILD/DELETE was decided by `explain('executionStats')` on the query
shapes in `src/`, in a scratch collection, not by reading the code and
reasoning.** `[ran it]` — and it matters, because **inference gets two of
them wrong**:

- `StorageContainer {name}` and `StorageBox {name}` were DELETED. Both
  collections really do `.sort({name:1})`, so "there is a sort on name,
  therefore keep the name index" is the natural read and it is false — those
  sorts follow a **selective** filter, so the planner takes the compound
  index and sorts a handful of rows in memory. Neither is ever the winning
  plan. Both deletions are pinned by a test asserting the index is NOT built.
- `Facility {name}` is the same-looking declaration and the **opposite**
  verdict, because its filter (`deletedAt: null`) is unselective and the sort
  is then the dominant cost.

Filed as pack workflow guidance, since nothing in the pack said how to answer
"is this index needed at runtime".

## The correction a next session must not undo

**My own first inventory comment on #941 was incomplete, and the corrected
one is the newest comment there.** The grep behind it was
`git grep -E "\.index\(" -- api/backend/src/models`, which finds only the
**call** form. **Field-level `unique: true` / `index: true` declarations are
equally inert and it cannot see them** — `StorageContainer.containerID`, named
in the issue's own body, is exactly that form.

**Six field-level declarations are still inert**, and they are #941's real
remainder: `Sample.specimenId`, `Sample.participantId`, `Terminology.codigo`,
`Terminology.ativo`, `Cid.active`, `StagingImport.status`. In three of four
cases a native helper already exists for the collection and builds exactly
one index while the schema declares more, so the work is mostly extending
helpers. `[not established]` whether any is a winning plan — that is the same
`explain()` measurement, unrun. **Unverified prescription:** measure
`Sample.specimenId`/`participantId` first, because `samples` is the largest
live collection and #779's cost model already rested on an index that did not
exist.

## The stack is UP, and it is NOT pristine

14 services, 11 `Up (healthy)`, same volumes as the last two sittings.

- **`backend-app-test` carries HAND-COPIED source.** `[ran it]` I
  `docker cp`'d `storageIndexes.js`, `lookupIndex.js` and `facilityIndexes.js`
  into `/app/src/utils/` to run the real helpers against real Mongo. They
  match the committed tree, but **the container was not rebuilt and no longer
  matches its image.** Rebuild it before trusting it for anything else.
- Probe scripts were removed; scratch collections (`zz_*`) were dropped.
  `[ran it]` verified both.
- **`frontend-app-test` is still `Exited (143)`** — bring it up before any
  Playwright run.
- **The 17-service reference-data bootstrap chain has still NOT run.**
- **`INFLUXDB_HOST_PORT=18086` is required on this machine**; 8087 is inside
  an excluded range.

## Things a next session must not undo

Items 12-21 from the previous note still hold. Plus:

22. **`macAddress`'s index is PARTIAL and `sensorId`'s is PLAIN, deliberately.**
    `sensorId` is the upsert FILTER key, so it structurally exists on every
    row. `macAddress` reaches the document only through `$set`, behind an
    `if (sensor.macAddress)` guard in the CALLER, and `required: true` is a
    mongoose validator that never runs because every write here goes through
    the native driver. A plain unique index would reject the second row that
    legitimately lacks one. `[ran it]` on mongo:7, 7/7 including two rows
    with no macAddress and two with an explicit null.
23. **Each `createIndex` has its OWN try/catch on purpose** — a shared one
    reports the first failure and skips the rest silently (#1027's shape,
    where one throw cost 46 index builds). A lookup-index failure message
    must never borrow the unique-index wording about duplicates already
    written; a test asserts that distinction by its prose.
24. **The route wiring is on the READ path, and that is a deliberate
    divergence** from the unique helpers' write-path wiring. An index that
    exists for a sort must be built where the sort runs. **This is half of
    #1163 and is unresolved** — the storage lookup indexes are still ensured
    only at a one-time backfill's write path, so both conventions are now in
    the tree. Dennis's call.
25. **The route wiring tests pass a DISTINCT `collectionName`.** The helpers
    latch per resolved name for the life of the process, so a shared name
    lets the first test suppress every later one and the assertions pass or
    fail by file order.

## Open, and left in a known state

Query the backlog with `gh issue list --state open` — **redirect it, and do
not reach for `--limit N | head`**: that bounds rows, not bytes, and costs
~17 KB. `[ran it]` this sitting paid exactly that, having read the rule.

Touched, not closed:

- **#941** — open, with the six field-level declarations named above as its
  remainder, and my own incomplete inventory corrected in its newest comment.
- **#1163** — filed by this sitting. Half 2 shipped (`a9b94615`); **half 1 is
  open and is a design call**: where a read-serving index's ensure call
  belongs. Both sides of the split were introduced today, which is why it was
  named rather than settled.
- **#1147** is adjacent and unread by this sitting: it says the facility/room
  CRUD surface has no caller anywhere. Two indexes were built for those
  routes on the planner's evidence; if #1147 deletes the routes, the indexes
  go with them. Not a blocker, worth knowing.

Previous sitting's #1159 and #1162 are still open and still Dennis's.

## Recommended next

**None queued by name** — Dennis named no follow-up.

**Unverified prescription, unchanged from the last note:** a full-suite e2e
gate is still the biggest un-taken step, and it needs `frontend-app-test`
back up, the reference-data chain, `--workers=1`, and the **skipped** count
read rather than the pass count.

Still undone from eight notes: **diff Requisitos v4.0.0 against v3.0.1 for RF
renumbering** before building further on `E2E_TRACEABILITY_PLAN.md`.
