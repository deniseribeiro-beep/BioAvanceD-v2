# HANDOFF

**Written 2026-09-01, at the end of a 10-issue queue sitting run with
Docker OFF** (Dennis needed the machine). Verified as of writing; re-derive
counts rather than trusting them.

Dennis asked for 10 issues; the sitting **closed 10** and **filed 11**, 3 of
which it also closed. Orchestrated with 2-3 delegated agents throughout
(6 research rounds + 6 worker rounds); every delegated slice re-verified by
the orchestrator before commit. 10 commits pushed. **The session was not
declared over by the user — it may continue.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, tree clean except
  the deliberately-untracked `api/backend/storage/assays/`. **Never
  `git add -A`.** `main` untouched, no PR.
- Last substantive commit: `575a7e4c` (gate reconciliation).
- No new dependencies added.

## Docker state — UNCHANGED FROM LAST SITTING

**Docker was never started this sitting.** The previous handoff's state
still stands and is untouched by anything here: **stack DOWN, volumes
dropped (`down -v`), build cache pruned, 24 `bioavanced-test-*` images
kept.** The next Docker gate still needs the **full bootstrap chain
re-run** — `admin-bootstrap-test` plus the 17 reference-data one-shots.
`docker-workflow`'s bioavanced overlay has the recipe; verify one-shots via
`docker ps -a` for `Exited (0)`.

**No e2e ran this sitting, and nothing here has been exercised against a
live server.** Two changes specifically want the next Docker gate's
attention — see "Carried risk" below.

## Verification state — full native gate, all green [ran it]

| Gate | Result |
|---|---|
| `test:architecture` | **104 / 104** |
| backend `tests/unit tests/integration tests/compliance` | **8083 passed / 445 files / 0 failed** |
| frontend (27 files) | **219 passed** |
| `npx tsc --noEmit` (frontend) | **exit 0** |

Backend was 8052 last sitting, so +31. Arch stayed at 104.

**The gate caught two of this sitting's own changes**, both fixed in
`575a7e4c` — this is the end-loaded gate earning its place, and worth
knowing before trusting a green per-slice run:

1. `filter-keys.arch.test.js`'s `RETIRED_KEY_EXEMPT` is keyed by
   `file:line`, and #789 added 64 lines to `sample.routes.js` above all
   three exempted sites. Guard went 103/104 on the line shift alone.
   **Arch-guard exemptions travel with any change that moves them** — the
   same bookkeeping `result.routes.js`'s entry needed under #875.
2. `fhir-import.test.js`'s `attachExternalDocument` fixture never seeded a
   sample and passed only because the function discarded its
   `samples.updateOne` result — the exact defect #801 fixed.

## What closed (10)

`#651 #665 #688 #789 #801 #814 #825 #911 #912 #913`

