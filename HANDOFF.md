# HANDOFF

**Written 2026-08-29, after the e2e/uploads cluster sitting.** Verified as of
writing; re-derive counts rather than trusting them.

Worked two groups with six agents: the **uploads shared-storage cluster**
(#828/#893) and the **results-view cluster** (#889/#895). Both closed out with
a full Docker gate and a full backend regression. **9 commits pushed. 5 issues
closed, 4 product + 4 pack issues filed.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, in sync, tree clean.
  `main` untouched, no PR.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
- **Never `git add -A`.**
- Last substantive commit: `397cafef`.

## Docker state — READ THIS BEFORE THE NEXT GATE

- **Stack is DOWN. Volumes were dropped (`down -v`), including the new
  `uploads-test-data`.** Build cache pruned 1.066GB to 0B.
- **Images kept** (24 `bioavanced-test-*`), so the next gate skips the cold
  build but **WILL need the full bootstrap chain re-run** — `admin-bootstrap-test`
  plus the 16 reference-data services. Without it ~20 specs fail environmentally.
- `docker-workflow`'s bioavanced overlay has the exact recipe. Two things it is
  right about and easy to skip: append `--build` if the sitting touched
  `api/backend/src` or `frontend/src`, and verify each one-shot with
  `docker ps -a` for `Exited (0)` rather than trusting the compose exit code.

## Verification state — all [ran it]

- **Full e2e gate: 219 passed / 1 skipped / 0 failed** (220 tests, 2.3m,
  `--workers=1`, fresh volumes, all 18 bootstrap containers `Exited (0)`).
  Up from 216 passed / 3 failed. **Zero failures — the first fully green gate.**
- **Full backend regression: 8011 passed, 443 files, 0 failures** (579s), from
  **`api/backend`** (see the command note below). Up from 8000.
- `npm run test:architecture` 93/93 — also from `api/backend`.
- Frontend `typecheck` and `typecheck:e2e` clean.

**Command gotcha that cost this sitting two round-trips and a wrong brief:**
the backend suites and `test:architecture` run **from `api/backend`, not the
repo root**. A root-level vitest run dies on `CONSENT_SECRET` (the config
resolves `setupFiles` relative to cwd), which reads as an env problem rather
than a cwd one; and `test:architecture` is only defined in
`api/backend/package.json`. Filed as pack #620. Previous handoffs, including
the one this replaced, wrote these commands with no directory.

## What the gate proved

All three previously-red tests went green, none by weakening:

1. **#828** — the two `async-import-quarantine` tests, deliberately red since
   2026-08-27. One shared `/app/uploads` volume between `backend-app-test` and
   `worker-test` (`9ce27678`) closed it end to end.
2. **#889** — the results-table count assertion. Root cause was a **product**
   defect, not the spec: `useResults` had no abort, no cleanup and no sequence
   token, so the mount-time unfiltered fetch overwrote the post-click filtered
   one under load. Guarded in `4d3135e6`. The `toHaveCount(2)` assertion is
   untouched and the spec now *additionally* pins the pre-click count of 3.

## Two things found by accident that matter more than the issues worked

- **The previous sitting shipped a regression** (#899, fixed). `fef5936e`
  changed the master-data id fallback from `Date.now()` (a number) to a uuid
  string for all 14 factory mounts; four of those models hard-require a number,
  so id-less POSTs to `/api/sample-types`, `/sample-origins`,
  `/extraction-protocols` and `/quality-descriptions` began returning 422.
  **The 8000-test run missed it** because the only test covering that path
  targets `/api/measurement-units` — the one model with no type check — and
  asserted `expect([200,201,422])`, green either way.
- **Batch-import row errors had never reached an operator** (#900, fixed). The
  per-row `$push` targeted `errors`, absent from the strict `StagingImport`
  schema, so Mongoose dropped the whole operator and
  `import-batch.controller.js` returned `[]` for every batch. Same class as
  #43, which was fixed in the sibling service and pinned there; the engine
  never got that test. It has one now.

## Open work

Query it: `gh issue list --state open`, same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#902 is genuinely Denise's call and the ladder is already walked.** Four
  MIABIS master-data entities have three competing identifier shapes live at
  once; dict-02 is silent on all four (grepped, with the two near-miss matches
  checked individually and ruled out) and the milestones do not sequence it.
  #899's fix is deliberately direction-neutral so any answer lands without a
  second regression.
- **#893 stays open with a real physical blocker**, and one of its unknowns is
  now settled: `[ran it]` a named volume **is** writable under
  `read_only: true`. What remains is a `Dockerfile.prod` ownership trap
  (`USER app` + an empty untracked `uploads/` seeds the volume root-owned, so
  it fails `EACCES` not `EROFS`) plus two write roots outside `/app/uploads`.
  Nothing this repo runs exercises `compose.prod.yml`, so it cannot be verified
  here.
- **#898 and #901 I chose to stop on, not deferred.** #898's live bug is fixed;
  its remaining half is retyping 20 `api.get<T[]>` generics that lie about the
  response envelope. #901 is that class one layer over — no hook under
  `frontend/src/hooks/` uses an `AbortController` or sequence token, and
  `useEquipment` has the identical shape to the bug #889 fixed.
- **`E2E_TRACEABILITY_PLAN.md` has a new "Carried coverage items" section.**
  #889 Part B lives there — a spec pinning the `importJobID` *writer*, which
  Part A deliberately does not. It is unwritten, no longer blocked.
- **The `uploads-test-data` volume is scaffolding.** It makes the
  shared-filesystem assumption true rather than removing it, in the stack that
  gates every e2e run. Storing the bytes via the `rawData.storageType`
  discriminator — one writer, one value, zero readers in `src/` — is what
  retires it, and that change deletes the mount. The quarantine spec is now the
  regression proof for both.

## Recommended next

**None queued** — no next task was named. `COVERAGE_NOTES.md` still wants the
reconcile the previous handoff flagged (dated 2026-07-22/24), and the coverage
milestone (#228) is still the one open item there. Both `[not established]`
this sitting; I did not look at either.
