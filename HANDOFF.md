# HANDOFF

**INTERIM — session in progress, not the final word.** Written
2026-08-25 (sixth sitting of the day) after **queue item 5 of 7**.
Dennis asked for a group of issues with **Docker on**, explicitly to
exercise the skills-pack updates that landed at the end of the previous
sitting. Running `issue-loop` **queue mode** over a self-picked,
explicitly-numbered 7-issue queue.

## The queue

Named directly in the `issue-loop` invocation's args so
`queue-continue-checkpoint.cjs` can see it. Classification was done
**once up front for the whole list**, per queue mode's closed-explicit-
list rule.

| # | What | Route | State |
|---|---|---|---|
| **775** | `generateUniqueBarcode` ceiling past 999/year | fix-bugs | **closed** |
| **771** | arch guard over `.sort({...})` keys | unit-test-loop | **closed** |
| 772 | `useAsyncImport.ts` dead code | resolve-issue | **open — owner's call** |
| **763** | drop inert two-step `find()` workaround | resolve-issue | **closed** |
| **764** | delete dead root `test:browser*` scripts | resolve-issue | **closed** |
| 778 | delete dead consent-sync env declarations | resolve-issue | open |
| 759 | e2e spec for the LGPD sample-import path | e2e-test-loop | open |

#759 is deliberately last so Docker comes up once and rolls straight
into the full gate.

**Excluded from the queue, all still open:** #774, #753 (each needs
Denise's call), #752 (needs Dennis's behaviour decision, and is the one
red in the native suite).

## Closed this sitting

- **#775** (`bab7abf5` → `1ea99f5a`) — the year's highest barcode was
  found with `sort: { barcode: -1 }` on a *string*, so `BR-2026-999`
  outranked `BR-2026-1000` and generation threw permanently from the
  1002nd sample of a year. Option 2 (numeric max in JS); format and
  existing rows untouched. **The format question the issue left to the
  owner was settled by docs** — `dict-02` ELM-0116 constrains
  `barcodeValue` only to a unique string.
  - **A test asserting the numeric max needs a *gap* to discriminate.**
    With only `1000` present the buggy code also returns `1001`, by
    collision-bump luck.

- **#771** (`556d3a05` → `07eb4f4b`) — new
  `tests/architecture/sort-keys.arch.test.js`; architecture suite
  **70/70** (was 65).
  - **The issue's stated design was not buildable as written** — it asked
    for "a field the target model declares", but only **14 of 85** files
    in `src/models` are mongoose schemas, and the audit-chain and outbox
    collections have no model file at all while sorting on real fields.
    The invariant used instead: **a query must not order on a field
    nothing writes**, with sort specs blanked out of the write sweep so
    a spec cannot vouch for its own keys.
  - **Proven before being trusted:** `registrationDate`/`registerDate`
    are absent from the vocabulary, so #769 would have failed here.
  - **Its synthetic-source test caught a live defect in the guard on the
    first run** (key extractor sliced onto the opening brace → zero keys
    → vacuously green). **Any future static guard needs its own
    does-it-still-match test.**

- **#763** (`0ce355aa` → `8e86e99c`) — the four two-step `find()` sites
  rewritten to the chained form.
  - **The issue's premise was wrong: the workaround was not inert.** A
    *second* fake still had the pre-#694 `async find()` shape
    (`intakeWizard.clinicalEntities.test.js:95`). The chained form broke
    it, and `recordClinicalEntities`' per-entity try/catch swallowed the
    throw — the intake returned **200 with no Condition recorded**, and
    the test failed as `expected [] to have a length of 1`, not as an
    error. That fake now matches the driver; a tree-wide sweep confirms
    **no other `async find()` stub remains**.

- **#764** (`e0815beb` → `4cfb73c1`) — the three dead root
  `test:browser*` scripts deleted. All three of the body's conditions
  re-verified first: no root `vitest` devDependency, no root
  `vitest.config.*`/`vite.config.*`, no root-level test files. Wiring
  them would have meant inventing a capability, not restoring one.
  - **Knock-on:** `bioavanced-v2-conventions` documents these scripts as
    existing-but-dead. That text is now stale; filed as pack **#435**
    (cannot be edited from this repo — Rule 0).

## Open, with a decision owed