Read each close comment for the evidence. Short shape: the GET/POST
non-canonical-param asymmetry (#789); `attachExternalDocument` committing
records with blocking validation errors (#801); `ROUTE_ACCESS` overruling
`<Route requiredRole>` on five routes (#825); per-policy `minimumDuration`
wiring (#688); the mongoose/native bson `ObjectId` split at the two
controllers that actually had it (#651) and at the dual-handle quarantine
service (#912); a null actor on every LGPD import (#911); quarantine
reaching the two patient import paths (#814); four vacuous role-gate tests
plus zero-coverage reagent-lots (#913); and RF025's Técnico question
answered as confirmed-no-change with the reasoning written into `app.js`
(#665).

**Four of those ten were filed by this sitting** (#911 #912 #913, plus
#910 which stayed open) — found while working the picked issues.

## Carried risk — read before the next Docker gate

- **#912's `$expr`/`$toString` fix is verified against MOCKS ONLY.** `$expr`
  in a `find` filter is supported from MongoDB 3.6, but nothing ran against
  a real server, and the test mock understands `$expr` because this sitting
  taught it to — which is not the same as the driver doing so. **[not
  established]**
- **#814 writes `LGPD_PATIENT_CSV` batches that no reader can see** (both
  filter on `LGPD_SAMPLE_CSV`). Deliberate and filed as #915, but it means
  the participant quarantine path is half-built until that lands.

## Open work — query it, don't trust a list

`gh issue list --state open` (81 open at time of writing), same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#914 blocks #649.** RF014's `security_config` is **read by nothing** —
  `requireMFA` is consulted by no login path and `createSession` hardcodes
  its timeouts. So implementing #649 (revoke sessions on policy change)
  first would log every user out and readmit them all *without* MFA. Wire
  enforcement first. **[ran it]**
- **#916 blocks #888.** `seedRolesAndPermissions` runs on no boot path and
  in no compose file, and `createFirstAdmin` early-returns on
  `users_exist` — so a new permission code 403s for every user including
  Administrador, silently, on any existing database. #888's remedy (two
  storage codes) is fully specified in its thread and safe only after this.
  **[ran it]**
- **#915 should be sequenced with #800, not before it.** Widening the
  quarantine readers to the new batch type doubles the population #800's
  ownership-scope question is about; designing that scope twice is the
  thing to avoid.
- **#800 is unblocked on its stage 1 prerequisite** — the actor-plumbing
  half shipped as #911. What remains is the multi-org ownership question
  (which of a multi-org operator's organizations owns a batch) and the
  deliberate acceptance that pre-existing batches become Administrador-only,
  since they carry no owner and cannot be backfilled.
- **#910 needs one cheap check first**: whether the backend already scopes
  `/patients`, `/samples`, `/results` for a `Usuário Externo` principal.
  That decides whether it is a data leak or a confusing empty page. **[not
  established]**
- **#902/#884/#881/#903/#908/#909** remain the prior sittings' decisions,
  untouched here.
- Pack **#635/#636** carry this sitting's workflow findings for a pack-repo
  session (Rule 0).

## Conventions this sitting relied on / established

- **A file the consumer sweep names is either run or explained.** Five
  sweeps found tests the delegated briefs had not named, and three of those
  were red or became red. The one dismissed unrun ("integration, needs
  Docker") surfaced at the final gate — `tests/integration/` in this repo
  is a naming convention, **not** a statement about dependencies; most of it
  runs natively in seconds. Pack #636.
- **`ObjectId` provenance is a real constraint here.** `node_modules/bson` is
  **6.10.4**, `mongoose/node_modules/bson` is **7.2.0** — a major split npm
  hoisting has entrenched. Where a handle is statically mongoose, use
  `mongoose.Types`; where a module is reached with **both** handles, use
  `$expr`/`$toString` and construct nothing. `createForeignBsonGuardCollectionMock`
  in `tests/factories/db.factory.js` reproduces the failure in tests. **[ran it]**
- **`ImportBatch.type` is the discriminator, and readers filter on it.**
  `LGPD_SAMPLE_CSV`, `LGPD_PATIENT_CSV` (new, #814), `FHIR_BUNDLE`,
  `ASYNC_BATCH_IMPORT` (write-only, no reader). Adding a type without
  widening the readers leaves the data unreachable.
- **`minimumDuration` is in MINUTES** — an inference, not a citation:
  dict-02 types it `Duration`/`UCUM` with no unit. Documented on
  `TemperaturePolicy.schema.js` and made explicit by a named
  `MINUTES_PER_HOUR`. One constant and one comment to overturn.

## Recommended next

**None queued** — Dennis named no next task beyond the 10. The natural pool
is the two blocking pairs above (**#916 → #888**, **#914 → #649**), since
each unblocks work already fully specified in its thread.

Three filed-this-sitting items are small and self-contained if a short
sitting is wanted instead: **#920** (align `revokeAllSessions` with its four
siblings), **#917** (one `git log -S` decides delete-vs-exempt on a dead
filter branch), **#919** (sweep first, then decide whether a guard is worth
it).

`COVERAGE_NOTES.md`'s reconcile and milestone #228 remain `[not
established]` — untouched again this sitting.
