# HANDOFF

**Written 2026-09-01, at the end of a 10-issue queue sitting run with
Docker OFF** (Dennis needed the machine). Verified as of writing; re-derive
counts rather than trusting them.

Dennis asked for 10 issues; the sitting **closed 13** and **filed 12**, 5 of
which it also closed. Orchestrated with 2-3 delegated agents throughout
(8 research rounds + 7 worker rounds); every delegated slice re-verified by
the orchestrator before commit. 15 commits pushed. **The session was not
declared over by the user — it may continue.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, tree clean except
  the deliberately-untracked `api/backend/storage/assays/`. **Never
  `git add -A`.** `main` untouched, no PR.
- Last substantive commit: `f309442f`.
- No new dependencies added.

## Docker state — UNCHANGED FROM THE PREVIOUS SITTING

**Docker was never started.** The previous handoff's state stands untouched:
**stack DOWN, volumes dropped (`down -v`), build cache pruned, 24
`bioavanced-test-*` images kept.** The next gate still needs the **full
bootstrap chain re-run** — `admin-bootstrap-test` plus the 17 reference-data
one-shots. `docker-workflow`'s bioavanced overlay has the recipe; verify
one-shots via `docker ps -a` for `Exited (0)`.

**No e2e ran. Three changes want the next Docker gate's attention** — see
"Carried risk".

## Verification state — full native gate, all green [ran it]

| Gate | Result |
|---|---|
| `test:architecture` | **104 / 104** |
| backend `tests/unit tests/integration tests/compliance` | **8084 passed / 445 files / 0 failed** |
| frontend (27 files) | **219 passed** |
| `npx tsc --noEmit` (frontend) | **exit 0** |

Backend was 8052 last sitting (+32). Arch stayed at 104.

**The gate caught two of this sitting's own changes**, both fixed in
`575a7e4c` — worth knowing before trusting a green per-slice run:

1. `filter-keys.arch.test.js`'s `RETIRED_KEY_EXEMPT` is keyed by
   `file:line`, and #789 added 64 lines to `sample.routes.js` above all
   three exempted sites. **Arch-guard exemptions travel with any change
   that moves them.**
2. `fhir-import.test.js`'s `attachExternalDocument` fixture never seeded a
   sample and passed only because the function discarded its
   `samples.updateOne` result — the exact defect #801 fixed.

## What closed (13)

`#651 #665 #688 #789 #801 #814 #825 #911 #912 #913 #916 #919 #920`

Read each close comment for the evidence. **Five were filed by this sitting**
(#911 #912 #913 #916 #919 #920 — six, of which #920 and #916 were worked
after the first handoff rotation).

## Carried risk — read before the next Docker gate

- **#916 added `seedRolesAndPermissions(db)` to `server.js`'s boot path** and
  has **not been exercised against a live start-up.** The three arch guards
  that read `server.js` are green and the seed's own suites pass, but the
  boot sequence has no test. Watch for the `🔑 Catálogo RBAC garantido` log
  line and for any boot delay — it writes 24 permissions plus 5 roles.
  **[not established]**
- **#912's `$expr`/`$toString` fix is verified against MOCKS ONLY.** `$expr`
  in a `find` filter is supported from MongoDB 3.6, but the test mock
  understands `$expr` because this sitting taught it to — not the same as
  the driver doing so. **[not established]**
- **#814 writes `LGPD_PATIENT_CSV` batches no reader can see** (both filter
  on `LGPD_SAMPLE_CSV`). Deliberate, filed as #915.

## Open work — query it, don't trust a list

`gh issue list --state open`, same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#888 is now UNBLOCKED.** #916 shipped the boot seed, so a new permission
  code will reach existing databases. #888's remedy — two storage-scoped
  codes, `manageStorageAllocation` and `manageStorageTopology` — is fully
  specified in its thread, and its gate tests were made non-vacuous in
  `8d9d19de`. **This is the most shovel-ready item on the board.**
- **#914 still blocks #649.** RF014's `security_config` is **read by
  nothing** — `requireMFA` is consulted by no login path, `createSession`
  hardcodes its timeouts. Implementing #649 first would log every user out
  and readmit them all *without* MFA. **[ran it]**
- **#910 got sharper and is now the most security-relevant open item.**
  The check its body called for was run: `/patients` and `/samples` **are**
  org-scoped (`requireOrganizationScope`, which hard-403s an unusable
  scope), so those two legs are low severity. But **`GET /api/results`,
  `/results/:id` and `/results/:id/download` carry `authenticate` ONLY** —
  no scope, no permission. Any authenticated principal, including `Usuário
  Externo`, can list and download any analysis result. **[read it]**
  Unestablished: whether a per-record filter inside those handlers narrows
  it. Check that first.
- **#921** carries the sitting's largest coverage finding: ~40 of 53 RBAC
  gate call sites are pinned by no test, and the `#630 allowedActions audit`
  test reads no route file.
- **#915 should be sequenced with #800**, not before it — widening the
  quarantine readers doubles the population #800's ownership question covers.
- **#800's stage-1 prerequisite shipped** as #911. What remains is the
  multi-org ownership question and the deliberate acceptance that
  pre-existing batches become Administrador-only.
- **#902/#884/#881/#903/#908/#909** remain prior sittings' decisions.
- Pack **#635/#636** carry this sitting's workflow findings (Rule 0).

## Conventions this sitting relied on / established

- **A file the consumer sweep names is either run or explained.** Five
  sweeps found tests the delegated briefs had not named; three were red or
  became red. The one dismissed unrun ("integration, needs Docker")
  surfaced at the final gate — **`tests/integration/` here is a naming
  convention, not a statement about dependencies.** Pack #636.
- **`ObjectId` provenance is a real constraint.** `node_modules/bson` is
  **6.10.4**, `mongoose/node_modules/bson` **7.2.0** — a major split npm
  hoisting has entrenched. Statically-mongoose handle → `mongoose.Types`;
  module reached with **both** handles → `$expr`/`$toString`, construct
  nothing. `createForeignBsonGuardCollectionMock` in
  `tests/factories/db.factory.js` reproduces the failure in tests.
- **A role-gate test must seed a matching RBAC assignment.** `requireRole`
  reads `userLevel === null || !allowedRoles.includes(userLevel)` and
  **short-circuits on the first disjunct**, so a starved fixture 403s
  without consulting the role list. Seeding `buildRbacCollections` is
  necessary but **not sufficient** — the `userAccountId` must match the
  token's `userID`. `requirePermission` differs: one boolean, no null
  branch. `eConsent.routes.test.js`'s `#684` block is the pattern to copy.
- **`ImportBatch.type` is the discriminator and readers filter on it** —
  `LGPD_SAMPLE_CSV`, `LGPD_PATIENT_CSV` (new), `FHIR_BUNDLE`,
  `ASYNC_BATCH_IMPORT` (write-only). A new type without a reader is
  unreachable data.
- **`minimumDuration` is in MINUTES** — an inference, not a citation;
  dict-02 types it `Duration`/`UCUM` with no unit. One constant and one
  comment to overturn.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

Highest value now: **#888** (unblocked, fully specified, shovel-ready) and
**#910's results leg** (the sitting's sharpest security finding, and one
grep from being settled either way).

`COVERAGE_NOTES.md`'s reconcile and milestone #228 remain `[not
established]` — untouched again.
