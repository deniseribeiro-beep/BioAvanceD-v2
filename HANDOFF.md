# HANDOFF

**Written 2026-08-29, end of sitting.** Everything below is verified as of
writing; re-derive counts rather than trusting them.

A delegating sitting on the e2e/Docker-gate cluster. Five recon/worker
agents. **The Docker gate ran, and it earned its keep by falsifying two
things that had passed every static check.** 7 commits pushed, 1 issue
closed, 7 product issues + 4 pack issues filed.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, in sync, tree
  clean. `main` untouched, no PR.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
- **Never `git add -A`.**
- **Docker stack is DOWN** -- torn down at session end with `docker
  compose down` (no `-v`), Dennis's call. **The 11 named volumes are kept
  and carry the full seed** (admin bootstrap + all 17 reference-data
  services), so the next gate skips the bootstrap chain: bring the stack
  up and run, no reseed needed. Verify with `docker ps -a` before trusting
  that -- a plain `docker ps` cannot see the one-shot bootstrap containers
  that prove a stack is usable rather than merely up.
- 30 images (4.05GB) kept deliberately, for the same reason. Build cache
  pruned with `-af` (1.23GB, vs the 18.19MB `docker system df` reported).
- Nothing was lost in the WSL/Docker cleanup [ran it].

## Verification state

- **Full e2e gate: 214 passed / 5 failed / 1 skipped, 220 tests, 3.1m**
  [ran it]. Cold-built stack, empty volumes, full 17-service bootstrap
  chain (all Exited 0), `--workers=1`.
  - The 5 failures are **2 deliberately-red (#828)** plus **the 3 in
    #896**. Nothing else is red.
  - An earlier run was 212/7; the two fixes below closed the difference.
- `npm run test:architecture`: 93/93 [ran it].
- `storage.routes.test.js`: 51/51 [ran it]; 376/376 across all 9 unit
  route test files.
- `tsc --noEmit -p tsconfig.json` clean; `frontend typecheck` clean.

## The gate falsified two things that looked fine

Both passed `tsc` and `playwright test --list`. Neither was detectable
without a live stack. **This is the argument for the gate, in one place:**

1. **`a0a091b0`'s warm-up was inert.** It waited on `networkidle`, which
   never fires under Vite -- the dev server holds an open HMR websocket.
   30 of 39 routes burned the full timeout. Fixed in `41fde0fa`
   (domcontentloaded + a bounded 3s dwell that is *expected* to time out).
   Re-run: **0 warm-up timeouts**, `tcle-dinamico` 4/4 including `:19`.
2. **#895 -- `ResultsPage`'s import history was empty for every user,
   always.** It unwrapped three response shapes and the real one
   (`response.data.data.jobs`) was not among them, so `jobs = []` on every
   call and the per-job "Ver" button could never render. That is the flow
   #861 fixed the writer for and #889 was filed to cover; every layer was
   individually green. Fixed in `308c2a32`.

## Rules this sitting earned

- **Grade the inference, not just the observation.** #890 went wrong
  because the call-site facts were verified and correct, and the
  *consequence* was inferred without reading the callee bodies.
- **When a premise falls, re-derive the symptom independently.** #890's
  first correction dismissed a real defect because the stated cause was
  wrong. A wrong explanation of a real problem is not no problem.
- **Verify a matcher by which LINES CHANGED, not by exit code.** A `perl`
  substitution silently did not match, and the resulting green run read
  exactly like a falsifiability proof. It proved nothing.
- **Never assert a filing before making it.** `2c0a77bb`'s message says
  "filed separately" for something later found not to be a defect. The
  commit is pushed and now carries a false statement.

## Open work

Query it: `gh issue list --state open`, same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#896 is root-caused for 2 of its 3 items, and folds into #876.**
  `POST /api/reagent-lots` returns `reagentId` as a **number**
  (`1787986833457`, the `Date.now()` fallback) while `Assay.js:86`
  validates foreign keys as strings. The cheap fix is `String(Date.now())`,
  which unblocks both RF025 failures without pre-empting #876's
  uuid-vs-epoch question. **Check first whether anything sorts or compares
  these numerically.** Item 1 (RF027 404) is still un-isolated.
- **#892 item 2 was verified and deliberately NOT changed** -- the dead
  `400` branch is defensive-in-depth; the problem was legibility and the
  record now solves it. Item 1 stays parked behind #884.
- **pack #608 -- Dennis corrected the premise in session:** `test-loop`'s
  "never edit product source for any reason" is **stale scope**, from when
  the loop only wrote unit tests. It manufactured a false blocker this
  sitting. Retitled; needs a pack-repo session.
- **#893 is a production landmine with no consumer today** --
  `compose.prod.yml` sets `read_only: true` with only `tmpfs /tmp` while
  every upload dir is created under `/app/uploads`, so uploads fail EROFS
  on the first request. Cheap now, an outage later.
- **#828's fix is compose-only** (`uploads-test-data:/app/uploads` on
  `backend-app-test` + `worker-test`) and unblocks #889 Part B. But nothing
  prunes those dirs, and a named volume survives `down` without `-v`.

## Recommended next

**Dennis named this explicitly:** after the e2e slices, go back to the
**coverage GitHub milestone**, and **review `COVERAGE_NOTES.md`** -- its
buckets are dated 2026-07-22/24, five weeks stale. That staleness already
showed: `storage.routes.js` appears in no bucket, so #856's two slices
moved nothing in it.

Before that, the cheap wins:
1. **`String(Date.now())` for #876/#896** -- two gate failures for a
   one-line change, once the numeric-comparison check is done.
2. **Delete the two redundant in-spec warm-ups** (#894) now that the gate
   proves `global-setup.ts` works.
