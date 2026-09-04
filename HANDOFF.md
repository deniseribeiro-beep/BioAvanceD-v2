# HANDOFF

**Written 2026-09-04, fifteenth queue sitting. INTERIM — no end signal given,
so treat the session as CONTINUING.** Dennis asked for "the next 10 issues,
Docker is on." **7 of the 10 are closed.** The sitting also filed **14
issues** and closed 2 of those, so the backlog grew rather than shrank.

**BOTH GATES HAVE NOW RUN AND BOTH ARE GREEN** — see "Gates" below.

Re-derive every count below rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR. `git status -sb` and `git log` are authoritative.
- **9 commits this sitting.** Last substantive one is the #1068 secret-strip.
- **One new env key: `TELEMETRY_INGEST_SECRET`**, documented in all three
  `.env.*.example` files, read via `process.env` (not `config/env.js`,
  matching `TEST_SUPPORT_SECRET`, which is also undeclared there). **It fails
  CLOSED** — unset means the two machine-ingest routes are unavailable, not
  anonymous. That is deliberate and is the whole point of the fix.
- **One new compose mount:** `compose.dev.yml` bind-mounts
  `./infra/audit/secrets` read-only at `/run/secrets` in backend and worker.
  The directory is gitignored and does not exist until
  `generate-env-docker-secrets.sh` runs.
- No new npm scripts, no new dependencies.

## Gates — both RUN, both GREEN

- **Native regression — GREEN.** `[ran it]` the sanctioned three-directory
  form: **462 files / 8544 tests / 0 failures, exit 0, 596s.** A first pass
  earlier in the sitting found 12 failures, all in
  `sensor.controller.test.js`, fixed in `8d110918`; this is the clean re-run
  covering every commit since. Duration is past the Bash tool's 600s ceiling,
  so background it and grep your own redirect.
  - The test count moved **8466 -> 8544** against the previous sitting. The
    78 are almost entirely this sitting's own reproductions.
  - **The `ship-integration-branch` overlay's stale "expect 2 compliance
    failures" claim did NOT fire**, consistent with the correction that
    overlay already carries.
- **Docker gate — GREEN.** `[ran it]` the exact command CI's
  `current-state-validation` runs:
  `docker compose --env-file .env.test.example -f compose.test.yml run --rm
  --no-deps backend-unit-runner` -> **exit 0, 122 tests, 108 pass, 0 fail,
  14 skipped**, and all four chained steps ran to completion: architecture,
  essential reference-data validation, dictionary catalog **929/929
  (v1.3.0)**, and compliance-evidence generation.
  - That four-step chain completing is the property #1059 restored — before
    it, `current-state:ci` short-circuited at the first suite and the three
    downstream steps silently never ran. It still holds.
- **Nothing left running.** `--rm` cleaned up; `docker ps -a` is empty and the
  tree is clean. Build cache 610.5MB, unchanged — no image was built.

## The ten: 7 closed, 3 open

**Closed:** `#989` `#1056` `#1035` `#1054` `#1029` — plus `#1063` and `#1068`,
both filed AND closed this sitting.

**Open, with the work recorded on each:**

- **`#941`** — two indexes shipped (`Refs`, not `Fixes`). Verification found
  **both call sites are unreachable**: `linkSensorMetadata` has zero callers,
  and `backfillLocationsToStorage` is reached only from a `src/scripts/` file
  with no npm script. The indexes are correct, tested, and create nothing on
  any stack. Split to **#1070**, which is the larger finding.
- **`#1050` / `#1058`** — mechanism decided, membership is genuinely Denise's.
  **RF008 AC#6 forbids keying an allow-list to a fixed list of report types**,
  so it must key on `handlerKey` (12) not `code` (14). `FILTER_CATALOG` in the
  same file is the precedent and cites AC#6 for exactly this reason.
  **Recorded on #1058: shipping it alone WIDENS the leak** — two of its three
  broken exports would start emitting raw documents including `ipAddress`,
  `userAgent` and ledger hashes. `sampleAnalysis` is the safe third.
