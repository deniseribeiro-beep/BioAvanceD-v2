# HANDOFF

**⚠ INTERIM SNAPSHOT — this session is still running.** Written after
iteration 3 of a self-picked 5-item queue. **3 of 5 resolved so far, 2
remain.** This is NOT the definitive rotation for the sitting; if you are
reading it cold, the sitting ended unexpectedly mid-queue.

## The queue

Dennis asked for the next 5 issues and left the pick to me, then said
**"Docker is on"**. Theme: finish the consent-invitation path, make the
LGPD import usable from the UI, and spend the (expensive) cold Docker
sequence on the two items only a live stack can settle.

| # | Issue | Route | State |
|---|---|---|---|
| 1 | **#805** consent link emails `/patients/undefined/consent` | fix-bugs | **half fixed** `2a374ce1` / merged `2f6bcbd3`; **OPEN**, frontend half is #809 |
| 2 | **#796** `persistConsentDeliveryFailure` no-op | fix-bugs | **closed** `1886a3c8` / merged `10f3710f` |
| 3 | **#808** LGPD import has no frontend caller | build-loop | **closed** `f5d8bdd1` / merged `c823fa45` |
| 4 | **#794 item 3** correct-and-resubmit | build-loop | not started |
| 5 | **#722** RF029 tests depend on the bootstrap chain | test-loop | not started |

#802 was dropped from an earlier draft of the queue in favour of #796.
Still open and unworked.

## The theme: issue bodies are wrong about their *premises*, not just their details

All three iterations turned on a false premise that pointed at the
**wrong fix**, not merely a mis-scoped one:

- **#805's "Suggested fix" would have shipped a broken link** —
  `/patient/e-consent/${token}` `jwt.verify`s, and every caller passes a
  random hex from a different token system. → pack **#469**.
- **#796's "docs say nothing" was wrong** — RF015 AC#3 mandates exactly
  what the dead function pretended to do. The earlier check grepped the
  *field names*; the requirement is Portuguese prose sharing no token
  with the code. → pack **#470**.
- **#808's premises had both moved** — `importLGPDService` was no longer
  dead (#794 item 2 uses it), and its "option 3: delete as cruft" was
  actively wrong (it is the client for the *only* compliant importer).

**Operating rule, now proven three times: a "docs are silent" or "this
is dead" conclusion in this repo needs re-deriving from scratch, and the
docs search must be concept-level and in Portuguese.** The docs are
Portuguese, the code is English; a requirement and its implementation
routinely share no token.

## What shipped

**#805 (open).** `buildConsentLink` reads `participantId`, encodes the
id segment, throws rather than emitting `undefined`. Six callers, not
the four the body claimed; three link builders, not two. Settled by the
**consuming contract** (`consent-tokens/{validate,accept}` resolve by
`{ participantId }`), not by docs. Still open: the link lands on
`App.tsx`'s `/patients/:id/consent`, which points at `EConsentPage` — an
alias import of the participant JWT page — behind `ProtectedRoute`.
**#809** has the two-token-system write-up; read it before touching
consent.

**#796 (closed).** Deleted the no-op, which was broken twice (the id
chain early-returned *and* its `$or` query would have matched nothing).
Failure recording moved to `sendEmail`'s compliance log per RF015 AC#3,
covering every notification type. Closed a real gap it had hidden:
`persistComplianceLog` ran only on success, so failures were recorded
nowhere.

**#808 (closed).** `/import/lgpd` — type selection, template download,
upload, result — plus a Sidebar entry (without it, #659's defect). The
load-bearing piece: `stagingBatchId` has come back since #787, #794 item
2 built the page that reads a batch, and **nothing connected them**. A
partial import now renders a button straight to
`/import/quarantine?batchId=<id>`. The UI states two real asymmetries
rather than hiding them (patient imports don't quarantine, #814; no CSV
patient template exists, #815).

## Filed this sitting

**Project:** #809 (bulk consent-token system: complete backend, no
frontend — #805 depends on it), #810 (template publication aborts its
whole notification sweep on the first patient that throws), #811 (RF015
AC#3's remaining legs), #812 (`notification_compliance_logs` keeps
participant emails forever and **no retention policy can be created for
it** — `ALLOWED_ENTITY_TYPES` is `AuditEvent`/`Log` only, #667), **#813**
(*the reachable importer has no quarantine* — `/import` posts to the
async importer, which discards rejected rows; RNF011 AC#4 / RF029 AC#6),
#814 (LGPD patient paths don't quarantine either; **do #807 first**, it
would widen the plaintext problem), #815 (`downloadTemplate` can build a
URL with no route behind it), #816 (frontend route authorization **fails
open** — `canRoleAccessRoute` ends in `return true`).

**Pack:** #468 (a mistyped filename in a targeted `vitest run` is
silently ignored — **check the reported `Test Files` count against the
number you named**; plus: don't pass `--reporter` in this repo, the two
npm roots disagree and the frontend's 4.1.9 *crashes* on
`--reporter=basic`), #469, #470, #471 (`git grep` over `grep -r`).
Counter-case on #463: the routing gate blocking my first
`AskUserQuestion` is *why* RF015 got found. Data point on #410.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`c823fa45`). No open PR; `main` untouched and still 99 behind.
- All three branches this sitting deleted **local and remote**, no
  prompt any time.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Pre-existing branches unchanged: `test/787-lgpd-import-staging`
  (merged; safe to delete after checking per-commit authorship,
  precedent #332), `fix/599-*` (both merged), `test/377-docs-on-main`
  and `test/human-showcase-video` (not merged), plus the two stale
  remotes left alone deliberately.
- **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Engine is UP (28.5.1) and authorised — but nothing has been started.**

- **Services: none running, none stopped.** `docker ps -a` returns zero
  containers.
- **Bootstrap: NONE.** The four named volumes
  (`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data`) are still
  absent — `docker volume ls` shows no `*test*` volumes at all.
- A gate still needs the **full cold sequence**: the 12-service recipe
  with `--build`, then `admin-bootstrap-test`, then the entire
  17-service reference-data chain. The chain is not optional, and
  **#722 is specifically about what happens when it is skipped.**
- **Deliberate sequencing:** the rebuild is held until after the backend
  merges land, because `backend-app-test` is build-not-mount. It was
  four merges stale at the start of this sitting and is now **seven**.
  Rebuild once, late, then run items 4 and 5's gates against it.
- **One deferred proof is now outstanding:** #808's page has unit tests
  and a throwaway browser smoke check (per the overlay's pure-frontend
  bar) but **no committed e2e spec**. That belongs with #794 item 3,
  which exercises the same surface — see below.

## Recommended next steps

**Continue the queue — item 4 (#794 item 3, correct-and-resubmit).** Its
dependency is discharged: #792 retains the source file, and #808 now
gives the operator a way in. Note it needs a backend capability that
does not exist yet (transitioning a staging record out of `ERROR`), so
per the overlay's **#466** rule it takes **both** proof bars — backend
*and* frontend — not a choice between them. Its e2e spec should also
cover #808's page, discharging the deferred proof above.

Then **#722** behind the cold Docker sequence.
