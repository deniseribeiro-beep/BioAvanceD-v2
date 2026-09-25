# HANDOFF

**Written 2026-09-25, sixty-ninth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues to resolve.
Docker is on." The group was the six remaining Axis E AMEND vehicles whose
decision comments supersede their bodies: **#1055, #883, #840, #714,
#1049, #830**. All six are closed.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `c0df22f2`.

## What shipped (each issue's close comment has the detail)

- **#1055** `307a6bd1`. `create-db.js` moved to
  `docs/historical/create-db.js` with a banner. Its npm entry is gone and
  the eight authority citations were dropped.
- **#883** `c63fd736`, `bdbef765`. Routine Maintenance/Inactive (equipment
  and sensor) no longer trigger the quarantine cascade. `quarantined`
  counts `modifiedCount`, and a no-op update writes no action or ledger
  movement.
- **#840** `578490af`. The four groupFields 400s share one body,
  `{error, reason, message}`.
- **#714** `665fdbc5`. `allergenCoding` passes `validateActiveCodes` (DCB).
  The intake-wizard e2e seeds a DCB concept.
- **#1049** `2a7d9e83`. The consent-link token is stored as
  `consentTokenHash` (SHA-256) and compared with `timingSafeEqual`. Resend
  always mints and returns no `reusedToken`. Legacy rows need `npm run
  migrate:consent-token-hash`, recorded on #682. The security record is
  **#1231**.
- **#830** `a8d0e13a`, `c0df22f2`. StagingImport is on the native driver
  (`services/stagingImport.store.js`) and the Mongoose model is deleted.
  The body's "Sample.js is dormant" claim was wrong: `miabisValidator`
  calls `Sample.findById`. So `server.js` now awaits `connectMongoDB()` at
  boot. Labelled `premise-corrected`.
- `43da643c` renamed `incidents.api.node.test.js` to `incidents.api.test.js`.
  It is a vitest file, and `node --test` fails on it at parse time.

**Proof, [ran it] this sitting:**
- Targeted unit tests plus pins for each slice. Architecture 160/160, and
  `api/backend/scripts/lint.js` clean.
- **Docker e2e**, 7 specs: consent-token-page, tcle-publication-sweep,
  intake-wizard, async-import-quarantine, lgpd-sample-import,
  e-consent-import-page, participant-e-consent-page. All green once the
  reference-data chain ran. Without the chain, 6 lgpd-sample-import cases
  fail on missing PLASMA, which is environmental.
- Live API probes for #883, #840, #1049 (resend and migration) and #830
  (batch status, MIABIS on a fresh boot, with a no-connection control that
  timed out at 10s).
- **Not run:** the full e2e suite and the full vitest suite.

## Filed this sitting

- **#1231** (question). Security record for #1049; nothing to do unless
  Dennis disagrees.
- The skills-pack tracker got three filings and one tally from the friction
  audit. They are not repo work.

## Still open from the Axis E batch

Unchanged: #1227, #1228, #1229, #914, #1225, #1222, #1226, #1220.

## For Dennis

Unchanged from the previous note: #1228's default, #1220's step 5, the #941
re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands, whether to
mirror Denise's `docs/` deletions, and the go for a PR into `main`. New:
#1231, which is a confirm-only record.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next
  `/clear`. It was used this sitting.
- **Nothing is running.** The test stack was torn down with `compose down`,
  and its volumes were kept. The images were built from this sitting's
  tree, but `backend-app-test`'s last build predates only the `43da643c`
  rename, so the next bring-up needs no `--build` unless src changes.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **The consent token is never stored in plaintext.** Only
  `consentTokenHash` is stored, and validation has no plaintext fallback.
  Resend always mints.
- **StagingImport goes through `stagingImport.store.js`.** A write to an
  undeclared field throws there rather than being stripped.
- **`server.js` connects Mongoose at boot.** Mongoose models (Sample,
  storage hierarchy, Cid, ...) are still live in the API and the worker.
- **Quarantine cascades only on failure states** (offline, desligado,
  repair, awaiting repair), never on routine Maintenance/Inactive.
- **On this branch a `Closes #N` commit does not close the issue.** Comment,
  then `gh issue close`.

## Standing context: re-measure, don't copy

- **Project phase (Dennis, 2026-09-25):** work down the issues the e2e plan
  surfaced (Wave 3 tracker #646). CI comes only after they are all resolved
  and the whole plan passes on Docker.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-25
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 928 commits on hers only, 208 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her Axis E decision log `docs/stabilization/AXIS_E_DECISION_LOG.md` **is
  now on her pushed branch** as of 2026-09-25
  (`git ls-tree -r --name-only origin/stabilize/v2.0.0-prototype docs/stabilization`).
  This sitting worked from the issue comments. It did not read the log, so
  whether the log differs from them is unverified.

## Recommended next

None queued by Dennis.
