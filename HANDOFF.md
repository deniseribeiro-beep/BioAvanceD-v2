# HANDOFF

**⚠ INTERIM SNAPSHOT — this session is still running.** Written after
iteration 4 of a self-picked 5-item queue. **4 of 5 worked, 1 remains
(#722).** This is NOT the definitive rotation; if you are reading it
cold, the sitting ended unexpectedly before #722.

## The queue

Dennis asked for the next 5 issues and left the pick to me, then said
**"Docker is on"**. Theme: finish the consent-invitation path, make the
LGPD import usable from the UI, and spend the cold Docker sequence on
the item only a live stack can settle.

| # | Issue | Route | State |
|---|---|---|---|
| 1 | **#805** consent link emails `/patients/undefined/consent` | fix-bugs | **half fixed** `2a374ce1` / merged `2f6bcbd3`; **OPEN**, frontend half is #809 |
| 2 | **#796** `persistConsentDeliveryFailure` no-op | fix-bugs | **closed** `1886a3c8` / merged `10f3710f` |
| 3 | **#808** LGPD import has no frontend caller | build-loop | **closed** `f5d8bdd1` / merged `c823fa45` |
| 4 | **#794 item 3** correct-and-resubmit | build-loop | **split**; prerequisite `cfdac0bc` / merged `579775aa`; **OPEN**, extraction is #817 |
| 5 | **#722** RF029 tests depend on the bootstrap chain | test-loop | **not started** — needs the cold Docker sequence |

#802 was dropped from an earlier draft of the queue in favour of #796.
Still open and unworked.

## The theme: bodies are wrong about their *premises*

All four iterations turned on a false premise that pointed at the
**wrong fix**, not merely a mis-scoped one:

- **#805's "Suggested fix" would have shipped a broken link** —
  `/patient/e-consent/${token}` `jwt.verify`s; every caller passes a
  random hex from a different token system. → pack **#469**.
- **#796's "docs say nothing" was wrong** — RF015 AC#3 mandates exactly
  what the dead function pretended to do. The earlier check grepped the
  *field names*; the requirement is Portuguese prose. → pack **#470**.
- **#808's premises had both moved** — `importLGPDService` was no longer
  dead, and its "delete as cruft" option was actively wrong.
- **#794 item 3 was not one iteration** — see below.

**Operating rule, now four for four: a "docs are silent" or "this is
dead" or "the fix is X" conclusion in this repo needs re-deriving from
scratch, and the docs search must be concept-level and in Portuguese.**

## Iteration 4 — why #794 item 3 split

Correct-and-resubmit means re-running a corrected row through the path
that rejected it. Anything else is a second validator, and **this repo
produced exactly that failure this same sitting** (#805/#809: two
consent-link builders, bulk paths on the broken one). On the import path
that drift is worse because it is silent — a row the import would reject
gets accepted on resubmit, the "correção silenciosa" AC#4 forbids.

Sharing the path means extracting the `for` loop at
`import-lgpd.service.js:1078-1445` — **~370 lines** with validation, a
participant lookup, duplicate checks, drug resolution, storage
placement, `AllocateSampleUseCase` (occupancy grid, StorageAssignment,
audit, Neo4j lineage) and `SampleGraphValidator`. Filed as **#817**.

**The blocker that made a prerequisite necessary:**

```js
getNextAvailableStorageSlot(db, startBoxId, results.success)
```

The **running success count within the batch** is the storage slot
index, and `startBoxId`/`autoIncrement`/`groupFields` came from the
request. The batch document persisted **none** of it — so the placement
intent ceased to exist when the request ended, and no resubmit could
have reproduced it at any level of effort.

**Landed:** `quarantineRejectedSampleRows` now records a normalized
`importOptions` on the batch (`counts.success` is the matching cursor),
and `importSamples` passes what it ran under. `sanitizeImportOptions`
admits only plain scalars into `groupFields`.

**Remaining for item 3:** #817 (extraction) → the resubmit endpoint,
which needs **one design call** — what storage slot a resubmitted row
takes, given its original batch position was never allocated (reuse the
original index, next free slot now, or operator chooses) → the editing
UI + a committed e2e spec.

## Filed this sitting

**Project:** #809 (bulk consent-token system: complete backend, no
frontend — #805 depends on it), #810 (template publication aborts its
whole notification sweep on the first patient that throws), #811 (RF015
AC#3's remaining legs), #812 (`notification_compliance_logs` keeps
participant emails forever and **no retention policy can be created for
it** — #667), **#813** (*the reachable importer has no quarantine* —
`/import` posts to the async importer, which discards rejected rows),
#814 (LGPD patient paths don't quarantine either; **do #807 first**),
#815 (`downloadTemplate` builds a URL with no route behind it), #816
(frontend route authorization **fails open**), **#817** (the extraction),
#818 (`groupFields` unvalidated from the request body; safe today only
because every consumer remembers to `String()` it — the #802 shape).

**Pack:** #468 (a mistyped filename in a targeted `vitest run` is
silently ignored — **check the reported `Test Files` count against the
number you named**; also: don't pass `--reporter` here, the frontend's
vitest 4.1.9 *crashes* on `--reporter=basic` while the backend's 4.1.10
accepts it), #469, #470, #471 (`git grep` over `grep -r`). Comments on
#463 (the routing gate is *why* RF015 got found — narrow its fix on what
the question is about, not when it is asked), #414 (the per-slice
overlay re-read costs ~11k chars/iteration; I deliberately skipped it
for iteration 4 and said so), #410.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`579775aa` + this rotation). No open PR; `main` untouched, 99 behind.
- All four branches this sitting deleted **local and remote**, no prompt
  any time.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Pre-existing branches unchanged: `test/787-lgpd-import-staging`
  (merged; delete only after checking per-commit authorship, precedent
  #332), `fix/599-*` (both merged), `test/377-docs-on-main` and
  `test/human-showcase-video` (not merged), plus the two stale remotes
  left alone deliberately.
- **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Engine is UP (28.5.1) and authorised. Nothing has been started yet.**

- **Services: none running, none stopped.** `docker ps -a` returns zero
  containers.
- **Bootstrap: NONE.** The four named volumes
  (`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data`) are
  absent — `docker volume ls` shows no `*test*` volumes at all.
- **#722 is next and it is the Docker item.** It needs the **full cold
  sequence**: the 12-service recipe with `--build`, then
  `admin-bootstrap-test`, then the entire 17-service reference-data
  chain — because #722 is *specifically about* those two RF029 tests
  passing or failing depending on whether that chain ever ran.
- `backend-app-test` is build-not-mount and now **eight merges stale**.
  Rebuild before any e2e run or a stale image serves old code silently.

**Two deferred proofs outstanding, both to be discharged at that gate:**

1. **#808's page has no committed e2e spec** — unit tests plus a
   throwaway browser check only, per the overlay's pure-frontend bar.
2. The `importOptions` change (`579775aa`) touches the import path that
   #817's extraction will refactor; a real sample import through Docker
   would confirm nothing regressed.

## Recommended next steps

**Finish the queue — #722**, behind the cold Docker sequence above. Its
three options (seed a fixture pair, add the bootstrap chain to the
documented recipe, or skip/document the dependency) are best chosen
*after* running the chain once and seeing whether the two RF029 tests go
green — which is the evidence nobody has gathered yet.

After the queue: **#805's frontend half (#809)** is the highest-value
open item, then **#807 before #814**, then **#817**.
