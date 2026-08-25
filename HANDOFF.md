# HANDOFF

**INTERIM — session in progress, not the final word.** Written
2026-08-25 (sixth sitting of the day) after **queue item 1 of 7**.
Dennis asked for a group of issues with **Docker on**, explicitly to
exercise the skills-pack updates that landed at the end of the previous
sitting. Running `issue-loop` **queue mode** over a self-picked,
explicitly-numbered 7-issue queue.

## The queue

Named directly in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` can actually see it (that hook only
recognizes a closed, explicit list):

| # | What | Route | State |
|---|---|---|---|
| **775** | `generateUniqueBarcode` ceiling past 999/year | fix-bugs | **closed** |
| 771 | arch test over `.sort({...})` literals | unit-test-loop | open |
| 772 | `useAsyncImport.ts` dead code | resolve-issue | open |
| 763 | drop inert two-step `find()` workaround | resolve-issue | open |
| 764 | delete dead root `test:browser*` scripts | resolve-issue | open |
| 778 | delete dead consent-sync env declarations | resolve-issue | open |
| 759 | e2e spec for the LGPD sample-import path | e2e-test-loop | open |

Classification was done **once up front for the whole list**, per queue
mode's closed-explicit-list rule. #759 is deliberately last so Docker
comes up once and rolls straight into the full gate.

**Deliberately excluded, all still open:** #774 and #753 (each needs
Denise's call on which vocabulary / where a sweep lives), #752 (needs
Dennis's behaviour decision, and is the one red in the native suite).

## Closed this sitting

- **#775** (`bab7abf5` → merged `1ea99f5a`) — `generateUniqueBarcode`
  found the year's maximum with `sort: { barcode: -1 }` on a *string*,
  so `BR-2026-999` outranked `BR-2026-1000` and generation threw
  permanently from the 1002nd sample of a calendar year. Took the
  issue's option 2 (numeric max in JS), which preserves the
  `BR-YYYY-NNN` format and needs no migration. The two-attempt race
  guard became a bounded 10-attempt loop.
  - **The format question the issue left to the owner was settled by
    docs, not by a decision**: `dict-02` ELM-0116 constrains
    `barcodeValue` only to a unique string ("GS1/DataMatrix/Code128
    conforme política"). No fixed shape is mandated.
  - **None of the pre-existing mocks could see this bug** — each
    answered the year's highest-barcode lookup with whatever the test
    handed back, discarding the ordering. That is #771's class exactly,
    which is the next queue item. The new tests use a fake that orders
    the way the driver does (binary string sort).
  - **A test asserting the numeric max needs a *gap* to discriminate.**
    With only `1000` present, the buggy code also returns `1001`, by
    collision-bump luck. With `...999` + `1005`, correct is `1006` and
    the old code returns `1000` — a code *below* one that exists.

## Filed this sitting

- **#779** (product) — the fix reads the year's whole barcode set per
  sample creation: index-usable prefix scan, but O(codes this year), and
  `import-lgpd.service.js:1133` calls it **per row**, so a 5,000-row
  import pays it 5,000 times. Options are a numeric sequence field or an
  atomic counter (the latter also removes the race the retry loop
  absorbs). Not urgent; split out so it does not live only on a closed
  thread.
- **Skills-pack #432** — `full-suite-guard` blocks a *genuinely
  targeted* one-file vitest run when the downstream pipe is
  `grep -B5 -A 20 "FAIL\|Unhandled\|Error"`. Identical run with
  `| tail -3` is allowed. **Deterministic, reproduced twice.** The block
  message is the full-suite lecture, which misdirects: the vitest half
  is already minimal, the grep is what has to change.
- **Skills-pack #433** — backslash stripping is **not** confined to
  `node -e` (pack #419). A quoted heredoc (`cat > f <<'EOF'`) wrote
  `\d` where the source needed `\d`; inside a JS template literal that
  collapses to a literal `d`, producing a regex that compiles, throws
  nothing, and **matches nothing**. Under auto mode heredocs are the
  primary edit path, so the blast radius is a whole session's edits.
  **Workaround that worked: avoid the backslash entirely — `[0-9]` for
  `\d`** (valid in both JS `RegExp` and Mongo `$regex`), or write via a
  `python - <<'PY'` string replace.

## Repo state

- On `feature/docker-e2e-backend-integration` at `1ea99f5a`, pushed, in
  sync. `fix/775-barcode-sequence-ceiling` deleted local **and remote**
  (remote delete succeeded with no prompt — another data point for pack
  #410's tally).
- **Docker has not been started yet this sitting.** The four named
  volumes still hold the *previous* sitting's e2e fixture data, so a
  genuinely from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first.
- Native suites: **the known #752 red is unchanged and pre-existing**
  (`backup.service.test.js`'s legacy-JSON restore assertion). Not
  re-checked this sitting; last sitting confirmed it against a stashed
  tree.
- Four older local branches and two stale remote branches unchanged —
  see the previous handoff's reasoning (authorship check required before
  deleting the remotes; precedent #332).
- Two untracked paths still deliberately untouched: `.claude/skills/`
  and `api/backend/storage/assays/`. **Never `git add -A`.**

## Recommended next steps

**Continue the queue at #771** — the session is not over. If this
sitting is picked up cold, the six open queue members above are the
work, in that order, with the Docker gate after #759.
