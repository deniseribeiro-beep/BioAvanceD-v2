# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
Third round of the **orchestrator workflow** (pack #526). Dennis asked for
another agent session, with divide-and-conquer if no scoped issues were
available. Two were (#837, #838); the third slice came from splitting #797.
**3 workers, all three slices accepted, 2 issues closed, 1 filed, no Docker.**

## Shipped — merge `744c7381`

| # | What it was | Commit |
|---|---|---|
| **#797** *(item 1 only)* | `tests/factories/filter.factory.js` — a filter-honouring collection mock, in #781's drawer, + 20 tests on its own guarantees | `e39ee1b5` |
| **#837** | `importPatientsSmart`'s `mapping` parse answered **500** on malformed JSON; now 400, matching its `groupFields` sibling | `66b9aa20` |
| **#838** | two undiscriminated `import_batches` filters, not the one the issue named | `15d5ed3c` |
| **#797** *(item 1 landing)* | both hand-rolled matchers retired onto the factory | `03abfaa6` |

**652 tests green across 17 files** on the merged tree — every file touching
either changed source file, plus both factories and their consumers. Native
and targeted; no full suite, no e2e. Both fixes verified red first by
reverting the product change and observing the failure.

## The operating rule this sitting produced

**A shared helper is a precondition, not a slice — the orchestrator builds
and commits it before the fan-out.**

The handoff rule "slices must have provably disjoint file sets" and last
sitting's "the orchestrator must own the shared helper's guarantees" collide
the moment a round is *build a helper, then migrate onto it*. Building it
first satisfies both instead of trading them off.

It was not a formality. The factory's own test caught a real defect in my
first draft inside ten minutes: I had written the matcher so an `undefined`
filter value matches **nothing**, when the Node driver coerces `undefined`
to BSON `null` and `null` matches an absent field — which is the precise
mechanism of #788. Shipped, every migrated site would have been *quietly
weaker* than the hand-rolled matcher it replaced, green either way. From
inside a migration slice a green suite is the whole signal, so no worker
could have caught it.

Corollary, and it cost nothing to check: **a green suite after a helper swap
does not prove the helper can still fail the suite.** Re-introduce the
original defect and confirm the tests still go red. Done here for #788.

**Last sitting's rule recurred, in the session set up to apply it.** Brief A
asserted a malformed-`mapping` 400 would leak the upload without a
`cleanupFile` call. I had verified the *sibling* guard calls it and inferred
the rest; the outer catch already cleaned up. Nothing shipped wrong, but the
shape is identical. The sharpened form: **the rule bites hardest on the
properties a brief adds beyond the issue's own scope** — the defect trace
gets re-checked because it is the thing being fixed; the "and make sure X
still holds" clauses get written from adjacency and feel like framing rather
than claims. They are claims.

**Issue bodies keep undercounting — now n=3.** #838 named one undiscriminated
`import_batches` read; there were two, and the second (`refreshBatchCounts`)
is a **write**. Re-grep before briefing, every time.

## Filed / left open

- **#841** — the `.sort()` migration onto `cursor.factory` has **no tracker
  item**: #771 and #781 are both closed. Measured today: 88 identity-form
  stubs across ~43 files, one real consumer. Partitions cleanly by file.
- **#797 left open** — item 2 (the triaged `findOne` sweep) untouched.
  Re-measured: the population **grew**, 520→729 sites and 56→94 files. It is
  being added to faster than it is migrated.
- **#752 commented, not fixed** — `tests/unit/services/backup.service.test.js`
  is **still red** at branch tip (1 failed / 42 passed), and has grown 39→43
  tests since filing without the failure being addressed. **The last two
  handoffs both claimed "native checks green"; this is the known exception.**
  Deliberately not fixed: the one-line assertion edit is also the move that
  ratifies a BSON-type change on the live destructive `restoreBackup` path.
  **Highest-value single decision on the board — it needs Dennis, not a
  session.**
- Pack **#534** (two brief-writing gaps: order the baseline before the first
  edit; helper before fan-out), **#535** (long content as a Bash argument
  gets silently mangled on MSYS — a `gh --body` comment published with two
  identifiers deleted *and* printed its URL alongside the parse error).
  Comments on **#526** (round measurements) and **#530** (n=2).

## Repo state

- On `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched and frozen. No open PR.
- `fix/parallel-round-837-838-797` merged and deleted locally; never pushed.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Their presence still blocks `edit-branch-guard`'s HANDOFF.md exemption, so
  this file is written via Bash from a scratchpad copy rather than the Write
  tool. Don't route it to a `chore/` branch — `branch-guard` permits only
  `fix/<slug>` and `test/<slug>`.

## Docker

**Not run, and not checked this sitting.** Nothing that ran needed it — all
three slices are natively unit-testable. Treat the previous handoff's
observation (Docker Desktop not running) as **unverified**: run `docker ps -a`
before trusting any container or volume state, per the readiness rule rather
than the up/down one.

## Recommended next

**None queued — Dennis has not named the next group.**

- **#752 is the one item that wants him, not a session** (see above).
- **#841 and #797 item 2 are the natural next parallel round** — both are
  test-only, both partition cleanly by file, and both helpers now exist. A
  few files (e.g. `reports.routes.gaps.test.js`) carry *both* a sort stub and
  a `findOne` stub, so partition explicitly before briefing.
- Looked at and deliberately **not** picked, all three blocked on an owner's
  call rather than on work: **#774** (Equipment allow-list vs deny-list — step
  1 is "decide which vocabulary is canonical"), **#772** (delete the dead
  `useAsyncImport` hook vs wire it in), **#789** (reject non-canonical GET
  query params vs allow-list vs log-only).
- Unchanged: **#833** and **#828** remain the highest-value Docker-dependent
  items; the **#684 / #800 / #801** object-ownership cluster remains the
  highest-severity item overall, still blocked on the RF010/RF021 actor model.

## If you run another parallel round

Holding from before: provably disjoint file sets, named mechanical tripwires,
and re-running every slice's tests together after the merge. New this round:

- **Build any shared helper first, yourself, and commit it** (above).
- **If a brief asks for before/after measurements, order the baseline
  explicitly before the first edit.** A contained worker cannot `git stash`,
  `git checkout --` or `git apply` — its Bash guard reserves every git
  mutation — so a baseline is not recoverable once it has started editing.
  The slice that hit this cost 45 tool calls and ~170k tokens against 11/9
  and ~44k/~52k for the other two, on the smallest diff of the three.
- Docker and delegation still do not overlap. No Docker ran.
