# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (seventh sitting of the day), after queue item 3
of 5. Dennis asked for the next group of issues and confirmed **Docker
is on**. **2 of 5 queue items remain** and the session is still going.
Do not read this as the sitting's final word.

## The queue

Self-picked, explicitly numbered in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` can see it. Classification ran once up
front for the whole list, per queue mode's closed-explicit-list rule.

Theme: **accepted-but-unenforced request parameters, and partial failures
that report as success**, on the LGPD import and sample/log query paths.

| # | What | Route | Status |
|---|---|---|---|
| **785** | samples list `patientID` filter never applied | fix-bugs | **closed** `9c3074bf` |
| **786** | `results.total` under-counts a partial import | fix-bugs | **closed** `c42fc8de` |
| **780** | `log.service.js` unvalidated `sortBy` sort spec | fix-bugs | **closed** `de5e2ab7` |
| **782** | intake wizard 200 when every clinical entity failed | fix-bugs | **next** |
| **787** | RNF011 AC#4 staging/quarantine for the LGPD import | build-loop | pending |

Each closed issue carries a full write-up on its own thread (root cause,
what changed, what was verified, and every deviation from the issue's own
suggested fix). Not duplicated here.

**One pattern worth carrying:** in **all three** closed items the issue
body's suggested fix or field list was wrong in some respect, and
re-running the trace rather than trusting the body is what caught it —
#785 proposed re-admitting a field the create path 422s, #786 pointed at
the wrong sibling importer to copy, #780's suggested allow-list named a
field (`level`) no log document has. Re-verify before implementing.

**Deliberately excluded, all still open:** #779, #772, #774, #752, #761,
#751, #753 (each blocked on a decision or explicitly deferred by its own
body).

**Flagged to Dennis, not queued:** **#684** — highest-severity item on
the board; any authenticated user can revoke any patient's consent by
enumerating a Mongo `_id`, and `authConsent.js` then blocks that
participant's data. Left out because the fix depends on RF010/RF021's
intended actor model, a product call. A docs check might settle it the
way #772's did. Dennis was offered the swap and has not taken it.

## Pending deferred proof — read before the gate

`tests/e2e/lgpd-sample-import.spec.ts` carries **three** un-weakened
assertions that have never executed, because they only run against the
Docker stack. All three previously asserted the *wrong* values on purpose
so the spec would not go red when the fixes landed:

1. **#785** — the samples list queried through the real `?participantId=`
   filter, asserting every returned row belongs to that participant.
2. **#786** — a wholly-rejected one-row file reports
   `{ total: 1, success: 0, errors: 1 }`.
3. **#786** — a mixed two-row file reports
   `{ total: 2, success: 1, errors: 1 }`.

**#785 and #786 were closed on their native proofs. If the gate comes
back red on this spec, reopen the corresponding issue.** #780 has no
deferred component — its proof is entirely native.

## Filed this sitting

**Product:** **#788** (`GET /api/samples` computes every sample's consent
badge from `sample.patientID`, a field no writer sets — third instance of
the #533/#785 class in one handler; **static trace only, the live check
is a gate task**), **#789** (the mechanism behind #533/#785: GET silently
ignores non-canonical query params while POST 422s them — now extended
with #780's logs endpoint as a third instance and a third possible
answer), **#790** (`importSamples` has no empty-row guard while
`importPatients` has two, so a trailing blank row becomes a spurious
rejection).

**Pack:** **#440** (un-weaken-pinned-tests vs. native-only verification
don't compose for e2e specs), **#441** (branch guard parses the `2` in
`2>&1` as a push target), **#442** (`push-wrapup-checkpoint` fires twice
per iteration), plus a data-point comment on **#434** (`routing-gate.cjs`
re-armed by tracker reads in a *different repository*).

## Repo state

- On `feature/docker-e2e-backend-integration` at `de5e2ab7` + this
  rotation, pushed, in sync. **No `fix/` branches from this sitting
  remain**, local or remote — all three remote deletions succeeded with
  no prompt (three more data points for pack #410).
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
  touched three times this sitting), then `admin-bootstrap-test`, then
  the 17-service reference-data chain. Fourth sitting running it.
- Host Playwright command: see the sixth sitting's rotation in git
  history for the verbatim env line.
- **Stop `playwright-runner` before any host-side run**, and **one
  workload at a time against one stack, whoever starts it** (pack #437).
- `TaskStop` on a backgrounded `docker compose` reports success while
  `docker ps` still shows the container `Up`.

## Working rules holding this sitting

- **Do not push escapes through the Bash layer.** A large heredoc for
  this file died with `unexpected EOF while looking for matching quote`;
  it is written with the `Write` tool instead. Short heredocs for issue
  bodies have been fine.
- **Never chain gated steps in one compound command.** Hit twice — a
  `cat > body.md <<EOF ... && gh issue create` died to the
  missing-`--label` hook, taking the heredoc with it; a
  `git add && git commit && git push -q 2>&1 | tail` died to pack #441
  with nothing committed.
- **Budget for two re-invocations per iteration:** `routing-gate.cjs`
  re-arms between the fix and the close (a fresh `fix-bugs` Skill call is
  needed every time), and `push-wrapup-checkpoint` fires again at the
  close after the audit already ran (pack #442).

## Recommended next steps

**Continue the queue — #782 is next**, then #787.

Then the Docker gate, which must cover: the **three** un-weakened
`lgpd-sample-import.spec.ts` assertions above, #787's new real-backend
test, and a live check of **#788**'s prediction that every
`GET /api/samples` row comes back `PATIENT_NOT_FOUND`.
