# HANDOFF

**Written 2026-09-25, seventieth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Resolve next group of issues. Docker is
on." The group was the three open defects the Docker e2e proofs had
surfaced: **#1225, #1222, #1227**. Not picked: #1229 (Denise deferred it),
#1228 and #1226 (confirm-only records for Dennis), #1220 (waits on his
step 5), and #914's remainder (the admin-MFA revisit is gated).

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `bdd58350`.

## What shipped

- **`72a72e07` (Refs #1225).** Consent governance now reaches the real
  Sample, not a phantom keyed by the consent id.
  - New `SPECIMEN_UPSERTED` outbox event. It is emitted after the Mongo
    insert in `createSample`, the CSV/XLSX import and the LGPD import.
  - The consent projection has no aggregateId fallback. It governs the
    samples the donor already DONATED.
  - The rebuild script no longer mints an ACTIVE consent per sample.
- **`bdd58350` (#1232, closed).** The intake-wizard outcome assertion
  counts pre-existing `(type, date)` rows first. That was a birthday-problem
  flake on the kept volume.

## Touched, left open (each issue's last comment has the detail)

- **#1225:** needs **Dennis's option call**, laid out in the comment.
  - The lineage gate reads consent from the eventually consistent graph to
    decide a synchronous pre-Mongo operation.
  - So **allocate-at-create still fails the gate** (2 of 2 after the fix),
    and fail-closed would refuse every sample registration.
  - Also open: whether custody moves should be consent-gated at all
    (`requisitos.md:632`, `:1578`).
  - The kept test volume still holds 8 pre-fix phantom Samples.
- **#1222:** reproduced (6 of 240 unprobed) and narrowed.
  - The page's event loop stops: its axios 10 s timer never fires.
  - It happens only when the test interacts right after render. A CDP
    session or a 3 s wait gives 0 of 360.
  - `[inference]` A host-Chromium stall on Windows. Not fixed, on purpose.
    Settling it needs Linux Playwright, which is blocked by #1233.
- **#1227:** no recurrence in one more full run. It stands at 1 in 4.
- **#1233 (new, milestone "CI Integration for E2E Tests"):**
  `playwright-runner`'s browser cannot reach the bundle's baked
  `localhost:3000` API base, so UI specs cannot run in-container. `[read it]`
  only, never run.
- **#1234 (new):** one `socket hang up` on login in a full run.
  Keep-alive-race probes were negative through Docker Desktop's port proxy.

## Proof, [ran it] this sitting

- Unit tests: can-it-fail probe 9 red / 56 green of 65. Targeted vitest
  64/64 files. Architecture 160/160. Lint clean.
- Docker e2e on a stack rebuilt from `72a72e07`:
  - `pipeline-continuity`, `sample-storage-lifecycle`, `intake-wizard`,
    `lgpd-sample-import`, `async-import-quarantine`: **81/81, 0 skipped**.
  - **Full suite: 255 passed, 1 failed** (#1234).

## For Dennis

New: **#1225's option** (read consent from Mongo in the custody use cases,
dual-write, or Denise's delete-the-gate route) and whether custody moves are
consent-gated. Unchanged from the previous note: #1228's default, #1220's
step 5, the #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124)
stands, whether to mirror Denise's `docs/` deletions, #1231, and the go for
a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next
  `/clear`. It was used this sitting.
- **Nothing is running.** The test stack was torn down with `compose down`,
  and its volumes were kept. The `backend-app-test`, `worker-test` and
  `neo4j-projection-worker-test` images are built from `72a72e07`.
  `bdd58350` is test-only, so the next bring-up needs no `--build` unless
  src changes.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A sample's graph identity comes from `SPECIMEN_UPSERTED`, keyed by its
  Mongo `_id`.** Never reintroduce a consent event keyed by a sample, or a
  `specimenId` fallback to the consent's `aggregateId`.
- **Don't paper over #1222 with a fixed wait before the first fill.**
- **On this branch a `Closes #N` commit does not close the issue.** Comment,
  then `gh issue close`.

## Standing context: re-measure, don't copy

- **Project phase (Dennis, 2026-09-25):** work down the issues the e2e plan
  surfaced (Wave 3 tracker #646). CI comes only after they are all resolved
  and the whole plan passes on Docker.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-25
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 928 commits on hers only, 211 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is on her pushed branch
  (`git ls-tree -r --name-only origin/stabilize/v2.0.0-prototype docs/stabilization`).
  It is still unread against the issue comments.

## Recommended next

None queued by Dennis.
