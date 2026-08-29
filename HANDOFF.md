# HANDOFF

**Written 2026-08-29, end of sitting.** Verified as of writing; re-derive
counts rather than trusting them.

The e2e/Docker-gate cluster, worked with five agents and closed out with a
full Docker gate. **15 commits pushed. 4 issues closed, 6 product + 6 pack
issues filed.** Dennis intervened three times and every intervention
changed an outcome — see "What Dennis had to correct".

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, in sync, tree
  clean. `main` untouched, no PR.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
- **Never `git add -A`.**
- **Docker is fully torn down** (`down -v`, Dennis's call — next session is
  the pack repo). Volumes dropped; **images kept** (~4GB) so the next gate
  skips the cold build but WILL need the bootstrap chain re-run.

## Verification state — all [ran it]

- **Full backend regression: 8000 passed, 443 files, 0 failures** (565s),
  `npx vitest run tests/unit tests/integration tests/compliance`. Up from
  7956/442. Run deliberately: the sitting changed a route factory serving
  14 entities, and a prior sitting shipped a 19-test regression from a
  change of that shape.
- `npm run test:architecture`: **93/93**.
- `tsc --noEmit -p tsconfig.json` and frontend `typecheck`: clean.
- **Final e2e gate: 216 passed / 3 failed / 1 skipped**, 220 tests, 3.1m,
  `--workers=1`, full 17-service bootstrap chain.
  - 2 failures are the deliberately-red #828 pair.
  - **1 is `results-import-job-view.spec.ts`, left red-first on purpose** —
    see below.

## The gate falsified four things that passed every static check

This is the argument for the gate, in one place. All four were `tsc`-clean
and `playwright test --list`-clean:

1. **`a0a091b0`'s warm-up was inert** — `networkidle` never fires under
   Vite's HMR websocket; 30 of 39 routes timed out. Fixed `41fde0fa`.
2. **#895** — `ResultsPage`'s import history rendered empty for **every
   user, always**: it unwrapped three response shapes and the real one
   (`response.data.data.jobs`) was not among them. Fixed `308c2a32`.
3. **#896** — three failures, ONE cause: `master-data.routes.js` emitted
   epoch-number identifiers where dict-02 specifies `uuid`. Fixed
   `fef5936e`. **The RF027 one presented as a 404, the RF025 pair as
   validation rejections** — one defect wearing two status codes, which is
   why triage grouped them as unrelated.
4. **My own arch break** — an explanatory comment shifted a line-pinned
   `#875` exemption. Consumer tests were 49/49 green; the arch suite was
   91/93. Fixed `7cb1b7d0`.

## What Dennis had to correct — all three changed an outcome

- **`test-loop`'s "never edit product source for any reason" is stale
  scope**, from when the loop only wrote unit tests. It manufactured a
  false blocker I reported to him as real (#892 item 2). Pack **#608**.
- **Design questions need an exhaustive ladder before escalating** — docs
  chronologically, then Denise's papers, then commit history, then the
  philosophy the docs express. I had proposed `String(Date.now())` on
  internal consistency alone; dict-02 ELM-0298 says **`uuid`**, and #876
  had cited that answer in its own body for eight days. Pack **#611**.
- **A sitting must absorb the issues it files.** I answered the absorption
  checkpoint **ten times** and used its four categories as classification
  rather than doing the work — twice citing deferral conditions that had
  already expired. Pack **#612**.

**Five of eight product issues moved only after he pushed back, with no new
information available in between.**

## Open work

Query it: `gh issue list --state open`, same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#889's UI assertion is red-first and one investigation from done.**
  Established: the URL gains `importJobID`, the DB holds only the spec's 3
  docs (0 leftovers), `useResults` correctly depends on `[importJobID]`,
  and all API-level assertions pass. Not established: why the table renders
  all 3 rows for a full 5s under full-suite load but not in isolation.
  **Do not weaken the count assertion** — it is the only thing proving the
  view narrows.
- **#876 looks closeable** — dict-02 answers it. One enumeration remains:
  whether any of the 14 mounted entities specifies something other than
  `uuid`.
- **#891 I chose not to do.** Not blocked, not deferred — a sizeable infra
  change (production bundle for `frontend-app-test`) with two verified
  hazards and its own verification cycle.
- **#893 is a production landmine with no consumer today** —
  `compose.prod.yml` is `read_only: true` with only `tmpfs /tmp` while
  uploads are created under `/app/uploads`, so they fail EROFS on the first
  request.
- **#890's remedy is now constrained, not open** — RF029 AC#6 ("sem
  correção silenciosa") and RNF015 AC#7 (fatal import failures must be
  distinguishable) rule out the status quo.

## Recommended next

**Dennis named it: the skills-pack repo**, to work the six issues this
sitting filed there. Of those, **#608 and #612 first** — #608 because a
stale rule produced a false blocker, #612 because it let five issues sit
behind well-argued classifications.

After that, his stated order: **the coverage GitHub milestone**, and
**`COVERAGE_NOTES.md` needs a reconcile** — dated 2026-07-22/24, five weeks
stale. It already showed: `storage.routes.js` is in no bucket, so #856's
two slices (11 → 51 tests) moved nothing in it.
