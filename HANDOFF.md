# HANDOFF

**INTERIM — session in progress, not the final word.** Written
2026-08-25 (sixth sitting of the day) after **queue item 2 of 7**.
Dennis asked for a group of issues with **Docker on**, explicitly to
exercise the skills-pack updates that landed at the end of the previous
sitting. Running `issue-loop` **queue mode** over a self-picked,
explicitly-numbered 7-issue queue.

## The queue

Named directly in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` can see it (that hook only recognizes a
closed, explicit list). Classification was done **once up front for the
whole list**, per queue mode's closed-explicit-list rule.

| # | What | Route | State |
|---|---|---|---|
| **775** | `generateUniqueBarcode` ceiling past 999/year | fix-bugs | **closed** |
| **771** | arch guard over `.sort({...})` keys | unit-test-loop | **closed** |
| 772 | `useAsyncImport.ts` dead code | resolve-issue | open |
| 763 | drop inert two-step `find()` workaround | resolve-issue | open |
| 764 | delete dead root `test:browser*` scripts | resolve-issue | open |
| 778 | delete dead consent-sync env declarations | resolve-issue | open |
| 759 | e2e spec for the LGPD sample-import path | e2e-test-loop | open |

#759 is deliberately last so Docker comes up once and rolls straight
into the full gate.

**Deliberately excluded, all still open:** #774 and #753 (each needs
Denise's call), #752 (needs Dennis's behaviour decision, and is the one
red in the native suite).

## Closed this sitting

- **#775** (`bab7abf5` → merged `1ea99f5a`) — the year's highest barcode
  was found with `sort: { barcode: -1 }` on a *string*, so
  `BR-2026-999` outranked `BR-2026-1000` and generation threw
  permanently from the 1002nd sample of a calendar year. Took option 2
  (numeric max in JS); format and existing rows untouched. The
  two-attempt race guard became a bounded 10-attempt loop.
  - **The format question the issue left to the owner was settled by
    docs**: `dict-02` ELM-0116 constrains `barcodeValue` only to a
    unique string. No decision was needed.
  - **A test asserting the numeric max needs a *gap* to discriminate.**
    With only `1000` present the buggy code also returns `1001`, by
    collision-bump luck. With `...999` + `1005`, correct is `1006` and
    the old code returns `1000` — *below* a code that already exists.

- **#771** (`556d3a05` → merged `07eb4f4b`) — new
  `tests/architecture/sort-keys.arch.test.js`. Architecture suite is now
  **70/70** (was 65).
  - **The issue's stated design was not buildable as written.** It asked
    for "each sort key is a field the target model declares", but **only
    14 of the 85 files in `src/models` are mongoose schemas**; the other
    71 are validator classes declaring no field list, and the audit-chain
    and outbox collections have *no model file at all* while sorting on
    real fields. A models-only vocabulary flags every one of those.
  - The invariant used instead is the one the bug class is named for:
    **a query must not order on a field nothing writes** — object-literal
    keys plus `x.field = ...` assignments plus schema paths, **with sort
    specs blanked out of that sweep first** so a spec cannot vouch for
    its own keys.
  - **Proven to have teeth before being trusted:** `registrationDate`
    and `registerDate` are both absent from the vocabulary, so #769
    would have failed here with no mock changes.
  - **The synthetic-source test caught a live defect in the guard on its
    first run** — the key extractor sliced onto the opening `{`, so the
    anchor never matched, zero keys came out, and the main assertion
    passed by seeing nothing. Same shape as #777. **Any future static
    guard here needs its own does-it-still-match test.**
  - Current state: 110 sort specs, 47 distinct keys, **zero offenders** —
    it lands as a regression guard, not a bug sweep.

## Filed this sitting

- **#779** — the #775 fix reads the year's whole barcode set per sample
  creation; `import-lgpd.service.js:1133` calls it **per row**, so a
  5,000-row import pays it 5,000 times. Numeric sequence field or atomic
  counter would make it O(1).
- **#780** — `log.service.js:289` builds its Mongo sort spec from an
  **unvalidated `filters.sortBy` request parameter** on a *paginated*
  query, so #769's failure mode is reachable from outside: an
  unrecognized field returns 200 with the wrong page. Found by
  enumerating the two sites #771's guard cannot follow statically.
- **#781** — #771's option 1 (shared cursor-mock helper). Still worth
  doing: the guard catches a key nothing writes *anywhere*, but not one
  written on a *different* collection than the one queried.
- **Skills-pack #432** — `full-suite-guard` blocks a genuinely targeted
  one-file vitest run when the downstream pipe is
  `grep -B5 -A 20 "FAIL\|Unhandled\|Error"`; identical run with
  `| tail -3` is allowed. Deterministic, reproduced twice.
- **Skills-pack #433** (+ a follow-up comment with two more shapes) —
  backslash stripping is **not** confined to `node -e`. A quoted heredoc
  wrote `\d` where the source needed `\\d`; in a JS template literal
  that collapses to a literal `d`, giving a regex that compiles and
  matches **nothing**. Also hit: a bash `grep` pattern (`Trailing
  backslash`) and a large heredoc failing outright with `unexpected
  EOF`.
  - **Working rule, held up three times today: do not push escapes
    through the Bash layer at all.** Use the `Grep` tool for patterns
    and `Write`/`Edit` for file content of any size. Use `[0-9]` rather
    than `\d` when a regex must be written inline.

## Repo state

- On `feature/docker-e2e-backend-integration` at `07eb4f4b`, pushed, in
  sync. Both fix/test branches deleted local **and remote** (remote
  deletes succeeded with no prompt, twice — data points for pack #410).
- **Docker has not been started yet this sitting.** The four named
  volumes still hold the *previous* sitting's e2e fixture data, so a
  genuinely from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first.
- Native: architecture suite **70/70**. The known **#752 red is
  unchanged and pre-existing**; not re-checked this sitting.
- Four older local branches and two stale remote branches unchanged —
  see the previous handoff's reasoning (verify merge status *and*
  per-commit authorship before deleting the remotes; precedent #332).
- Two untracked paths still deliberately untouched: `.claude/skills/`
  and `api/backend/storage/assays/`. **Never `git add -A`.**

## Recommended next steps

**Continue the queue at #772** — the session is not over. If this
sitting is picked up cold, the five open queue members above are the
work, in that order, with the Docker gate after #759.
