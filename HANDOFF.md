# HANDOFF

**Written 2026-09-01, after a 10-issue queue sitting.** Dennis asked for
"the next 10 issues, docker is still on". **7 closed (6 queue members plus #944, filed and
worked here), 3 queue members left open with a shipped slice each, 6 new
issues filed, 10 commits pushed, full native gate green.**

**INTERIM — the session was not declared over by the user.** It may
continue; do not read this as a completed sitting. Re-derive every count
rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, **pushed, clean and
  matching origin**. `main` untouched, no PR.
- Last substantive commit: `720368c8` (#921 finding 2).
- No new dependencies. One new env var: `ALLOW_UNENCRYPTED_FILE_STORAGE`
  (#938; unset = encryption required).

## Verification state — full NATIVE gate, green [ran it]

| Gate | Result |
|---|---|
| backend `tests/unit tests/integration tests/compliance` | **8263 passed / 455 files / 0 failed** |
| frontend (27 files) | **230 passed** |
| `test:architecture` | **110 / 110** |
| `npm run typecheck` (frontend core + backend lint 463 files + e2e) | **clean** |
| **e2e** | **NOT RUN** — see Docker below |

Was 8225/451, 227, 106 last sitting: **+38 backend tests, +4 files, +3
frontend, +4 architecture**.

## Docker state

**No containers, no stack, no bioavanced images.** Nothing was brought up.

Two throwaway `mongo:7` containers were run and torn down (`--rm`,
confirmed gone) to verify index and counter semantics — see #936/#779.
That is *not* the Docker gate: no image built, no compose file read, no
application started, no volume left.

**So the e2e gate still needs a full image rebuild AND the full bootstrap
chain** — budget ~4 min build on top of bring-up. `docker-workflow`'s
bioavanced overlay has the recipe; the previous handoff confirmed the
17-service chain (`foundation-bootstrap-test` + 16
`reference-data-bootstrap-*`) and it is unchanged.

**Two things want that gate, neither blocking:**

- **#938** — the RF007 e2e spec (`f1975718`) uploads a real file.
  `compose.test.yml:26` sets `ENCRYPTION_KEY`, so it should be unaffected
  by the new fail-closed gate. **[not established]** — not run.
- **#936/#779** — `samples_barcode_unique_v1` is created on first
  `getCollection(db, 'samples')`. First real stack bring-up is the first
  time it is built against seeded data.

## What closed (7)

`#915 #892 #917 #931 #779 #938` from the queue, plus `#944` — filed by this
sitting and worked in it. Read each close comment for evidence.

## Left open with a shipped slice (3, plus #682) — the judgment a query cannot carry

Query the board (`gh issue list --state open`, 74 open). What it will not
tell you:

- **#936 — item 1 shipped, item 2 assessed and deliberately not changed.**
  `samples.barcode` now has a real partial unique index. Item 2 (the RF004
  guard running before generation) is argued *against* changing on the
  issue: post-#932 the retry queries the right collection, and the new
  index makes an escape loud. That argument is an **inference** from the
  repo's narrow-change preference — no doc speaks to guard ordering — so
  it is cheap to overturn.
- **#849 — one slice shipped, and its body is now materially stale.**
  Comments were polluting the guard's written-field vocabulary (196 keys,
  6.7%); fixed. **Its three listed "options" are two-thirds already
  built** — `$or` recursion shipped under #854, Band A of the pre-built
  variable gap shipped too. What remains is Band B plus a *new* finding:
  the vocabulary counts every object literal in `src/`, persisted or not,
  which is now the largest false-negative source. Labelled
  `premise-corrected`.
- **#921 — finding 2 shipped, finding 1 untouched, and the count is
  wrong.** `tests/architecture/rbac-actions.arch.test.js` derives the
  #630 audit for real; zero violations across the population. **[ran it]
  That population is 190 call sites, not the body's 53** (45 in
  `src/routes`, 145 in `src/interface/routes`). The per-file table is
  right; the denominator is not, and finding 1's "~40 of 53" framing
  rests on it.
- **#682** — gained a third checklist item from #938.

## Filed this sitting (6) — one closed, five open

`#939` (ASYNC_BATCH_IMPORT batches unreadable — the third writer to
`import_batches`), `#940` (frontend still treats `sensorID` as canonical;
types *require* a field the backend never wrote), **`#941` (largest:
`autoIndex: false` + no `syncIndexes` anywhere means every
`Schema.index()` in `src/models/` is decorative — nine unique constraints
unenforced)**, `#942` (import duplicate detection never compares within
the submitted file), `#943` (`canonical.v1.file` has no production
caller), and `#944` — **closed here**: the barcode guard cited RF004, whose criteria
never mention barcodes; corrected at all three sites to dict-02 ELM-0116.

**The other five are open because I chose to stop on them, not because
anything blocks them.**

**#941 is the one to read first.** It was found while fixing #936 and it
invalidates any assumption that a declared index exists.

## Conventions this sitting relied on / established

- **An issue that calls its own remedy "the owner's call" is usually a
  lookup that was not run.** Five of ten queue members said so; four were
  answered by a citation — RNF029 AC#5 for #938, dict-02 ELM-0116 for
  #779, ELM-0317's *default column* for #681, and the repo's own error
  table for #892. The default column is the sharp one: doing what #681
  literally asked (1..1 → required) would have shipped a contract
  rejecting payloads the dictionary permits.
- **`api/backend/docs/` is authoritative and is in no skill's docs list.**
  `STORAGE_API_EXAMPLES.js`'s `CÓDIGOS DE ERRO` table settled #892 after
  it had been parked four days as a repo-wide design call. Filed as pack
  #647.
- **The two-hop consumer sweep paid twice more.** #779's counter broke 25
  tests across two files no brief would have named — and both doubles
  encoded the defect: one returned the pre-v5 `{ value: doc }` driver
  shape (the thing #294 fixed in product code), the other a fixed
  `{ seq: 1 }` that cannot advance.
- **A throwaway `docker run --rm mongo:7` is not the Docker gate**, and it
  answered two questions no mock could: `sparse`/`$exists` both break on
  an explicit `null`, and the counter seeds and increments as designed.
  ~20 seconds each. Filed as pack #652 (the ladder jumps from "one
  targeted test" straight to a full image build).
- **`gh issue create --body "..."` with an unescaped backtick silently
  corrupts the body** — it does *not* error. #943 was created with an
  identifier command-substituted out, caught only by grepping the result.
  Use `Write` + `--body-file`, always. Recurrence reported on pack #572.
- **`git check-ignore` was run 0 times across ~35 product edits** in 10
  routed iterations. Tallied on pack #648.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

If the session continues, the two strongest candidates are **#941** (the
inert-index finding, which touches nine unique constraints and is cheapest
before any deployment exists) and **#921 finding 1**, now that its
population is measured at 190 — its own three `[not established]` items
still gate an honest build, and item 3 (the false-positive rate of the
"test contains route path AND role literal" heuristic) is the one to
measure first.
