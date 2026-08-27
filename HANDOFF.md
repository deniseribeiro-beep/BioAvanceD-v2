# HANDOFF

**Written 2026-08-26.** Dennis asked for the next 5 issues, left the pick
to me, and authorised Docker. **The queue is worked: 3 closed, 2
deliberately left open with reasons below.** This is the definitive
rotation for this sitting.

## What this sitting did

Theme: finish the consent-invitation path, make the LGPD import usable
by an operator, and spend the cold Docker sequence on the one item only a
live stack could settle.

| # | Issue | Route | Outcome |
|---|---|---|---|
| 1 | **#805** consent link emails `/patients/undefined/consent` | fix-bugs | **half fixed** `2a374ce1` / merged `2f6bcbd3`; **OPEN** — frontend half is #809 |
| 2 | **#796** `persistConsentDeliveryFailure` no-op | fix-bugs | **closed** `1886a3c8` / merged `10f3710f` |
| 3 | **#808** LGPD import has no frontend caller | build-loop | **closed** `f5d8bdd1` / merged `c823fa45` |
| 4 | **#794 item 3** correct-and-resubmit | build-loop | **split**; prerequisite `cfdac0bc` / merged `579775aa`; **OPEN** — extraction is #817 |
| 5 | **#722** RF029 tests depend on the bootstrap chain | test-loop | **closed** `2b67a2a2` / merged `fb109401` |

#802 was dropped from an earlier draft of the queue in favour of #796.
Still open and unworked.

## The pattern, five for five: bodies are wrong about their *premises*

Every iteration turned on a false premise that pointed at the **wrong
fix**, not merely a mis-scoped one. This is sharper than the previous
sittings' "bodies are incomplete" tally and worth carrying:

- **#805's own "Suggested fix" would have shipped a broken link.** It
  proposed `/patient/e-consent/${token}`; that page's validator
  `jwt.verify`s and every caller passes a 64-char random hex from a
  *different* token system. It would have swapped a 404 for a 400, and
  no test would have caught it because they all mock `buildConsentLink`
  out. → pack **#469**.
- **#796's "docs say nothing" was wrong.** RF015 AC#3 mandates exactly
  what the dead function pretended to do. The earlier check grepped the
  *field names*; the requirement is Portuguese prose sharing no token
  with the code. → pack **#470**.
- **#808's two premises had both moved** — `importLGPDService` was no
  longer dead, and "delete it as cruft" was actively wrong.
- **#794 item 3 was not one iteration**, for a reason nothing recorded.
- **#722's own suggested option 1 was unsafe** — see below.

**Operating rules this produced:**

1. A "docs are silent" verdict needs a **concept-level search in
   Portuguese**. Docs are Portuguese, code is English; a requirement and
   its implementation routinely share no token.
2. **`grep -r` silently finds nothing in `.claude/skills/`** — the
   entries are junctions and `-r` doesn't follow them. Use `grep -R`.
   Measured: `-r` → 0 hits, `-R` → 4 hits, same pattern. A "not
   documented" that is really "not searched". → pack **#472**.

## Where each open item stands

**#805 — the id half is fixed, the link is still dead.** It now reads
`/patients/00000042/consent?token=…` and lands on `App.tsx:95`, which
points that route at `EConsentPage` — an *alias import of the same
module* as the participant JWT page — behind `ProtectedRoute`, and that
component reads its token from route params this route does not have.

There are **two token systems**: a JWT one (2h TTL, manual, works) and
an opaque-hex one (7-day TTL, bulk, all six `buildConsentLink` callers,
canonical Patient fields, complete backend, **zero frontend callers**).
`/patients/:id/consent?token=` is the *correct* shape for the second
one's contract; the page was never built. **#809** has the write-up —
read it before touching consent, and do not "unify the builders" without
it.

**#794 item 3 — split, prerequisite landed.** Resubmit must re-run the
corrected row through the path that rejected it; anything else is a
second validator, which is exactly the #805/#809 failure one domain
over, and silent there. That path is a ~370-line inline loop
(`import-lgpd.service.js:1078-1445`) → **#817**.

The blocker that made a prerequisite necessary:
`getNextAvailableStorageSlot(db, startBoxId, results.success)` — the
**running success count within the batch** is the storage slot index,
and the batch document persisted none of the import options. The
placement intent ceased to exist when the request ended. Now recorded
(`579775aa`).

Remaining: #817 → the resubmit endpoint, which needs **one design call**
(what slot a resubmitted row takes, given its original position was
never allocated) → the editing UI + a committed e2e spec.

## Filed this sitting

