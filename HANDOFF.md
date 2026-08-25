# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (seventh sitting of the day), after queue item 4
of 5. Dennis asked for the next group of issues and confirmed **Docker
is on**. **1 of 5 queue items remains** (#787, plus the Docker gate) and
the session is still going. Do not read this as the sitting's final word.

## The queue

Self-picked, explicitly numbered in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` can see it. Theme: **accepted-but-
unenforced request parameters, and partial failures that report as
success**, on the LGPD import and sample/log query paths.

| # | What | Route | Status |
|---|---|---|---|
| **785** | samples list `patientID` filter never applied | fix-bugs | **closed** `9c3074bf` |
| **786** | `results.total` under-counts a partial import | fix-bugs | **closed** `c42fc8de` |
| **780** | `log.service.js` unvalidated `sortBy` sort spec | fix-bugs | **closed** `de5e2ab7` |
| **782** | intake wizard 200 when every clinical entity failed | fix-bugs | **closed** `d653d7e3` |
| **787** | RNF011 AC#4 staging/quarantine for the LGPD import | build-loop | **next** |

Each closed issue has a full write-up on its own thread. Not duplicated
here.

**A pattern that held in all four:** the issue body's suggested fix or
factual claim was wrong or incomplete in some respect, and re-running the
trace instead of trusting it is what caught the problem every time.

- **#785** proposed re-admitting a field the create path 422s.
- **#786** pointed at the wrong sibling importer to copy, and its
  under-count turned out to be specific to the `continue` paths (a row
  that *threw* was already counted).
- **#780**'s suggested allow-list named `level`, a field no log document
  has (it is `severity`).
- **#782** described four entities with catches; there are **ten**.

**Assume #787's body needs the same treatment.**

**Deliberately excluded, all still open:** #779, #772, #774, #752, #761,
#751, #753 — each blocked on a decision or explicitly deferred by its own
body.

**Flagged to Dennis, not queued:** **#684** — highest-severity item on
the board; any authenticated user can revoke any patient's consent by
enumerating a Mongo `_id`. Left out because the fix depends on
RF010/RF021's intended actor model, a product call. Dennis was offered
the swap and has not taken it.

## Pending deferred proof — read before the gate

`tests/e2e/lgpd-sample-import.spec.ts` carries **three** un-weakened
assertions that have never executed (they only run against Docker). All
three previously asserted the wrong values on purpose so the spec would
not go red when the fixes landed:

1. **#785** — the samples list queried through the real `?participantId=`
   filter, asserting every returned row belongs to that participant.
2. **#786** — a wholly-rejected one-row file reports
   `{ total: 1, success: 0, errors: 1 }`.
3. **#786** — a mixed two-row file reports
   `{ total: 2, success: 1, errors: 1 }`.

**#785 and #786 were closed on their native proofs. If the gate comes
back red on this spec, reopen the corresponding issue.** #780 and #782
have no deferred component.

## Filed this sitting

**Product:** **#788** (`GET /api/samples` computes every sample's consent
badge from `sample.patientID`, a field no writer sets — third instance of
the #533/#785 class in one handler; **static trace only, the live check
is a gate task**), **#789** (GET silently ignores non-canonical query
params while POST 422s them — now covering three endpoints and three
different answers, after #780 added an "echo the effective value back"
option), **#790** (`importSamples` has no empty-row guard while
`importPatients` has two), **#791** (nothing in `frontend/src` reads
#782's new `clinicalEntities` outcome, so the operator still sees an
unqualified success).

**Pack:** **#440**, **#441**, **#442**, plus data-point comments on
**#433** (heredoc failures are about payload *size*, not only escaping)
and **#434** (`routing-gate.cjs` re-armed by tracker reads in a
*different repository*).

## Repo state

- On `feature/docker-e2e-backend-integration` at `d653d7e3` + this
  rotation, pushed, in sync. **No `fix/` branches from this sitting
  remain**, local or remote — all four remote deletions succeeded with no
  prompt (four more data points for pack #410).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Older local branches unchanged: `fix/599-ci-trigger-integration-branch`
  and `fix/599-hold-ci-trigger-for-milestone` are merged (safe to
  delete); `test/377-docs-on-main` and `test/human-showcase-video` are
  not merged.
- Two stale *remote* branches left alone deliberately (they predate this
  session, so `clean-up`'s scope rule excludes them):
  `origin/fix/705-seed-active-terminology-concept-cleanup` and
  `origin/test/377-docs-on-main`. **Verify merge status *and* per-commit
  authorship before deleting** (precedent #332).
- **Native suites:** architecture **70/70**. The known **#752** red is
  unchanged and pre-existing; not re-checked this sitting.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker

**On, authorized by Dennis for this sitting. Nothing started yet.**

The four named volumes still hold the previous sitting's e2e fixture
data. A genuinely from-scratch gate needs `docker volume rm` on
`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first.

- **The gate recipe in `docker-workflow`'s overlay is accurate as
  written** — 12 core services with `--build` (`api/backend/src` has been
  touched four times this sitting), then `admin-bootstrap-test`, then the
  17-service reference-data chain. Fourth sitting running it.
- Host Playwright command: see the sixth sitting's rotation in git
  history for the verbatim env line.
- **Stop `playwright-runner` before any host-side run**, and **one
  workload at a time against one stack, whoever starts it** (pack #437).
- `TaskStop` on a backgrounded `docker compose` reports success while
  `docker ps` still shows the container `Up`.

## Working rules holding this sitting

- **Route file content through `Write`, not Bash heredocs, above roughly
  100 lines.** Three failures this sitting, all `unexpected EOF while
  looking for matching quote`, all on large payloads; every short heredoc
  (issue bodies, commit messages) worked. It presents as an escaping bug
  but is a truncation — don't debug the content, change the tool
  (pack #433).
- **Never chain gated steps in one compound command.** Two losses this
  sitting, including a `cat > body.md <<EOF ... && gh issue create` that
  died to a hook and took the heredoc with it, so the retry failed on a
  file that had never been written.
- **Budget for two re-invocations per iteration:** `routing-gate.cjs`
  re-arms between the fix and the close (a fresh `fix-bugs` Skill call
  every time — all four closes needed one), and
  `push-wrapup-checkpoint` fires again at the close after the audit
  already ran (pack #442).

## Recommended next steps

**Finish the queue — #787 is the last item**, routed to `build-loop`.
Mirror the existing `fhir-import-staging.service.js` precedent rather
than inventing a staging shape; the FHIR path already satisfies the same
RNF011 AC#4, which is what makes this a one-path-has-it-and-the-other-
doesn't gap rather than an unimplemented requirement.

Then the Docker gate, which must cover: the **three** un-weakened
`lgpd-sample-import.spec.ts` assertions above, #787's new real-backend
test, and a live check of **#788**'s prediction that every
`GET /api/samples` row comes back `PATIENT_NOT_FOUND`.
