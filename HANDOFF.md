# HANDOFF

**Written 2026-09-04, fourteenth queue sitting. INTERIM — no end signal
given, so treat the session as CONTINUING.** Dennis asked for "the next 10
issues, Docker is on." **7 of the 10 are closed; 3 are open with the work
recorded on them.** Both owed gates from the previous note have now run.

Re-derive every count below rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, **clean and matching
  origin**. `main` untouched, no PR.
- **5 commits this sitting**, last substantive one `8a7750bc` (#1037).
  `git status -sb` and `git log` are authoritative.
- **No new npm scripts, dependencies or env keys.** One new import in
  `auth.routes.js` (`requirePermission`, from a module already in the tree).

## The two owed gates: both RUN, and one is RED for a reason that is not ours

- **Native regression — GREEN.** `[ran it]` the sanctioned three-directory
  form: **460 files / 8466 tests / 0 failures, 703s.** Coverage 92.12%
  statements / **86.21% branches** / 92.10% functions / 92.28% lines.
  - **Two things to note.** The **2 pre-existing compliance failures that
    `ship-integration-branch`'s overlay says to expect did NOT occur** —
    that expectation is stale. And **branches fell from 88.74% (2026-07-27
    reconcile) to 86.21%**, moving away from Milestone #1's 90% target;
    `COVERAGE_NOTES.md`'s reconcile section is now stale and nobody has
    updated it.
  - Duration is climbing: 569s (09-01) → 615s (09-03) → **703s** today.
    Past the Bash tool's 600s ceiling, so backgrounding it is mandatory.
- **Frontend — GREEN.** `[ran it]` 32 files / 262 tests, and
  `tsc --noEmit` clean (0 `error TS`).
- **Docker gate — RED, pre-existing, filed as #1059.** `[ran it]`
  `backend-unit-runner` (the exact command CI's `current-state-validation`
  runs): **108 pass / 13 fail**. All 13 are
  `e2e-fixture-model-fidelity.arch.test.js`, all `ENOENT
  /tests/e2e/helpers/seedParticipant.ts`. That file climbs four directories
  to read repo-root `tests/e2e/`, which the backend image cannot contain —
  its build context is `./api/backend`. **`[ran it]` the same suite is
  122/122 natively**, and `git merge-base --is-ancestor f8443983 9232979b`
  confirms the test predates this sitting.
  - **So CI is red on `main` today and nobody can see it**, because CI fires
    only on `main` (frozen, #90) and last ran 2026-07-31 — before the test
    landed. **Read #1059 before opening any PR to `main`.**
  - `[ran it]` The rest of `current-state:ci` **passes in-container** when
    run past the arch step: essential reference data validated, dictionary
    catalog **929/929 (v1.3.0)**, compliance evidence generated. So the
    branch's own work has a green Docker signal; only the pre-existing
    arch test is red.
- **Nothing left running.** No containers (`--rm`), tree clean. Images and
  named volumes are the usual persistent set — not cleaned, deliberately.

## Closed (7)

`#1044` `#1048` `#1052` `#1047` `#983` `#1037` `#1046`.
Each carries its own evidence in its close comment.

**`#1044` was reported closed by the previous handoff and was not.** Its fix
(`9b5861f4`) says `Fixes #1044`, but **auto-close keywords fire only on the
default branch**, and `main` is frozen — so on this branch a `Fixes #N` in a
commit message discharges nothing. Close by hand, every time.

## Still open from the queue (3) — work recorded, not resolved

- **`#1029`** sensor org-scope. Re-derived; the sweep it asked for is run and
  it is a **class**, split out to #1053. Six citation corrections posted.
  Carries a rider that matters: **the full fix would not turn the existing
  tests red either**, because `getSensor` is unmocked and `db.factory`
  defaults `findOne` to `null`, so a null-tolerant post-fetch check no-ops.
  New cross-tenant tests seeding a foreign-org document are mandatory.
- **`#1050`** piece 1 shipped (`f81dfea5`, pin probed by reverting both
  product sites). **Piece 2 (the `toCsvRows` column allow-list) is not
  done.** The sweep says it must be **per-`handlerKey`** — seven distinct row
  shapes — and that it is the same change as #1058.
- **`#979`** Redis posture. The decision is untouched, but its
  `[not established]` is answered and **stale in the good direction**: all
  six worker services gained healthchecks in `bab590e8`.

## The judgment a query cannot carry

- **`[ran it]` #1048 is answered and the metric it proposed is partly
  measuring the wrong thing.** 0 tests at >=60% of budget, 1 at 50.7%.
  But **5 of the top 6 are the FIRST test in their file**, and the run's own
  breakdown is `import 431.20s` against `tests 93.97s` — vitest bills a
  file's module-load cost to whichever test runs first. So a high percentage
  there measures the import graph, not test slowness. #1038's test was the
  opposite shape (genuinely slow, and not first in its file).
- **`[ran it]` #1046 does not reproduce.** Six container runs, 501/501 lines
  each, ~250KB through a pipe with an immediate `process.exit(1)`, marker
  always last. Directions 2-4 declined on evidence, not postponed.
- **`[read it]` #1037's remedy was NOT the owner's call, and the issue said
  it was.** RF003 makes the Administrador the primary actor for the account
  lifecycle; RF001 creates sessions and has no account-creation clause;
  RF003 AC#6 requires auditing creation; RF012 AC#1 and RNF009 AC#2
  (Crítica) make the actor mandatory. Zero corpus hits for self-registration
  vocabulary. **Run `resolve-issue`'s inference step before accepting an
  issue's own "this is Denise's call" — it is circular evidence (#529).**
- **`[read it]` #983's direction 3 has the same shape.** The canonical
  Foundation Data Pipeline plan (`:79`) records "Seed manual separado do
  startup" as the **superseded** model. Recorded on #1055.
- **`[ran it]` #1047's production claim was FALSE.** `import-worker.js` and
  `neo4jProjection.worker.js` both guard their signal handlers on
  `require.main === module`, so no double-registration exists. Only the
  test-pollution half was real.
- **`[ran it]` the two-hop consumer sweep paid again.** On #1037 it caught
  `auth.controller.test.js` asserting `registerUser`'s 2-argument call —
  invisible to the targeted run, which was green.

## Filed this sitting

**#1053 #1054 #1055 #1056 #1057 #1058 #1059** — all OPEN and unworked.
**#1056 and #1054 are security findings**, #1059 is the CI blocker above.
Query the board for everything else: `gh issue list --state open`.

## Conventions this sitting relied on / established

- **Never chain a `git push` with a gated command.** `[ran it]` a
  `push && npm run test:unit && typecheck` one-liner was blocked whole by
  `full-suite-guard` and **the push silently did not happen**. `fix-bugs`
  already says this (#413/#657); it was read this session and skipped anyway.
- **`npm --prefix frontend run test:unit` is blocked by `full-suite-guard`.**
  The sanctioned form, from `frontend/`:
  `npx vitest run src/components src/contexts src/foundation src/hooks
  src/pages src/utils src/views --reporter=dot`.
- **Don't splice two disjoint `sed -n 'A,Bp;C,Dp'` ranges into one read.**
  It creates a false adjacency — here it read as a `create-db.js` entry whose
  `name` and `description` disagreed, costing a full re-read to disprove.
- **A subagent's characterisation can be materially weaker than the truth.**
  One reported `POST /api/temperature/system/reading` as missing a *scope
  gate*; firsthand reading showed it has **no middleware at all**. Another's
  "18 collections → 13" arithmetic was wrong (12). Both caught only by
  verifying — which is the non-delegable rule earning its keep.
- **Manual test-stack Playwright env** (unchanged, **not re-run this
  sitting — unverified**): `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
  `PLAYWRIGHT_API_BASE_URL=http://localhost:3000`,
  `PLAYWRIGHT_SKIP_WEBSERVER=1`, `TEST_USER=admin`, `TEST_PASS=Admin@123`,
  `E2E_MONGO_URI='mongodb://localhost:27017?directConnection=true'`,
  `E2E_MONGO_DB=bioavanced_test`,
  `TEST_SUPPORT_SECRET=e2e-test-support-secret`.

## Recommended next

**Dennis named no successor to the ten.** On the evidence above, **#1059
first** — it is the only thing standing between this branch and a green CI
check, it is not the branch's own defect, and its cheapest direction is a
few lines. Then **#1056** (audit-trail bypass, the most severe of the
security findings). #1050 piece 2 and #1058 are one change and should be
done together.