**Project (11):** #809 (bulk consent-token system: complete backend, no
frontend), #810 (template publication aborts its whole notification
sweep on the first patient that throws — everyone after gets no
invitation *and* no `consentToken`, and it still reports success), #811
(RF015 AC#3's remaining legs), #812 (`notification_compliance_logs`
keeps participant emails forever and **no retention policy can be
created for it** — `ALLOWED_ENTITY_TYPES` is `AuditEvent`/`Log`, #667),
**#813** (*the importer operators can reach has no quarantine* —
`/import` posts to the async importer, which discards rejected rows;
RNF011 AC#4 / RF029 AC#6), #814 (LGPD patient paths don't quarantine
either — **do #807 first**, this would widen the plaintext problem to
the most sensitive path), #815 (`downloadTemplate` builds a URL with no
route behind it), #816 (frontend route authorization **fails open** —
`canRoleAccessRoute` ends in `return true`), #817, #818 (`groupFields`
unvalidated from the request body; safe today only because every
consumer remembers to `String()` it — the #802 shape), #819 (first e2e
test to hit a lazy route on a cold dev server fails on Vite's on-demand
compile; looks like a missing UI element and **moves between specs by
run order**).

**Pack (5 + 3 comments):** #468 (a mistyped filename in a targeted
`vitest run` is silently ignored — **check the reported `Test Files`
count against the number you named**; also don't pass `--reporter`, the
two npm roots disagree and the frontend's 4.1.9 *crashes* on
`--reporter=basic`), #469, #470, #471 (`git grep` over `grep -r`), #472
(the junction trap). Comments on #463 (the routing gate is *why* RF015
got found — narrow its fix on what the question is about, not when it is
asked), #414 (the per-slice overlay re-read costs ~11k chars/iteration),
#410 (four more no-prompt remote deletes).

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`fb109401` + this rotation). No open PR; `main` untouched, 99 behind.
- **All five branches this sitting deleted local and remote, no prompt
  any time** — five more data points on pack #410.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Pre-existing branches unchanged: `test/787-lgpd-import-staging`
  (merged; delete only after checking per-commit authorship, precedent
  #332), `fix/599-*` (both merged), `test/377-docs-on-main` and
  `test/human-showcase-video` (not merged), plus the two stale remotes
  left alone deliberately.
- **#752** red is unchanged and pre-existing; not re-checked.

## Docker — read this before the next gate

**Stack: DOWN (0 containers). Volumes: PRESENT AND FULLY BOOTSTRAPPED.**

That combination is the useful part. `docker compose down` was run
**without** `--volumes`, so the four named volumes
(`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data`) survive
carrying this sitting's full bootstrap:

- `admin-bootstrap-test` ran (first admin created).
- **All 17 reference-data chain services ran**, each verified
  `Exited (0)` individually rather than via the compose exit code.
- Mongo now holds **16 active `ReferenceDatasetRelease`s**, including
  HPO with `HP:0000001`.

**So the next gate does NOT need to repay the chain** — bring the 12
core services up and the reference data is already there. Re-run the
chain only if the volumes get dropped. If they are dropped, the full
cold sequence is required and #722's guard will now say so explicitly
instead of failing as a phantom regression.

`backend-app-test`'s image includes every backend merge from this
sitting (built after `c823fa45`). It is now **one merge stale**
(`fb109401`, tests only — no backend code), so a rebuild is not urgent,
but it is build-not-mount: rebuild before trusting it against any later
backend change.

**Cleanup done:** containers down, build cache pruned with `-af`
(**1.052GB** reclaimed, now 0B), `test-results/` removed. **Left
deliberately:** the four named volumes (above), and **30 images /
5.37GB** — removing them forces a full cold rebuild and they are the
expensive half. Worth knowing: `docker_data.vhdx` is **15.57GB physical**
behind ~6.2GB logical, so there is ~9GB of air. Not the extreme case the
hygiene rule reserves a vhdx reset for, but if disk gets tight that is
where it is.

**No deferred proof is outstanding.** Beyond #722's own 58/58, the
stack was used to gate this sitting's other backend changes:
`lgpd-sample-import.spec.ts` **8/8** (covers the `579775aa` quarantine
path) and `tcle-dinamico.spec.ts` **4/4** (covers the #805/#796 consent
path). One cold-start flake was diagnosed rather than dismissed and
became #819.

## Recommended next steps

**None queued — Dennis has not named the next group.** In the order I
would argue for them:

1. **#809** — #805's other half. The highest-value open item: consent
   invitations still land on a page that cannot read their token, and
   #805 stays open until it lands.
2. **#813** — the import path operators actually use still discards
   rejected rows. RNF011 AC#4 is met only on the path that, until this
   sitting, nobody could reach.
3. **#816** — route authorization failing open is cheap to fix and gets
   more expensive to fix the more routes exist.
4. **#807 → #814** — in that order; #814 alone would widen a known
   plaintext-at-rest problem to the most sensitive of the three import
   paths.
5. **#817 → the rest of #794 item 3.**

The `#684 / #800 / #801` object-ownership cluster is still the
highest-severity item overall and still blocked on the RF010/RF021 actor
model — unchanged this sitting.