- **`#1026`** — mechanism confirmed, genuinely blocked on **#1069**: nothing
  emits a specimen into the graph outbox, so the doc-conformant fix has
  nothing to traverse. Also corrected: this issue's own remedy #2 would break
  consent-node keying, because the producer writes `ethicalConsentId` and the
  consumer reads `consentId`.
- **`#1053`** — confirmed as a class across **8 route files and 3 distinct
  defect shapes**. Two of its three stated mechanisms are corrected on the
  issue. `dataset-file.routes.js` and the sensor allow-list are the cheapest
  first slices.

## Pile-up (the numbers `issue-loop` rung 3 asks for)

**7 discharged, 14 filed.** No `rabbit-hole` conversion claimed: there were
free agent slots and unblocked work throughout, which #590 says disqualifies
one. Where the sitting stopped on a filed issue it said so plainly rather than
dressing it as a blocker.

Query the board rather than trusting a list: `gh issue list --state open`.

**Most serious thing found: #1072** — `mfaSecret` is stored **plaintext**
under a canonical field typed `secret/encrypted`, against RNF020 AC#3's
explicit *"segredos MFA são cifrados"*. The TOTP verifier consumes the raw
seed, so no decrypt is missing — there never was one.

## The judgment a query cannot carry

- **The end-of-loop regression earned its keep and the per-fix sweep did
  not.** `#1029`'s consumer sweep used `ls tests/**/*sensor*.test.js`.
  **`globstar` is OFF in this shell**, so `**` collapsed to one level and
  silently missed `tests/unit/controllers/sensor.controller.test.js` — 12
  failures nothing else would have caught. **Derive a test list with
  `git ls-files`, never a `**` glob.** Filed as pack#762.
- **`git stash push -- <paths>` REFUSES when the fix adds an untracked
  file**, and chaining it to the test run printed a confident **false pass**
  on a can-it-fail probe. Use `git stash push -u --`. Filed as pack#760.
- **`docs-primacy-guard` blocked an edit to `models/User.js`, and the block
  paid.** Reading `dict-02_DICIONARIO.md` firsthand surfaced
  `passwordResetToken` (P1X-0207) — a raw account-takeover credential in the
  same responses — which #1068's body never named. Do not treat an agent's
  quotation of the dictionary as the dictionary.
- **A worker was briefed on #941 without checking the paths were reachable.**
  It built exactly what was asked, correctly, on dead code. Filed as
  pack#761: the delegability triage gates on "diagnosis complete" and "file
  set bounded", and neither asks whether the code RUNS.
- **`agent-delegation`'s cap is 2, not 3** — #707 lowered it and nine
  downstream passages still say three, including `issue-loop`'s queue-mode
  line that a sitting reads when deciding concurrency. Filed as pack#757.
  This sitting ran 2.

## Conventions this sitting relied on / established

- **Derive a consumer-test list with `git ls-files`, then substitute the file
  bare** — `npx vitest run $(cat consumers.txt)`. No `| tr` inside the
  substitution (it defeats `full-suite-guard`'s file read), no `**`.
- **`machineIngestGate.js` is the repo's machine-credential gate** — a sibling
  of `testSupportGate.js`, not a reuse: that one requires
  `NODE_ENV !== 'production'` and so refuses to register in production, which
  a telemetry ingest path cannot do. Both compare with `!==`; whether to
  harden both is **#1067**, deliberately not decided on one of the two.
- **`UserModel.stripSecrets` and `PatientModel.stripConsentSecrets`** are the
  two response-boundary helpers. There is still no shared utility; a third
  would be the moment to build one.
- **When a fix adds a guard that FETCHES before acting, expect existing tests
  that stub only the mutator to go red** — that is the un-weakening, not a
  regression. Three sensor tests and twelve controller tests did exactly this.

## Recommended next

**Dennis named no successor to the ten**, so: none queued. If the gates are
wanted first, the two above are owed. Otherwise **#1073** (a read permission
gating sensor deletion) is one `git grep` from decidable, and **#1072** is the
most serious open finding.