- **#772** — re-traced from scratch; **two of the body's factual claims
  are wrong**. The `useImportJob.ts:286` comment is *accurate* (line 3
  of `useAsyncImport` imports it), and `useImportJob` is not "the hook
  actually wired up" — **nothing imports either; they are dead as a
  pair**. The live import UI is `components/v2/ImportForm.jsx`
  (`App.tsx:129`) via `uploadBatch()` → `POST /import/batch` +
  `BatchProgressViewer` polling `GET /import/status/:jobId`. So this is
  a **superseded parallel implementation**, not unfinished wiring.
  - The narrowed question for Denise: **should the import screen
    validate a file before uploading it?** `useAsyncImport` posts to
    `/import/validate`, a step `ImportForm` does not perform. Either way
    both hooks go; what differs is whether a validation step gets built
    into the live form first.
  - #700 (`HPOAutocomplete.jsx`) may have the same resolution — worth
    checking before treating it as an independent call.

## Filed this sitting

- **#779** — the #775 fix reads the year's whole barcode set per sample
  creation, and `import-lgpd.service.js:1133` calls it **per row**.
- **#780** — `log.service.js:289` builds its sort spec from an
  **unvalidated `filters.sortBy` request parameter** on a *paginated*
  query: #769's failure mode reachable from outside, returning 200 with
  the wrong page.
- **#781** — #771's option 1 (shared cursor-mock helper); the guard
  cannot catch a key written on a *different* collection than queried.
- **#782** — the intake wizard returns **200 even when every clinical
  entity failed to record**; only signal is a server-side log line.
- **#783** — four *more* root devDependencies with no reference anywhere
  in the repo, found by checking whether #764's `vitest` was the only
  one: `vite-plugin-istanbul`, `@istanbuljs/nyc-config-babel` and `nyc`
  (residue of an abandoned e2e coverage-instrumentation setup), plus
  root copies of `@vitejs/plugin-react` and `supertest` the sub-packages
  already declare. Candidate list, not a verdict — a text grep cannot
  see a dotfile config or a binary invoked by name.
- **Skills-pack #432** — `full-suite-guard` blocks a genuinely targeted
  one-file vitest run when the downstream pipe is
  `grep -B5 -A 20 "FAIL\|Unhandled\|Error"`. Deterministic, twice.
- **Skills-pack #433** (+ follow-up comment) — backslash stripping is
  **not** confined to `node -e`. A quoted heredoc wrote `\d` where the
  source needed `\\d`; in a JS template literal that collapses to a
  literal `d` — a regex that compiles and matches **nothing**. Also hit
  as a bash `grep` `Trailing backslash`, and a large heredoc dying with
  `unexpected EOF`.
  - **Working rule, held up all sitting: do not push escapes through the
    Bash layer at all.** `Grep` tool for patterns, `Write`/`Edit` for
    file content, `[0-9]` instead of `\d`.
- **Skills-pack #434** — `resolve-issue`'s *mandated* pre-close
  `gh issue view <N> --json state` **re-arms `routing-gate.cjs`**, which
  then blocks the close and demands a redundant re-invocation of the
  same skill for the same issue. Structural: every correctly-followed
  close hits it.
- **Skills-pack #435** — the stale `bioavanced-v2-conventions` bullet
  above, with suggested replacement text.
- **Skills-pack #426 comment** — second confirmation, different shape: a
  body's claimed *absence* ("nothing imports X") was wrong twice in #772.

## Repo state

- On `feature/docker-e2e-backend-integration` at `4cfb73c1` + this
  rotation, pushed, in sync. All four fix/test branches deleted local
  **and remote** (remote deletes succeeded with no prompt, four for
  four — data points for pack #410).
- **Docker has not been started yet this sitting.** The four named
  volumes still hold the *previous* sitting's e2e fixture data, so a
  genuinely from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first.
- Native: architecture suite **70/70**. The known **#752 red is
  unchanged and pre-existing**; not re-checked this sitting.
- Four older local branches and two stale remote branches unchanged —
  verify merge status *and* per-commit authorship before deleting the
  remotes (precedent #332).
- Two untracked paths still deliberately untouched: `.claude/skills/`
  and `api/backend/storage/assays/`. **Never `git add -A`.**

## Recommended next steps

**Continue the queue at #778** — the session is not over. If picked up
cold: #778, then #759 with the Docker gate after it. #772 needs Denise,
not more tracing.
